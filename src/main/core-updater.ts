import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { execFile } from 'child_process';
import {
  ReleaseInfo,
  Asset,
  UpdaterState,
} from '../shared/types';
import {
  GITHUB_API_URL,
  GITHUB_API_REPO_URL,
  ARCH_LABEL,
  getBackendKeyword,
  getBackendLabel,
  type GpuBackend,
} from '../shared/constants';
import { resolveProxy, SpeedSampler, ghFetch, clearGhCache } from './net-util';
import { isTargetBinary } from './archive-shared';

// =============================================================================
// 路径辅助 — 从 paths.ts 导入统一的基础路径
// =============================================================================

import { getCoreDir, getDownloadDir, getServerExePath } from './paths';

export function CoreDir(): string { return getCoreDir(); }
export function DownloadDir(): string { return getDownloadDir(); }
export { getServerExePath };

export function CheckCoreExists(): boolean {
  return fs.existsSync(getServerExePath());
}

/**
 * 读取本地 llama-server 版本号。
 * 异步 execFile：spawnSync + sleepSync 会冻结主进程事件循环最长 6 秒
 * （日志流、下载进度、窗口交互全部停摆），必须避免。
 */
export async function GetLocalVersion(): Promise<string> {
  if (!CheckCoreExists()) return '未安装';

  const exePath = getServerExePath();
  const coreDir = path.dirname(exePath);

  // 非 Windows：需要把 core 目录加入 LD_LIBRARY_PATH，
  // 否则 llama-server 找不到同目录的 .so 库文件
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (process.platform !== 'win32') {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
      ? `${coreDir}:${env.LD_LIBRARY_PATH}`
      : coreDir;
  }

  const execFileCapture = (
    file: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; err: string | null }> =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        { timeout: 5000, encoding: 'utf-8', cwd: coreDir, env, windowsHide: true },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            // 非零退出码时仍取输出（llama.cpp 把版本号打在 stderr），
            // 仅在真正 spawn 失败时记录错误
            err: error ? error.message : null,
          });
        },
      );
    });

  // 刚更新完的 exe 可能被杀软短暂锁定导致 spawn 失败，重试一次
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await execFileCapture(exePath, ['--version']);

    // 优先 stderr（llama.cpp 惯例），其次 stdout
    const raw = (result.stderr || result.stdout || '').trim();
    if (raw) {
      const first = raw.split(/\r?\n/)[0] || '';
      // 只显示构建号（如 "version: 6119 (b10964)" → "b10964"），
      // 完整输出版本信息过长，不适合 UI 展示
      const m = first.match(/\bb\d{3,}\b/i);
      return m ? m[0].toLowerCase() : first;
    }
    console.error(
      `[GetLocalVersion] 第 ${attempt} 次无输出:`,
      result.err ?? 'empty output',
    );

    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
    }
  }

  return '未知';
}

// =============================================================================
// OS + Backend 辅助
// =============================================================================

export function GetBackendKeyword(osName: string, backend: string): string {
  return getBackendKeyword((backend as GpuBackend) || 'vulkan', process.platform);
}

export function GetBackendLabel(osName: string, backend: string): string {
  return getBackendLabel((backend as GpuBackend) || 'vulkan', process.platform);
}

// =============================================================================
// formatSize
// =============================================================================

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// =============================================================================
// 压缩包辅助 — 解压在独立 Worker 线程执行（见 extract-worker.ts），
//   主进程只接收状态/结果消息；adm-zip 同步解压与文件占用重试
//   不再冻结主进程事件循环（🟠17）
// =============================================================================

function getArchiveExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  if (lower.endsWith('.tgz')) return '.tar.gz';
  return path.extname(name);
}

function copyFileSync(src: string, dst: string): void {
  fs.copyFileSync(src, dst);
}

/** 优先 core/7za(win: .exe)，找不到则回退 PATH 中的 7z（由主进程解析，Worker 无 electron） */
function resolveSevenZipExe(): string | undefined {
  const name = process.platform === 'win32' ? '7za.exe' : '7za';
  const local = path.join(CoreDir(), name);
  return fs.existsSync(local) ? local : undefined;
}

async function extractArchive(
  src: string,
  dst: string,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const workerPath = path.join(__dirname, 'extract-worker.js');
  if (!fs.existsSync(workerPath)) {
    throw new Error(`解压模块缺失: ${workerPath}，请重新构建应用`);
  }
  const worker = new Worker(workerPath);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      worker.on('message', (msg: { type: string; msg?: string; message?: string }) => {
        if (msg.type === 'status') onStatus?.(msg.msg ?? '');
        else if (msg.type === 'done') settle(resolve);
        else if (msg.type === 'error') settle(() => reject(new Error(msg.message ?? '解压失败')));
      });
      worker.on('error', (err) => settle(() => reject(err)));
      worker.on('exit', (code) => {
        if (code !== 0) settle(() => reject(new Error(`解压线程异常退出 (code=${code})`)));
      });
      worker.postMessage({ op: 'extract', src, dst, sevenZipExe: resolveSevenZipExe() });
    });
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

// =============================================================================
// 流式 SHA256 — 数百 MB 包不整读进内存
// =============================================================================

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d: Buffer) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err: Error) => reject(err));
  });
}

// =============================================================================
// ListDownloadedFiles — 降序排列
// =============================================================================

export function ListDownloadedFiles(): string[] {
  const dir = DownloadDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((name) => {
    const lower = name.toLowerCase();
    return (
      lower.endsWith('.7z') ||
      lower.endsWith('.zip') ||
      lower.endsWith('.tar.gz')
    );
  });

  files.sort().reverse();
  return files;
}

// =============================================================================
// CoreUpdater 类
// =============================================================================

export class CoreUpdater extends EventEmitter {
  progress = 0;
  status = '';
  error = '';
  /** 二进制实际对应的 tag：nightly 构建号（如 "b10964"）或正式版 tag */
  latestTag = '';
  /** 正式版 release tag（如 "v0.4.1"），用于与新版 llama-server 的语义化版本输出比较 */
  latestReleaseTag = '';
  downloadURL = '';
  assetName = '';
  downloadSize = 0;
  downloadedBytes = 0;
  downloadSpeed = 0;  // KB/s
  isDownloading = false;
  selectedOS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  selectedBackend: GpuBackend = 'vulkan';
  proxyUrl = '';     // HTTP 代理地址，如 http://127.0.0.1:7890
  /** release 中 `<资产名>.sha256` 校验文件的下载地址（llama.cpp 目前不附带，存在则强制校验） */
  sha256URL = '';

  // 下载速度计算（0.5s 增量采样，见 net-util.SpeedSampler）
  private sampler = new SpeedSampler();
  // 进度推送节流：渲染层从 500ms 轮询改为事件推送，200ms 节流防消息风暴
  private lastProgressEmit = 0;

  // ----- getters / setters -----

  /** 向 IPC 层推送最新状态（200ms 节流；force=true 用于状态迁移点立即出货） */
  private emitProgress(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastProgressEmit < 200) return;
    this.lastProgressEmit = now;
    this.emit('progress', this.getState());
  }

  getProgress(): number {
    return this.progress;
  }

  getStatus(): string {
    return this.status;
  }

  getSelectedOSDesc(): string {
    return GetBackendLabel(this.selectedOS, this.selectedBackend);
  }

  getState(): UpdaterState {
    return {
      progress: this.progress,
      status: this.status,
      error: this.error,
      latestTag: this.latestTag,
      latestReleaseTag: this.latestReleaseTag,
      downloadURL: this.downloadURL,
      assetName: this.assetName,
      downloadedBytes: this.downloadedBytes,
      downloadSize: this.downloadSize,
      downloadSpeed: this.downloadSpeed,
      isDownloading: this.isDownloading,
      selectedOS: this.selectedOS,
      selectedBackend: this.selectedBackend,
    };
  }

  setProgress(p: number, downloadedKB?: number, totalKB?: number): void {
    this.progress = p;
    if (downloadedKB !== undefined) this.downloadedBytes = downloadedKB * 1024;
    if (totalKB !== undefined) this.downloadSize = totalKB * 1024;
    this.emitProgress();
  }

  setStatus(s: string): void {
    const changed = s !== this.status;
    this.status = s;
    // 状态变化时发出日志，供 LogViewer 页面展示（ipc-handlers 加 [core] 前缀转发）
    if (changed && s) {
      this.emit('log', s);
      this.emitProgress(true);
    }
  }

  setError(e: string): void {
    this.error = e;
    this.status = `❌ ${e}`;
    this.emit('log', `❌ ${e}`);
    this.emitProgress(true);
  }

  // ----- proxy -----

  setProxy(url: string): void {
    if (url !== this.proxyUrl) {
      this.proxyUrl = url;
      // 换代理后出口 IP 变化，ETag 缓存与限流计数应重来
      clearGhCache();
    }
  }

  // ----- fetchLatestRelease -----

  private axiosHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': 'llama-launcher/1.0',
    };
  }

  private proxyCfg() {
    return resolveProxy(this.proxyUrl);
  }

  /** 请求指定 GitHub release API 端点（ghFetch：ETag 条件缓存 + 403/429 限流处理） */
  private async fetchRelease(url: string, label: string): Promise<ReleaseInfo> {
    try {
      return await ghFetch<ReleaseInfo>(url, this.proxyCfg());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${label}: ${msg}`, { cause: err });
    }
  }

  /** 在资产列表中按平台关键词匹配二进制资产 */
  private matchAsset(assets: Asset[], keyword: string): Asset | undefined {
    return assets.find((a) => a.name.includes(keyword));
  }

  /**
   * 从正式版 release 中解析 nightly 构建 tag（如 "b10964"）：
   *   1. 优先下载 7 字节的 nightly-tag.txt 资产，内容即 tag
   *   2. 兜底从 release body 的 "Nightly build: [b10964](.../tag/b10964)" 链接解析
   */
  private async resolveNightlyTag(release: ReleaseInfo): Promise<string> {
    const tagAsset = release.assets.find((a) => a.name === 'nightly-tag.txt');
    if (tagAsset) {
      try {
        const resp = await axios.get<string>(tagAsset.browser_download_url, {
          headers: this.axiosHeaders(),
          responseType: 'text',
          timeout: 15000,
          proxy: this.proxyCfg(),
        });
        const tag = String(resp.data).trim();
        if (/^b\d+$/.test(tag)) return tag;
      } catch {
        // 下载失败，降级到 body 解析
      }
    }

    const body = release.body || '';
    const m =
      body.match(/releases\/tag\/(b\d+)/) || body.match(/\b(b\d{2,})\b/);
    if (m) return m[1];

    throw new Error(
      `正式版 ${release.tag_name} 不含二进制资产，且无法解析 nightly 构建号`,
    );
  }

  async fetchLatestRelease(): Promise<void> {
    this.setStatus('正在获取最新版本信息...');
    const osName = this.selectedOS;
    const backend = this.selectedBackend;
    const keyword = GetBackendKeyword(osName, backend);

    // 第一段：releases/latest（现为语义化版本，如 v0.4.1）
    const release = await this.fetchRelease(GITHUB_API_URL, 'latest');
    let matched = this.matchAsset(release.assets, keyword);
    let matchedAssets: Asset[] = release.assets;
    this.latestReleaseTag = release.tag_name;

    if (matched) {
      // 正式版直接附带二进制（未来若恢复此形态则直接使用）
      this.latestTag = release.tag_name;
    } else {
      // 第二段：v0.4.x 起 latest 仅含 nightly-tag.txt，二进制挂在 nightly 预发布上
      const nightlyTag = await this.resolveNightlyTag(release);
      this.setStatus(
        `正式版 ${release.tag_name} 不含二进制，正在定位 nightly 构建 ${nightlyTag}...`,
      );
      const nightly = await this.fetchRelease(
        `${GITHUB_API_REPO_URL}/releases/tags/${encodeURIComponent(nightlyTag)}`,
        nightlyTag,
      );
      matched = this.matchAsset(nightly.assets, keyword);
      if (!matched) {
        throw new Error(
          `nightly ${nightlyTag} 中未找到 ${GetBackendLabel(osName, backend)} 版本 (关键词: ${keyword})`,
        );
      }
      matchedAssets = nightly.assets;
      this.latestTag = nightly.tag_name;
    }

    this.downloadURL = matched.browser_download_url;
    this.downloadSize = matched.size;
    this.assetName = matched.name;
    // sha256 sidecar：若 release 附带 `<资产名>.sha256` 则记录地址，下载后强制校验
    const sidecarName = `${matched.name}.sha256`;
    const sidecar = matchedAssets.find((a) => a.name === sidecarName);
    this.sha256URL = sidecar?.browser_download_url ?? '';
    const tagDesc =
      this.latestTag === this.latestReleaseTag
        ? this.latestTag
        : `${this.latestReleaseTag} (nightly ${this.latestTag})`;
    this.setStatus(
      `最新版本: ${tagDesc} (${formatSize(matched.size)}) [${GetBackendLabel(osName, backend)}]`,
    );
  }

  // ----- downloadAndExtract -----

  async downloadAndExtract(): Promise<void> {
    if (this.isDownloading) {
      throw new Error('正在下载中，请等待');
    }

    this.isDownloading = true;
    this.progress = 0;
    this.error = '';
    this.setStatus('准备中...');
    this.sampler.reset();
    this.downloadSpeed = 0;

    try {
      let url = this.downloadURL;
      let tag = this.latestTag;
      const osName = this.selectedOS;
      const backend = this.selectedBackend;
      let assetName = this.assetName;

      if (!url) {
        await this.fetchLatestRelease();
        url = this.downloadURL;
        tag = this.latestTag;
        assetName = this.assetName;
      }

      const downloadDirPath = DownloadDir();
      fs.mkdirSync(downloadDirPath, { recursive: true });

      const ext = getArchiveExt(assetName);
      // 文件名带架构标识，避免同 OS+后端下 x86/arm 包互相覆盖缓存
      const localFileName = `llama-${tag}-${osName}-${ARCH_LABEL}-${backend}${ext}`;
      const downloadFile = path.join(downloadDirPath, localFileName);

      let cached = false;
      if (fs.existsSync(downloadFile)) {
        cached = true;
        this.setStatus(`已存在本地缓存 ${localFileName}，跳过下载`);
      }

      if (!cached) {
        this.setStatus(`正在下载 ${localFileName} ...`);

        // 先写入 .part 临时文件，完成后再 rename 为正式文件名；
        // 中途失败的残包不会被下一轮当作有效缓存直接解压
        const partFile = `${downloadFile}.part`;
        const response = await axios.get(url, {
          responseType: 'stream',
          timeout: 0,
          proxy: this.proxyCfg(),
        });

        if (response.status !== 200) {
          throw new Error(`下载返回 ${response.status}`);
        }

        const writer = fs.createWriteStream(partFile);
        const totalSize =
          parseInt(String(response.headers['content-length']), 10) ||
          this.downloadSize;
        let downloaded = 0;

        await new Promise<void>((resolve, reject) => {
          // 显式失败标志：流/写盘任一报错后，close 回调绝不允许把残包
          // rename 成有效缓存名（否则下一轮直接解压坏包），必须删除 .part
          let failed = false;
          const fail = (err: Error) => {
            if (!failed) {
              failed = true;
              reject(err);
            }
          };

          response.data.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            this.downloadSpeed = this.sampler.update(downloaded);
            if (totalSize > 0) {
              this.setProgress(
                (downloaded / totalSize) * 100,
                Math.floor(downloaded / 1024),
                Math.floor(totalSize / 1024),
              );
            } else {
              this.setProgress(0, Math.floor(downloaded / 1024), 0);
            }
          });

          response.data.on('error', (err: Error) => {
            fail(err);
            writer.destroy();
          });

          writer.on('error', (err: Error) => {
            fail(err);
            writer.destroy();
          });

          // writer 'close' 在所有数据落盘后触发，此时 rename 才不会
          // 在 Windows 上因文件句柄未释放而失败
          writer.on('close', () => {
            if (failed) {
              // 残包绝不进入缓存文件名，删除 .part 后由外层展示错误
              try {
                fs.unlinkSync(partFile);
              } catch {
                // 文件可能不存在
              }
              return;
            }
            if (totalSize > 0 && downloaded < totalSize) {
              try {
                fs.unlinkSync(partFile);
              } catch {
                // ignore
              }
              reject(
                new Error(
                  `下载不完整（${downloaded}/${totalSize} 字节），已丢弃残包，请重试`,
                ),
              );
              return;
            }
            try {
              fs.renameSync(partFile, downloadFile);
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          response.data.pipe(writer);
        });
      }

      // sha256 校验（release 附带 sidecar 时）：缓存包同样校验，防坏包长期驻留
      if (this.sha256URL) {
        this.setStatus('正在校验 SHA256...');
        const expected = await this.fetchExpectedSha256();
        const actual = await sha256File(downloadFile);
        if (actual !== expected) {
          try {
            fs.unlinkSync(downloadFile);
          } catch {
            // ignore
          }
          throw new Error(
            `SHA256 校验失败（期望 ${expected.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…），已删除坏包，请重试`,
          );
        }
      }

      // 解压
      this.setStatus('正在解压到 core 目录...');
      const coreDir = CoreDir();
      fs.mkdirSync(coreDir, { recursive: true });

      await extractArchive(downloadFile, coreDir, (msg) => this.setStatus(msg));

      // 递归展平 exe/dll 到 core 根目录
      if (!CheckCoreExists()) {
        this.setStatus('正在整理文件...');
        walkAndFlatten(coreDir);
      }

      if (CheckCoreExists()) {
        this.setStatus(`✅ 更新完成！${tag} [${GetBackendLabel(osName, backend)}]`);
      } else {
        this.setStatus('⚠️ 解压完成但未找到 llama-server，请检查 core 目录');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError(msg);
      throw err;
    } finally {
      this.isDownloading = false;
      this.emitProgress(true);
    }
  }

  /** 下载 sidecar 文本并解析首个 64 位十六进制哈希 */
  private async fetchExpectedSha256(): Promise<string> {
    const resp = await axios.get<string>(this.sha256URL, {
      responseType: 'text',
      timeout: 15000,
      proxy: this.proxyCfg(),
    });
    const m = String(resp.data).trim().match(/\b[0-9a-f]{64}\b/i);
    if (!m) throw new Error('SHA256 校验文件内容无法解析');
    return m[0].toLowerCase();
  }

  // ----- extractSpecific -----

  async extractSpecific(filename: string): Promise<void> {
    if (this.isDownloading) {
      throw new Error('操作进行中，请等待');
    }

    this.isDownloading = true;
    this.progress = 0;
    this.error = '';
    this.setStatus('准备解压...');

    try {
      // filename 来自渲染进程，可能是任意字符串：仅取 basename 防止路径穿越，
      // 并确认解析后的路径确实位于 downloads 目录内
      const safeName = path.basename(filename);
      const downloadFile = path.join(DownloadDir(), safeName);
      if (
        safeName !== filename ||
        !downloadFile.startsWith(DownloadDir() + path.sep)
      ) {
        throw new Error(`非法文件名: ${filename}`);
      }
      if (!fs.existsSync(downloadFile)) {
        throw new Error(`文件不存在: ${filename}`);
      }

      this.setStatus(`正在解压 ${safeName} ...`);
      const coreDir = CoreDir();
      fs.mkdirSync(coreDir, { recursive: true });

      await extractArchive(downloadFile, coreDir, (msg) => this.setStatus(msg));

      if (!CheckCoreExists()) {
        walkAndFlatten(coreDir);
      }

      if (CheckCoreExists()) {
        this.setStatus(`✅ 解压完成！${filename}`);
      } else {
        this.setStatus('⚠️ 解压完成但未找到 llama-server');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError(msg);
      throw err;
    } finally {
      this.isDownloading = false;
      this.emitProgress(true);
    }
  }
}

// =============================================================================
// 递归展平二进制文件到目录根
// =============================================================================

function walkAndFlatten(dir: string, rootDir?: string): void {
  rootDir = rootDir || dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndFlatten(fullPath, rootDir);
    } else {
      // 解析 symlink：llama.cpp 发布包中 .so 通常是符号链接
      // （如 libggml.so → libggml.so.0 → libggml.so.0.0.0），
      // 需要跟随到实际文件再判断和移动，否则只移走了 symlink
      // 而实际 .so 文件留在子目录中
      let realName = entry.name;
      let realPath = fullPath;
      if (entry.isSymbolicLink()) {
        try {
          const linkTarget = fs.readlinkSync(fullPath);
          const resolved = path.resolve(path.dirname(fullPath), linkTarget);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            realName = path.basename(resolved);
            realPath = resolved;
          }
        } catch {
          continue; // 死链接，跳过
        }
      }

      if (isTargetBinary(realName)) {
        if (path.dirname(realPath) !== rootDir) {
          const dest = path.join(rootDir, realName);
          try {
            fs.unlinkSync(dest);
          } catch {
            // ignore
          }
          try {
            fs.renameSync(realPath, dest);
          } catch {
            copyFileSync(realPath, dest);
          }
        }
        // 非 Windows 平台：确保可执行权限
        if (process.platform !== 'win32') {
          try {
            const targetPath = path.dirname(realPath) !== rootDir ? path.join(rootDir, realName) : realPath;
            fs.chmodSync(targetPath, 0o755);
          } catch {
            // silently skip — 库文件 (.so) 保持 644 也可工作
          }
        }
      }
    }
  }
}
