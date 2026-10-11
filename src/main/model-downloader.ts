import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { EventEmitter } from 'events';
import { safeJoin, assertSafeArg, writeFileAtomic } from '../shared/fs-safe';
import { resolveProxy, SpeedSampler } from './net-util';
import { downloadToPartFile } from './part-download';
import {
  findPython,
  isInVenv,
  probeModelscopeVersion,
  resolveModelscopeBin,
  buildCliEnv,
} from './modelscope-env';
import { MODELSCOPE_API_BASE, segEncode, searchModels as msSearchModels } from './modelscope-search';
import { errMsg } from '../shared/errors';
import {
  ModelScopeEnvState,
  ModelInfo,
  ModelFile,
  ModelDownloadState,
} from '../shared/types';

// =============================================================================
// ModelDownloader — ModelScope 模型下载（HTTPS 直链优先，Python 工具回退）
//   继承自 EventEmitter：通过 emit('log', line) 把进度/状态推给主进程转发到日志区
// =============================================================================

function initialModelState(): ModelDownloadState {
  return {
    progress: 0,
    status: '空闲',
    error: '',
    isDownloading: false,
    mode: '',
    modelId: '',
    localDir: '',
    currentFile: '',
    downloadedBytes: 0,
    downloadSize: 0,
    downloadSpeed: 0,
    httpFailed: false,
    files: [],
    selectedFiles: [],
  };
}

export class ModelDownloader extends EventEmitter {
  state: ModelDownloadState = initialModelState();
  private _env: ModelScopeEnvState = {
    pythonInstalled: false,
    pythonPath: '',
    pythonVersion: '',
    modelscopeInstalled: false,
    modelscopeVersion: '',
  };
  private _pythonPath = '';
  /** 是否已完成过一次环境探测；_env 有非空初值，不能用它本身判断 */
  private _envProbed = false;
  private _abort: AbortController | null = null;
  private _child: ChildProcess | null = null;
  private _sampler = new SpeedSampler();
  /** emitProgress 的节流定时器；null 表示当前没有待推送的进度 */
  private _progressTimer: NodeJS.Timeout | null = null;
  /** 文件列表按 modelId 缓存：下载/清理取列表不与当前模型串台 */
  private _filesCache = new Map<string, ModelFile[]>();
  proxyUrl = '';

  // ----- 状态辅助 -----

  getState(): ModelDownloadState {
    return { ...this.state };
  }

  setProxy(url: string): void {
    this.proxyUrl = url;
  }

  private setStatus(s: string): void {
    const changed = s !== this.state.status;
    this.state.status = s;
    if (changed && s) this.emit('log', s);
    this.emitProgress();
  }

  private setError(e: string): void {
    this.state.error = e;
    this.state.status = `❌ ${e}`;
    this.emit('log', `❌ ${e}`);
    this.emitProgress();
  }

  /**
   * 进度推送（渲染层 bridge 的唯一来源，取代 500ms 轮询）。
   * throttle=true 用于逐字节的进度回调，最多每 250ms 推一次；
   * 状态跃迁点用不带节流的一次，保证「开始/结束」不会被延迟。
   */
  private emitProgress(throttle = false): void {
    if (!throttle) {
      if (this._progressTimer) {
        clearTimeout(this._progressTimer);
        this._progressTimer = null;
      }
      this.emit('progress', this.getState());
      return;
    }
    if (this._progressTimer) return;
    this._progressTimer = setTimeout(() => {
      this._progressTimer = null;
      this.emit('progress', this.getState());
    }, 250);
    this._progressTimer.unref?.();
  }

  // ----- 下载速度采样（KB/s，共用 net-util.SpeedSampler）-----

  private resetSpeedSample(): void {
    this._sampler.reset();
    this.state.downloadSpeed = 0;
  }

  private updateSpeedSample(totalBytes: number): void {
    this.state.downloadSpeed = this._sampler.update(totalBytes);
  }

  private proxyConfig() {
    return resolveProxy(this.proxyUrl);
  }

  async checkEnv(force = false): Promise<ModelScopeEnvState> {
    // 探测结果在一次会话内不会自己变化：缓存避免每次刷新界面都重跑 python 子进程并重复打日志
    if (!force && this._envProbed) return { ...this._env };
    const env: ModelScopeEnvState = {
      pythonInstalled: false,
      pythonPath: '',
      pythonVersion: '',
      modelscopeInstalled: false,
      modelscopeVersion: '',
    };
    const py = await findPython();
    if (!py) {
      this._env = env;
      this._envProbed = true;
      this.emit('log', '未检测到 Python，Python 工具回退不可用');
      return env;
    }
    env.pythonInstalled = true;
    env.pythonPath = py.path;
    env.pythonVersion = py.version;
    this._pythonPath = py.path;

    const ver = await probeModelscopeVersion(py.path);
    if (ver) {
      env.modelscopeInstalled = true;
      env.modelscopeVersion = ver;
    }

    this._env = env;
    this._envProbed = true;
    this.emit('log', `Python: ${py.version} @ ${py.path}`);
    this.emit('log', env.modelscopeInstalled ? `modelscope: ${env.modelscopeVersion}` : 'modelscope 未安装');
    return env;
  }

  /** 安装 modelscope（仅 Python 回退路径需要）；全局解释器加 --user 避免污染系统 site-packages/权限失败 */
  async installModelscope(): Promise<void> {
    if (!this._pythonPath) {
      const py = await findPython();
      if (!py) throw new Error('未检测到 Python，无法安装 modelscope');
      this._pythonPath = py.path;
    }
    this.setStatus('正在安装 modelscope...');
    const inVenv = await isInVenv(this._pythonPath);
    const args = ['-m', 'pip', 'install', '-U'];
    if (!inVenv) args.push('--user');
    args.push('modelscope');
    if (this.proxyUrl) args.push('--proxy', this.proxyUrl);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this._pythonPath, args, {
        windowsHide: true,
        env: buildCliEnv(this.proxyUrl),
      });
      this._child = child;
      child.stdout?.on('data', (d) => this.emit('log', d.toString().trim()));
      child.stderr?.on('data', (d) => this.emit('log', d.toString().trim()));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        this._child = null;
        if (code === 0) {
          this.setStatus('✅ modelscope 安装完成');
          resolve();
        } else {
          reject(new Error(`pip 退出码 ${code}`));
        }
      });
    });

    await this.checkEnv(true);
  }

  // ----- 搜索模型名列表（实现见 modelscope-search.ts，这里只接状态回调）-----

  async searchModels(keyword: string): Promise<ModelInfo[]> {
    return msSearchModels(keyword, this.proxyConfig(), (msg) => this.setStatus(msg));
  }

  // ----- 获取模型仓库文件列表 -----

  async listFiles(modelId: string): Promise<ModelFile[]> {
    this.setStatus(`获取文件列表: ${modelId}`);
    const url = `${MODELSCOPE_API_BASE}/models/${segEncode(modelId)}/repo/files`;
    const resp = await axios.get(url, {
      params: { Revision: 'master', Root: '.' },
      timeout: 30000,
      proxy: this.proxyConfig(),
    });
    const data = resp.data?.Data as Record<string, unknown> | undefined;
    const raw: unknown[] = (data?.Files as unknown[]) ?? (Array.isArray(data) ? data : []);
    const files: ModelFile[] = (raw as Record<string, unknown>[])
      .filter((f) => f.Type === 'blob' || f.Type === 'file')
      .map((f) => ({
        name: String(f.Name ?? ''),
        path: String(f.Path ?? ''),
        size: typeof f.Size === 'number' ? f.Size : 0,
        type: String(f.Type ?? 'blob'),
      }));
    this.state.files = files;
    this.state.selectedFiles = [];
    this._filesCache.set(modelId, files);
    this.setStatus(`共 ${files.length} 个文件`);
    return files;
  }

  /** 取指定模型的文件列表：优先缓存，缓存缺失时拉取 */
  private async filesOf(modelId: string): Promise<ModelFile[]> {
    const cached = this._filesCache.get(modelId);
    if (cached && cached.length > 0) return cached;
    return this.listFiles(modelId);
  }

  // ----- 下载入口（按 mode 分发） -----

  async download(req: {
    modelId: string;
    localDir: string;
    files?: string[];
    mode: 'http' | 'cli';
  }): Promise<void> {
    if (this.state.isDownloading) throw new Error('正在下载中，请等待');
    this._abort = new AbortController();

    try {
      if (req.mode === 'cli') {
        await this.downloadCli(req.modelId, req.localDir, req.files);
      } else {
        try {
          await this.downloadHttpFiles(req.modelId, req.localDir, req.files ?? []);
        } catch (err) {
          const msg = errMsg(err);
          // 用户主动取消：cancel() 已复位状态，这里静默返回，不当作失败
          if (this._abort?.signal.aborted || /canceled|aborted/i.test(msg)) {
            return;
          }
          this.state.httpFailed = true;
          this.setError(`HTTPS 直链下载失败：${msg}`);
          throw err;
        }
      }
    } finally {
      this.state.isDownloading = false;
      this.emitProgress();
    }
  }

  /** HTTPS 直链下载（优先路径） */
  private async downloadHttpFiles(
    modelId: string,
    localDir: string,
    files: string[],
  ): Promise<void> {
    this.state.mode = 'http';
    this.state.isDownloading = true;
    this.state.error = '';
    this.state.httpFailed = false;
    this.state.progress = 0;
    this.state.downloadedBytes = 0;
    this.state.downloadSize = 0;
    this.resetSpeedSample();
    this.state.modelId = modelId;
    this.state.localDir = localDir;

    // 文件元信息按 modelId 从缓存取：state.files 可能属于上一个浏览过的模型，
    // 直接引用会让大小/清单串台
    const repoFiles = await this.filesOf(modelId);
    const targets = files.length ? files : repoFiles.map((f) => f.path);
    if (targets.length === 0) {
      throw new Error('没有可下载的文件，请先获取文件列表并勾选');
    }
    // 远端文件列表可被篡改（../../ 等），落盘前统一过 safeJoin，任一非法即整体拒绝
    for (const rel of targets) safeJoin(localDir, rel);

    const meta = new Map(repoFiles.map((f) => [f.path, f]));
    const totalAll = targets.reduce((s, p) => s + (meta.get(p)?.size || 0), 0);
    this.state.downloadSize = totalAll;
    let downloadedAll = 0;

    fs.mkdirSync(localDir, { recursive: true });
    // 写入下载清单，供取消时清理；成功完成后移除
    this.writeManifest(localDir, modelId, 'http', targets);

    for (let i = 0; i < targets.length; i++) {
      const rel = targets[i];
      this.state.currentFile = rel;
      this.setStatus(`[${i + 1}/${targets.length}] 下载: ${rel}`);
      const fileSize = meta.get(rel)?.size || 0;
      await this.downloadSingleFile(modelId, localDir, rel, fileSize, (inc) => {
        downloadedAll += inc;
        this.state.downloadedBytes = Math.min(downloadedAll, totalAll || downloadedAll);
        this.updateSpeedSample(downloadedAll);
        this.emitProgress(true);
        if (totalAll > 0) {
          this.state.progress = Math.min(100, (downloadedAll / totalAll) * 100);
        }
      });
    }

    this.state.progress = 100;
    this.resetSpeedSample();
    this.cleanupManifest(localDir);
    this.setStatus(`✅ HTTPS 下载完成：共 ${targets.length} 个文件 → ${localDir}`);
  }

  /**
   * 单文件下载：写 `${dest}.part`，完整校验后 rename 落正名（流控见 part-download.ts）。
   *   - 目标文件已存在且大小一致 → 直接跳过
   *   - 存在 .part 残包 → 带 Range 续传（206 追加；200 说明服务器不支持，从头覆写）
   *   - 中断/网络失败保留 .part 供下次续传；用户取消时由 manifest 清理删除
   */
  private async downloadSingleFile(
    modelId: string,
    localDir: string,
    rel: string,
    fileSize: number,
    onChunk: (inc: number) => void,
  ): Promise<void> {
    // 官方 SDK 下载 URL：/api/v1/models/{model_id}/repo?Revision=&FilePath=
    const url =
      `${MODELSCOPE_API_BASE}/models/${segEncode(modelId)}` +
      `/repo?Revision=master&FilePath=${encodeURIComponent(rel)}`;
    // rel 已在调用方过 safeJoin 校验；这里再过一次作为最后防线
    const dest = safeJoin(localDir, rel);

    if (fileSize > 0 && fs.existsSync(dest)) {
      try {
        if (fs.statSync(dest).size === fileSize) {
          onChunk(fileSize);
          return;
        }
      } catch {
        // 竞态删除，继续正常下载
      }
    }

    await downloadToPartFile({
      url,
      dest,
      proxy: this.proxyConfig(),
      signal: this._abort?.signal,
      resume: true,
      keepPartOnFailure: true,
      expectedSize: fileSize,
      onProgress: (inc) => onChunk(inc),
    });
  }

  /** Python modelscope CLI 下载（回退路径）：modelscope download <repo_id> [files...] --local_dir */
  private async downloadCli(
    modelId: string,
    localDir: string,
    files?: string[],
  ): Promise<void> {
    if (!this._pythonPath) {
      const py = await findPython();
      if (!py) throw new Error('未检测到 Python，无法使用 modelscope CLI');
      this._pythonPath = py.path;
    }
    this.state.mode = 'cli';
    this.state.isDownloading = true;
    this.state.error = '';
    this.state.httpFailed = false;
    this.state.modelId = modelId;
    this.state.localDir = localDir;
    this.resetSpeedSample();
    this.setStatus(`使用 ModelScope Python 工具下载: ${modelId}`);

    const bin = await resolveModelscopeBin(this._pythonPath);
    // files 作为位置参数（为空 = 下载整个仓库快照）
    // 远端文件名以 '-' 开头会被 CLI 解析成选项（参数注入），逐个拒绝
    const fileArgs = (files ?? []).map((f) => assertSafeArg(f, '文件名'));
    const args = ['download', assertSafeArg(modelId, '模型 ID'), ...fileArgs, '--local_dir', localDir];
    // 写入下载清单（CLI 模式目标路径为 localDir/相对路径），供取消时清理
    this.writeManifest(localDir, modelId, 'cli', files ?? []);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, {
        windowsHide: true,
        env: buildCliEnv(this.proxyUrl),
      });
      this._child = child;
      // StringDecoder 跨 chunk 缓冲多字节字符，避免 UTF-8 序列被 chunk 边界切断产生乱码
      const outDec = new StringDecoder('utf8');
      const errDec = new StringDecoder('utf8');
      child.stdout.on('data', (d) => this.handleCliOutput(outDec.write(d)));
      child.stderr.on('data', (d) => this.handleCliOutput(errDec.write(d)));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        this._child = null;
        if (code === 0) {
          this.state.progress = 100;
          this.resetSpeedSample();
          this.cleanupManifest(localDir);
          this.setStatus(`✅ Python 工具下载完成 → ${localDir}`);
          resolve();
        } else if (this._abort?.signal.aborted) {
          // 用户主动取消：状态已由 cancel() 复位，静默结束
          resolve();
        } else {
          reject(new Error(`modelscope CLI 退出码 ${code}`));
        }
      });
    });
  }

  private handleCliOutput(text: string): void {
    // CLI 进度用 \r 原地刷新，需按 \r\n 双分隔切分
    for (const raw of text.split(/[\r\n]/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) {
        const p = parseFloat(m[1]);
        if (!Number.isNaN(p)) {
          this.state.progress = Math.min(100, p);
          this.emitProgress(true);
        }
      }
      // modelscope CLI 进度行自带速度（如 "12.34 MB/s"），解析为 KB/s
      const s = line.match(/([\d.]+)\s*(B|KB|MB|GB)\/s/i);
      if (s) {
        const val = parseFloat(s[1]);
        const unit = s[2].toUpperCase();
        const kbps =
          unit === 'B' ? val / 1024
          : unit === 'KB' ? val
          : unit === 'MB' ? val * 1024
          : val * 1024 * 1024;
        if (!Number.isNaN(kbps)) this.state.downloadSpeed = Math.round(kbps);
      }
      // tqdm 进度条行不进日志区（乱码 + 刷屏），三重识别：块状字符 / "NN%|" 进度条结构 / U+FFFD 解码失败字符
      if (/[█▉▊▋▌▍▎]/.test(line) || /\d+(?:\.\d+)?%\s*\|/.test(line) || /�/.test(line)) continue;
      this.emit('log', line);
    }
  }

  // ----- 下载清单（manifest）-----
  //   下载开始时在 localDir 写入 .modelscope-download-manifest.json 记录本次
  //   全部目标文件路径；下载成功 → 仅删 manifest；用户取消 → 按 manifest 删除
  //   所有已写入的文件（含未完成分块）后再删 manifest。

  private manifestPath(localDir: string): string {
    return path.join(localDir, '.modelscope-download-manifest.json');
  }

  private writeManifest(
    localDir: string,
    modelId: string,
    mode: 'http' | 'cli',
    relPaths: string[],
  ): void {
    fs.mkdirSync(localDir, { recursive: true });
    const manifest = {
      modelId,
      mode,
      createdAt: new Date().toISOString(),
      // 只存相对路径：manifest 被篡改/残留时也不会引导删除任意绝对路径
      files: relPaths.map((p) => path.relative(localDir, safeJoin(localDir, p))),
    };
    writeFileAtomic(this.manifestPath(localDir), JSON.stringify(manifest, null, 2));
  }

  /** 按 manifest 清理未完成下载的所有文件，并删除 manifest 自身 */
  private removeManifestFiles(localDir: string, expectedModelId?: string): void {
    const mp = this.manifestPath(localDir);
    try {
      if (!fs.existsSync(mp)) return;
      const raw = fs.readFileSync(mp, 'utf-8');
      const manifest = JSON.parse(raw) as {
        modelId?: unknown;
        files?: unknown;
      };
      // 目录里残留着别的模型的旧清单时，只删清单文件本身，不动它的条目
      const modelMismatch =
        expectedModelId !== undefined &&
        typeof manifest.modelId === 'string' &&
        manifest.modelId !== expectedModelId;
      if (!modelMismatch && Array.isArray(manifest.files)) {
        for (const f of manifest.files) {
          if (typeof f !== 'string') continue;
          try {
            const target = safeJoin(localDir, f);
            // 正式文件与 .part 续传残包一并清理（前缀只由 ipc-handlers 转发层加）
            for (const p of [target, `${target}.part`]) {
              if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            this.emit('log', `已清理: ${f}`);
          } catch {
            // 非法路径或单个文件删除失败都不阻断整体清理
          }
        }
      } else if (modelMismatch) {
        this.emit('log', 'manifest 模型 ID 不匹配，跳过其文件清理');
      }
    } catch {
      // manifest 损坏时也继续删除它
    }
    try {
      fs.unlinkSync(mp);
    } catch {
      // ignore
    }
  }

  /** 下载成功后仅移除 manifest 记录文件 */
  private cleanupManifest(localDir: string): void {
    try {
      fs.unlinkSync(this.manifestPath(localDir));
    } catch {
      // ignore
    }
  }

  // ----- 取消 / 退出中止 -----

  /**
   * 退出清理专用：中止下载流与 CLI 子进程，但保留 .part 与 manifest，
   * 下次启动仍可续传或被新一轮清理 —— 与用户主动 cancel（删文件）语义不同。
   */
  abort(): void {
    this._abort?.abort();
    if (this._child) {
      try {
        this._child.kill();
      } catch {
        // 进程可能已退出
      }
      this._child = null;
    }
  }

  cancel(): void {
    this._abort?.abort();
    if (this._child) {
      try {
        this._child.kill();
      } catch {
        // 进程可能已退出
      }
      this._child = null;
    }
    // 按下载清单清理本次所有未完成文件
    const dir = this.state.localDir;
    if (dir) this.removeManifestFiles(dir, this.state.modelId || undefined);
    this.setStatus('已取消，已清理未完成的下载文件');
    this.state.isDownloading = false;
    this.state.mode = '';
    this.state.httpFailed = false;
    this.state.currentFile = '';
    this.state.progress = 0;
    this.state.downloadedBytes = 0;
    this.state.downloadSize = 0;
    this.resetSpeedSample();
  }
}
