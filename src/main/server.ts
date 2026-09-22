import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import * as net from 'net';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ServerState, Config } from '../shared/types';
import { MAX_LOG_BUFFER } from '../shared/constants';
import { effectiveValue } from '../shared/params';
import { buildArgs, validateConfig, formatCmdline } from './params';
import { killTree, killTreeSync } from './process-kill';
import { getCoreDir, getServerExePath, getAppBaseDir } from './paths';

// =============================================================================
// Server 进程管理器 — 日志处理通过 Worker 线程卸荷，避免阻塞事件循环
// =============================================================================

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
  private rpcProcess: ChildProcess | null = null;
  private state: ServerState = ServerState.Stopped;

  // ---- 日志 Worker ----
  private logWorker: Worker | null = null;
  private logBuffer: string[] = [];
  private workerReady = false;

  // ---- 最后执行的完整命令 ----
  private lastCommand = '';

  constructor() {
    super();
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
            if (msg.line) this.pushLogLine(msg.line);
            break;

          case 'logs':
            // Worker 50ms 攒批回传的日志行（或 get-logs 全量查询结果，
            // 全量结果经本地环形缓冲裁剪，重复行无副作用）
            if (Array.isArray(msg.lines)) {
              for (const line of msg.lines) this.pushLogLine(line);
            }
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

  /** 根据当前配置预览命令行（无需启动服务器；密钥脱敏） */
  previewCommand(cfg: Config): string {
    const exePath = this.resolveExecutablePath();
    return formatCmdline(exePath, buildArgs(cfg), true);
  }

  // ---------------------------------------------------------------------------
  // start — 启动 llama-server 子进程
  //   返回值：同步可判定的失败原因（校验失败/可执行文件缺失），供 IPC 层抛出；
  //   null = 已受理（RPC 探测与 spawn 为异步路径）
  // ---------------------------------------------------------------------------

  start(cfg: Config): string | null {
    if (this.state !== ServerState.Stopped) {
      console.warn('[Server] 服务器已经在运行或启动中');
      return null;
    }

    // 启动前校验：error 级问题直接拒绝，避免进程带病 spawn 后静默退出
    const issues = validateConfig(cfg).filter((i) => i.severity === 'error');
    if (issues.length > 0) {
      const errMsg = `启动前配置校验失败: ${issues.map((i) => `${i.field} — ${i.message}`).join('；')}`;
      this.appendLog(`[error] ${errMsg}`);
      this.emit('error', new Error(errMsg));
      return errMsg;
    }

    const exePath = this.resolveExecutablePath();

    // 文件存在性检查
    if (!fs.existsSync(exePath)) {
      const errMsg = `可执行文件不存在: ${exePath}`;
      this.appendLog(`[error] ${errMsg}`);
      this.emit('error', new Error(errMsg));
      return errMsg;
    }

    // RPC 模式：先启动本机 ggml-rpc-server 并等待其监听就绪，
    // 否则 llama-server 连接 --rpc 端点会被拒绝直接退出
    if (cfg.rpc.server.enabled) {
      this.setState(ServerState.Starting);
      this.startRpcServer(cfg).then((ok) => {
        if (this.state !== ServerState.Starting) {
          // 等待期间用户已停止
          this.stopRpcServer();
          return;
        }
        if (!ok) {
          this.setState(ServerState.Stopped);
          return;
        }
        this.doStart(cfg, exePath);
      });
      return null;
    }

    this.doStart(cfg, exePath);
    return null;
  }

  private doStart(cfg: Config, exePath: string): void {
    const args = buildArgs(cfg);

    // 保存完整命令行供 UI 展示（与实际执行同源，密钥脱敏）
    this.lastCommand = formatCmdline(exePath, args, true);

    // 清空本地日志缓冲并通知 Worker 重置（上一轮日志不再回灌）
    this.logBuffer = [];
    if (this.logWorker && this.workerReady) {
      this.logWorker.postMessage({ type: 'reset' });
    }

    this.setState(ServerState.Starting);

    try {
      this.process = spawn(exePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // cwd 用应用根目录：core 可能位于只读 resources/，且相对路径产物
        // 不应写进程序目录；Windows 加载 exe 同目录 DLL 走应用目录搜索，与 cwd 无关
        cwd: getAppBaseDir(),
        env: buildChildEnv(process.env),
      });

      const child = this.process;

      // 'spawn' 事件只代表进程创建成功，不代表 llama-server 可用：
      // 端口要等模型加载完成才监听，参数错误/模型缺失会在 spawn 后退出。
      // 改由 waitForReady 的 TCP 探测确认就绪后才置 Running
      this.waitForReady(
        child,
        String(effectiveValue(cfg, 'server.host')),
        Number(effectiveValue(cfg, 'server.port')),
      );

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
        this.stopRpcServer();
        this.emit('error', err);
      });

      this.process.on('exit', (code, signal) => {
        this.appendLog(
          `[exit] 进程退出，code=${code ?? 'null'}, signal=${signal ?? 'null'}`
        );
        this.setState(ServerState.Stopped);
        this.stopRpcServer();
        this.emit('stopped', { code, signal });
        this.process = null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(`[error] spawn 失败: ${message}`);
      this.setState(ServerState.Stopped);
      this.stopRpcServer();
      this.emit('error', err);
    }
  }

  // ---------------------------------------------------------------------------
  // waitForReady — 轮询 llama-server 的 /health，真正可服务才置 Running
  //   仅探测 TCP 端口会误判：httplib 在建进程约 0.5s 内就 bind，
  //   而模型往往还要加载数秒到数分钟，此间接口 501/503 表示「活着但没就绪」，
  //   只有 200（槽位就绪）才算启动完成。进程提前退出即判失败（exit 监听器迁移状态），
  //   300s 超时后按存活兜底转 Running 并告警
  // ---------------------------------------------------------------------------

  private waitForReady(child: ChildProcess, host: string, port: number, timeoutMs = 300000): void {
    const probeHost =
      host === '0.0.0.0' || host === '::' || host === '*' ? '127.0.0.1' : host;
    const startedAt = Date.now();
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let probing = false;

    const finish = (ok: boolean, timeout = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      child.removeListener('exit', onExit);
      if (!ok) return; // 进程已退出：exit 监听器完成状态迁移
      if (timeout) {
        this.appendLog('[warn] 就绪探测超时但进程仍存活，按运行中处理');
      }
      this.setState(ServerState.Running);
      this.emit('started');
    };
    const onExit = () => finish(false);

    child.once('exit', onExit);

    timer = setInterval(() => {
      if (settled || probing) return;
      if (Date.now() - startedAt > timeoutMs) {
        finish(true, true);
        return;
      }
      probing = true;
      const done = (ready: boolean) => {
        probing = false;
        if (ready) finish(true);
      };
      const req = http.get(
        { host: probeHost, port, path: '/health', timeout: 1000 },
        (res) => {
          res.resume();
          done(res.statusCode === 200);
        },
      );
      req.on('error', () => done(false));
      req.on('timeout', () => {
        req.destroy();
        done(false);
      });
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // RPC Server — ggml-rpc-server.exe 子进程，生命周期跟随 llama-server
  // ---------------------------------------------------------------------------

  /** 启动本机 ggml-rpc-server 并等待其输出就绪日志；就绪返回 true，失败返回 false */
  private startRpcServer(cfg: Config): Promise<boolean> {
    if (this.rpcProcess) return Promise.resolve(true);
    const exeName = os.platform() === 'win32' ? 'ggml-rpc-server.exe' : 'rpc-server';
    const rpcExe = path.join(getCoreDir(), exeName);
    if (!fs.existsSync(rpcExe)) {
      const errMsg = `[error] RPC Server 可执行文件不存在: ${rpcExe}，请先在 Core 管理中更新核心`;
      this.appendLog(errMsg);
      this.emit('error', new Error(errMsg));
      return Promise.resolve(false);
    }
    const { host, port } = cfg.rpc.server;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (ok: boolean) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(ok);
        }
      };
      try {
        const child = spawn(rpcExe, ['-H', host, '-p', String(port)], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: getAppBaseDir(),
          env: buildChildEnv(process.env),
        });
        this.rpcProcess = child;
        const pipe = (data: Buffer, prefix: string) => {
          for (const line of data.toString().split('\n')) {
            const t = line.trim();
            if (t) this.appendLog(`${prefix}${t}`);
          }
        };
        child.stdout?.on('data', (d: Buffer) => pipe(d, '[rpc] '));
        child.stderr?.on('data', (d: Buffer) => pipe(d, '[rpc] '));
        child.on('error', (err) => {
          this.appendLog(`[error] RPC Server 进程异常: ${err.message}`);
          this.rpcProcess = null;
          finish(false);
        });
        child.on('exit', (code, signal) => {
          this.appendLog(`[rpc] 进程退出，code=${code ?? 'null'}, signal=${signal ?? 'null'}`);
          this.rpcProcess = null;
          finish(false);
        });
        this.appendLog(`[rpc] ggml-rpc-server 启动于 ${host}:${port}`);
        // 就绪检测：rpc-server 的 stdout 经管道后是块缓冲的，"Starting RPC server"
        // 行可能延迟十几秒才刷出，不能靠日志判定就绪 —— 改用 TCP 探测端口连通
        const probe = () => {
          if (settled) return;
          const sock = net.connect(port, host);
          sock.once('connect', () => {
            sock.destroy();
            finish(true);
          });
          sock.once('error', () => {
            sock.destroy();
            if (!settled) setTimeout(probe, 300);
          });
        };
        setTimeout(probe, 200);
        // 超时兜底：探测一直失败但进程存活时，等待后仍继续启动 llama
        timer = setTimeout(() => {
          if (this.rpcProcess === child) {
            this.appendLog('[warn] RPC Server 就绪探测超时，按存活继续启动');
            finish(true);
          } else {
            finish(false);
          }
        }, 20000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.appendLog(`[error] RPC Server 启动失败: ${message}`);
        finish(false);
      }
    });
  }

  private stopRpcServer(): void {
    // 先取出并清空成员引用：taskkill 回调触发时 this.rpcProcess 必须已指向
    // 新进程或 null，兜底 kill 用局部变量持有旧子进程，避免 null 竞态
    const child = this.rpcProcess;
    if (!child) return;
    this.rpcProcess = null;
    const pid = child.pid;
    if (os.platform() === 'win32' && pid) {
      // 同步等待 taskkill 完成：运行中停止与退出清理两条路径都要求
      // 函数返回后 rpc-server 进程树必然已死，不能 fire-and-forget
      killTreeSync(pid);
    } else {
      try {
        child.kill();
      } catch {
        // 进程可能已退出
      }
    }
  }

  // ---------------------------------------------------------------------------
  // stop — 关闭进程；async 版本保证返回时子进程树已终止
  //   公开 stop 会作废排队中的 restart（🟠8）：restart = 序列号保护的
  //   doStop + start，停机期间用户再点停止则不再拉起
  // ---------------------------------------------------------------------------

  private restartSeq = 0;

  async stop(): Promise<void> {
    this.restartSeq++;
    await this.doStop();
  }

  private async doStop(): Promise<void> {
    if (this.state === ServerState.Stopped) {
      return;
    }

    if (!this.process) {
      // 等待 RPC Server 就绪阶段：llama 进程尚未启动，只清理 rpc 子进程
      if (this.rpcProcess || this.state === ServerState.Starting) {
        this.setState(ServerState.Stopping);
        this.stopRpcServer();
        this.setState(ServerState.Stopped);
        this.emit('stopped', { code: null, signal: null });
      }
      return;
    }

    this.setState(ServerState.Stopping);

    const child = this.process;
    const pid = child.pid;

    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });

    if (os.platform() === 'win32') {
      // taskkill /T /F 等待完成，杜绝「主进程先退出、taskkill 没跑完」的孤儿进程
      if (pid) {
        const ok = await killTree(pid);
        if (!ok) {
          this.appendLog('[warn] taskkill 未成功，降级直接 kill');
          try { child.kill(); } catch { /* 已退出 */ }
        }
      } else {
        child.kill();
      }
    } else {
      child.kill('SIGTERM');
      const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5000)),
      ]);
      if (timedOut) {
        this.appendLog('[warn] 进程未响应 SIGTERM，强制 SIGKILL');
        child.kill('SIGKILL');
      }
    }

    // doStart 注册的 exit 监听先于本处的 once('exit')，promise 兑现时
    // 状态迁移已完成；再给 3s 兜底窗口，防止 exit 事件丢失卡死调用方
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (this.state === ServerState.Stopping) {
      this.appendLog('[warn] 未等到进程 exit 事件，强制置为已停止');
      this.setState(ServerState.Stopped);
      this.process = null;
      this.emit('stopped', { code: null, signal: null });
    }
    this.stopRpcServer();
  }

  // ---------------------------------------------------------------------------
  // restart — 停机后重新拉起；停机期间用户点了停止（restartSeq 被公开
  //   stop() 递增）则放弃拉起，避免「停了又自己活过来」
  // ---------------------------------------------------------------------------

  async restart(cfg: Config): Promise<void> {
    const seq = ++this.restartSeq;
    if (this.state === ServerState.Running || this.state === ServerState.Starting) {
      await this.doStop();
    }
    if (seq !== this.restartSeq) return;
    this.start(cfg);
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
  // destroy — 清理资源；async 版本供 before-quit 等待
  // ---------------------------------------------------------------------------

  async destroy(): Promise<void> {
    await this.stop();
    this.stopRpcServer();
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
    this.pushLogLine(line);
  }

  /** 记录外部来源日志（core 更新 / 模型下载器），让它与子进程日志共用同一份历史 */
  recordExternalLog(line: string): void {
    this.storeLogLine(line);
  }

  private storeLogLine(line: string): void {
    this.logBuffer.push(line);
    while (this.logBuffer.length > MAX_LOG_BUFFER) {
      this.logBuffer.shift();
    }
  }

  /** 本地环形缓冲 + 通知渲染进程（Worker 攒批与主线程直发共用） */
  private pushLogLine(line: string): void {
    this.storeLogLine(line);
    this.emit('log', line);
  }

  private resolveExecutablePath(): string {
    // core/ 与 exe 同基目录（见 paths.getAppBaseDir 的开发/打包路径规则）
    return getServerExePath();
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
