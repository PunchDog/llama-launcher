import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ServerState } from '../shared/types';
import { Config } from '../shared/types';
import { buildArgs } from './params';
import { getConfigPath } from './config';
import { getCoreDir } from './paths';

// =============================================================================
// Server 进程管理器 — 日志处理通过 Worker 线程卸荷，避免阻塞事件循环
// =============================================================================

const MAX_LOG_BUFFER = 5000;

/** 代理相关环境变量名（llama.cpp HTTP client 会读取并强制走代理） */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
];

/** 构建子进程环境：显式置空代理变量 + 禁代所有主机，确保 llama-server 永不走代理 */
function buildChildEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv };
  // 显式置空所有代理变量（比删除更安全，防止某些库检查 key 存在性）
  for (const key of PROXY_ENV_KEYS) {
    env[key] = '';
  }
  // 额外设置 NO_PROXY=* 兜底
  env['NO_PROXY'] = '*';
  env['no_proxy'] = '*';

  // 非 Windows：把 core 目录加入 LD_LIBRARY_PATH，确保 llama-server
  // 能找到同目录的 libggml.so / libllama.so 等共享库
  if (os.platform() !== 'win32') {
    const coreDir = getCoreDir();
    const existing = env.LD_LIBRARY_PATH || '';
    env.LD_LIBRARY_PATH = existing ? `${coreDir}:${existing}` : coreDir;
  }

  return env;
}

export class LlamaServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: ServerState = ServerState.Stopped;
  private executableName: string;

  // ---- 日志 Worker ----
  private logWorker: Worker | null = null;
  private logBuffer: string[] = [];
  private workerReady = false;

  // ---- 最后执行的完整命令 ----
  private lastCommand = '';

  constructor() {
    super();
    this.executableName =
      os.platform() === 'win32' ? 'llama-server.exe' : 'llama-server';

    this.initLogWorker();
  }

  // ---------------------------------------------------------------------------
  // initLogWorker — 启动独立线程处理日志 I/O
  // ---------------------------------------------------------------------------

  private initLogWorker(): void {
    try {
      const workerPath = path.join(__dirname, 'log-worker.js');
      // 检查 Worker 文件是否存在，避免 ENOENT 崩溃
      if (!fs.existsSync(workerPath)) {
        console.warn(`[Server] Log Worker 文件不存在: ${workerPath}，降级为同步处理`);
        this.logWorker = null;
        this.workerReady = false;
        return;
      }
      this.logWorker = new Worker(workerPath);

      this.logWorker.on('message', (msg: { type: string; line?: string; lines?: string[] }) => {
        switch (msg.type) {
          case 'ready':
            this.workerReady = true;
            break;

          case 'log':
            if (msg.line) {
              // 本地维护一份环形缓冲（getLogs 同步查询）
              this.logBuffer.push(msg.line);
              while (this.logBuffer.length > MAX_LOG_BUFFER) {
                this.logBuffer.shift();
              }
              // 通知渲染进程
              this.emit('log', msg.line);
            }
            break;

          case 'logs':
            // Worker 返回完整日志列表（但 getLogs 用本地缓冲，此消息保留备用）
            break;
        }
      });

      this.logWorker.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Server] Log Worker 异常:', msg);
        // Worker 挂了也不 crash，降级为直接处理
        this.logWorker = null;
        this.workerReady = false;
      });

      this.logWorker.on('exit', (code) => {
        if (code !== 0) {
          console.warn(`[Server] Log Worker 退出，code=${code}`);
        }
        this.logWorker = null;
        this.workerReady = false;
      });
    } catch (err) {
      console.error('[Server] 无法创建 Log Worker:', err);
      this.logWorker = null;
      this.workerReady = false;
    }
  }

  // ---------------------------------------------------------------------------
  // 状态查询
  // ---------------------------------------------------------------------------

  getState(): ServerState {
    return this.state;
  }

  getLogs(): string[] {
    return [...this.logBuffer];
  }

  getCommand(): string {
    return this.lastCommand;
  }

  /** 根据当前配置预览命令行（无需启动服务器） */
  previewCommand(cfg: Config): string {
    const exePath = this.resolveExecutablePath();
    const args = buildArgs(cfg);
    return [exePath, ...args].map((a) => a.includes(' ') ? `"${a}"` : a).join(' ');
  }

  // ---------------------------------------------------------------------------
  // start — 启动 llama-server 子进程
  // ---------------------------------------------------------------------------

  start(cfg: Config): void {
    if (this.state !== ServerState.Stopped) {
      console.warn('[Server] 服务器已经在运行或启动中');
      return;
    }

    const exePath = this.resolveExecutablePath();

    // 文件存在性检查
    if (!fs.existsSync(exePath)) {
      const errMsg = `[error] 可执行文件不存在: ${exePath}`;
      this.appendLog(errMsg);
      this.emit('error', new Error(errMsg));
      return;
    }

    const args = buildArgs(cfg);

    // 保存完整命令行供 UI 展示
    this.lastCommand = [exePath, ...args].map((a) => a.includes(' ') ? `"${a}"` : a).join(' ');

    // 清空日志缓冲区
    this.logBuffer = [];

    // 写入 config.json（确保最新配置被服务端读取）
    try {
      const { saveConfig } = require('./config');
      saveConfig(cfg);
    } catch {
      // 如果 saveConfig 已通过 IPC 调用，此处忽略
    }

    this.setState(ServerState.Starting);

    try {
      this.process = spawn(exePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.dirname(exePath),  // DLL 在 exe 同目录
        env: buildChildEnv(process.env),
      });

      this.process.on('spawn', () => {
        this.setState(ServerState.Running);
        this.emit('started');
      });

      // ---- stdout: 数据直送 Worker 线程处理 ----
      if (this.process.stdout) {
        this.process.stdout.on('data', (data: Buffer) => {
          this.sendToWorker(data.toString());
        });
      }

      // ---- stderr: 数据直送 Worker 线程处理 ----
      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          this.sendToWorker('[stderr] ' + data.toString());
        });
      }

      this.process.on('error', (err) => {
        this.appendLog(`[error] 进程启动失败: ${err.message}`);
        this.setState(ServerState.Stopped);
        this.emit('error', err);
      });

      this.process.on('exit', (code, signal) => {
        this.appendLog(
          `[exit] 进程退出，code=${code ?? 'null'}, signal=${signal ?? 'null'}`
        );
        this.setState(ServerState.Stopped);
        this.emit('stopped', { code, signal });
        this.process = null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(`[error] spawn 失败: ${message}`);
      this.setState(ServerState.Stopped);
      this.emit('error', err);
    }
  }

  // ---------------------------------------------------------------------------
  // stop — 优雅关闭进程
  // ---------------------------------------------------------------------------

  stop(): void {
    if (!this.process || this.state === ServerState.Stopped) {
      return;
    }

    this.setState(ServerState.Stopping);

    if (os.platform() === 'win32') {
      // Windows: 使用 taskkill 终止子进程树
      const pid = this.process.pid;
      if (pid) {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
        });
        killer.on('error', (err) => {
          this.appendLog(`[error] taskkill 失败: ${err.message}`);
          // 降级到直接 kill
          if (this.process) {
            this.process.kill('SIGTERM');
          }
        });
      }
    } else {
      // Unix: SIGTERM 优雅关闭
      this.process.kill('SIGTERM');

      // 如果 5 秒后仍未退出，强制 SIGKILL
      const forceKillTimer = setTimeout(() => {
        if (this.process && this.state === ServerState.Stopping) {
          this.appendLog('[warn] 进程未响应 SIGTERM，强制 SIGKILL');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(forceKillTimer);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // restart — 重新启动
  // ---------------------------------------------------------------------------

  restart(cfg: Config): void {
    if (this.state === ServerState.Running || this.state === ServerState.Starting) {
      // 监听 stopped 事件后自动重启
      this.once('stopped', () => {
        this.start(cfg);
      });
      this.stop();
    } else {
      this.start(cfg);
    }
  }

  // ---------------------------------------------------------------------------
  // isRunning — 检查进程是否存活
  // ---------------------------------------------------------------------------

  isRunning(): boolean {
    if (!this.process || this.state !== ServerState.Running) {
      return false;
    }
    // 通过 PID 检查进程是否真实存在
    try {
      process.kill(this.process.pid!, 0);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // destroy — 清理资源
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.stop();
    if (this.logWorker) {
      this.logWorker.terminate();
      this.logWorker = null;
    }
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  /** 向 Worker 线程发送原始日志数据 */
  private sendToWorker(raw: string): void {
    if (this.logWorker && this.workerReady) {
      this.logWorker.postMessage(raw);
    } else {
      // 降级：Worker 不可用时同步处理
      this.fallbackLog(raw);
    }
  }

  /** 降级模式：Worker 不可用时在主线程处理日志 */
  private fallbackLog(raw: string): void {
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.appendLog(trimmed);
      }
    }
  }

  private setState(newState: ServerState): void {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit('state-change', newState, oldState);
    }
  }

  /** 用于非流式日志（错误/退出信息等低频消息） */
  private appendLog(line: string): void {
    this.logBuffer.push(line);
    while (this.logBuffer.length > MAX_LOG_BUFFER) {
      this.logBuffer.shift();
    }
    this.emit('log', line);
  }

  private resolveExecutablePath(): string {
    // 优先查找 core/ 子目录（与 exe 同目录）
    const configPath = getConfigPath();
    const exeDir = path.dirname(configPath);
    const coreExe = path.join(exeDir, 'core', this.executableName);
    return coreExe;
  }
}

// 单例
let instance: LlamaServerManager | null = null;

export function getServerManager(): LlamaServerManager {
  if (!instance) {
    instance = new LlamaServerManager();
  }
  return instance;
}
