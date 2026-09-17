import axios, { AxiosResponse } from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { EventEmitter } from 'events';
import tar from 'tar';
import AdmZip from 'adm-zip';
import { execSync, spawnSync } from 'child_process';
import {
  ReleaseInfo,
  Asset,
  UpdaterState,
} from '../shared/types';
import {
  GITHUB_API_URL,
  GITHUB_API_REPO_URL,
  CORE_DIR_NAME,
  DOWNLOAD_DIR_NAME,
  ARCH_LABEL,
  getBackendKeyword,
  getBackendLabel,
  isBackendAvailable,
  type GpuBackend,
} from '../shared/constants';

// =============================================================================
// 路径辅助 — 从 paths.ts 导入统一的基础路径
// =============================================================================

import { getAppBaseDir, getCoreDir, getDownloadDir, getServerExePath } from './paths';

export function CoreDir(): string { return getCoreDir(); }
export function DownloadDir(): string { return getDownloadDir(); }
export { getServerExePath };

export function CheckCoreExists(): boolean {
  return fs.existsSync(getServerExePath());
}

export function GetLocalVersion(): string {
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

  // 刚更新完的 exe 可能被杀软短暂锁定导致 spawn 失败，重试一次
  const MAX_ATTEMPTS = 2;
  let lastErr = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // llama.cpp 把版本号输出到 stderr；用 spawnSync 直接收 stderr，
      // 不依赖 shell 的 2>&1 重定向，也不会因非零退出码抛异常
      const result = spawnSync(exePath, ['--version'], {
        timeout: 5000,
        encoding: 'utf-8',
        cwd: coreDir,
        env,
        windowsHide: true,
      });

      // 优先 stderr（llama.cpp 惯例），其次 stdout
      const raw = (result.stderr || result.stdout || '').trim();
      if (raw) {
        const first = raw.split(/\r?\n/)[0] || '';
        // 只显示构建号（如 "version: 6119 (b10964)" → "b10964"），
        // 完整输出版本信息过长，不适合 UI 展示
        const m = first.match(/\bb\d{3,}\b/i);
        return m ? m[0].toLowerCase() : first;
      }
      lastErr = result.error ? result.error.message : `exit=${result.status}`;
      console.error(`[GetLocalVersion] 第 ${attempt} 次无输出:`, lastErr);
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error(`[GetLocalVersion] 第 ${attempt} 次失败:`, lastErr);
    }

    if (attempt < MAX_ATTEMPTS) sleepSync(800);
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
// 代理地址解析
// =============================================================================

function extractProxyHost(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return u.hostname;
  } catch {
    return '127.0.0.1';
  }
}

function extractProxyPort(proxyUrl: string): number {
  try {
    const u = new URL(proxyUrl);
    return parseInt(u.port, 10) || 7890;
  } catch {
    return 7890;
  }
}

// =============================================================================
// 压缩包辅助
// =============================================================================

function getArchiveExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  if (lower.endsWith('.tgz')) return '.tar.gz';
  return path.extname(name);
}

// =============================================================================
// 7z magic 校验 (37 7A BC AF 27 1C)
// =============================================================================

function is7zFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(6);
    fs.readSync(fd, buf, 0, 6, 0);
    fs.closeSync(fd);
    return (
      buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc &&
      buf[3] === 0xaf && buf[4] === 0x27  && buf[5] === 0x1c
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// isTargetBinary — 按平台判断是否为 llama.cpp 二进制/库文件
//   Windows: .exe / .dll
//   Linux:   无后缀可执行 (llama-* / rpc-* 等) / .so
//   macOS:   无后缀可执行 / .so / .dylib
// ---------------------------------------------------------------------------

function isTargetBinary(fileName: string, stat?: { mode?: number }): boolean {
  const lower = fileName.toLowerCase();
  if (process.platform === 'win32') {
    return lower.endsWith('.exe') || lower.endsWith('.dll');
  }
  // 共享库 (Linux / macOS) — 含版本后缀如 .so.0 / .so.0.0.0 / .dylib
  if (/\.(so|dylib)(\.\d+)*$/.test(lower)) return true;
  // 可执行文件 — 按已知 llama.cpp 二进制前缀匹配
  if (/^(llama|rpc|ggml|test-|embedding|retrieval|quantize|perplexity|server|imatrix|tokenize|batched|bench|convert|finetune|save|export-lora)/.test(lower)) return true;
  // tar.gz 流中有 stat，按可执行权限位兜底
  if (stat?.mode && (stat.mode & 0o111) !== 0) return true;
  return false;
}

/** 按平台生成「找不到二进制文件」的错误信息 */
function noBinaryError(format: string): string {
  const desc = process.platform === 'win32' ? 'exe/dll' : '可执行文件/共享库(.so)';
  return `${format} 中未找到任何 ${desc} 文件`;
}

function copyFileSync(src: string, dst: string): void {
  fs.copyFileSync(src, dst);
}

// =============================================================================
// 解压入口 — 根据扩展名分发
// =============================================================================

async function extractArchive(
  src: string,
  dst: string,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const lower = src.toLowerCase();
  if (lower.endsWith('.zip')) {
    extractZipSync(src, dst, onStatus);
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await extractTarGz(src, dst, onStatus);
  } else {
    extract7zSync(src, dst, onStatus);
  }
}

// ---------------------------------------------------------------------------
// extractZipSync
//   Windows 上目标文件可能被占用（llama-server 运行中 / Defender 短暂锁定），
//   逐条重试并显式上报失败，绝不允许静默跳过 — 否则旧二进制保留、
//   版本探查读到旧版本号，用户会看到"更新完成"但版本未变
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  // Atomics.wait 可在同步代码中休眠且不阻塞事件循环之外的东西
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // 环境不支持时退化为忙等（仅重试场景，最多数百毫秒）
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

function extractZipSync(
  src: string,
  dst: string,
  onStatus?: (msg: string) => void,
): void {
  const zip = new AdmZip(src);
  const entries = zip.getEntries();
  let count = 0;
  const failed: string[] = [];
  const MAX_ATTEMPTS = 3;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const baseName = path.basename(entry.entryName);
    if (!isTargetBinary(baseName)) continue;

    onStatus?.(`提取: ${baseName}`);

    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        zip.extractEntryTo(entry, dst, false, true, false, baseName);
        ok = true;
        count++;
      } catch (err: unknown) {
        if (attempt < MAX_ATTEMPTS) {
          onStatus?.(`提取 ${baseName} 失败（第 ${attempt} 次），重试中...`);
          sleepSync(400);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          failed.push(`${baseName}: ${msg}`);
        }
      }
    }
  }

  if (count === 0) {
    throw new Error(noBinaryError('zip'));
  }
  if (failed.length > 0) {
    throw new Error(
      `以下文件解压失败（文件可能被占用，请先停止正在运行的 llama-server 再更新）:\n${failed.join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// extractTarGz (async — tar.extract is stream-based)
// ---------------------------------------------------------------------------

async function extractTarGz(
  src: string,
  dst: string,
  onStatus?: (msg: string) => void,
): Promise<void> {
  let count = 0;

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(src)
      .pipe(zlib.createGunzip())
      .pipe(
        tar.extract({
          cwd: dst,
          filter: (_filePath: string, stat: tar.FileStat) => {
            if (stat.type === 'Directory') return false;
            const baseName = path.basename(_filePath);
            if (!isTargetBinary(baseName, { mode: stat.mode as number | undefined })) return false;
            onStatus?.(`提取: ${baseName}`);
            count++;
            return true;
          },
        }),
      )
      .on('finish', () => {
        if (count === 0) {
          reject(new Error(noBinaryError('tar.gz')));
        } else {
          resolve();
        }
      })
      .on('error', (err: Error) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// extract7zSync
// ---------------------------------------------------------------------------

function extract7zSync(
  src: string,
  dst: string,
  onStatus?: (msg: string) => void,
): void {
  if (!is7zFile(src)) {
    throw new Error(
      `文件不是有效的 7z 格式，可能下载不完整，请删除 ${path.basename(src)} 后重试`,
    );
  }

  // 优先 core/7za(win:.exe)，其次 PATH 中的 7z
  let sevenZipExe: string;
  const sevenZipName = process.platform === 'win32' ? '7za.exe' : '7za';
  const local7za = path.join(CoreDir(), sevenZipName);
  if (fs.existsSync(local7za)) {
    sevenZipExe = local7za;
  } else {
    sevenZipExe = '7z';
  }

  onStatus?.('正在使用 7z 解压...');

  // 列出包内文件，筛选目标二进制
  let listOutput: string;
  try {
    listOutput = execSync(`"${sevenZipExe}" l -ba "${src}"`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`7z 列表失败: ${msg}`);
  }

  const targetNames: string[] = [];
  for (const line of listOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 7z l 输出格式: "....A ....          123456  2024-01-01 00:00:00  path/to/file.exe"
    // 使用正则表达式提取文件名（从最后日期时间后的空格开始）
    const match = trimmed.match(/^[.\s]+[.\s]+\s+\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.+)$/);
    if (!match || !match[1]) continue;
    const filePath = match[1].trim();
    if (isTargetBinary(path.basename(filePath))) {
      targetNames.push(filePath);
    }
  }

  if (targetNames.length === 0) {
    throw new Error(noBinaryError('7z'));
  }

  // 逐个提取
  for (const name of targetNames) {
    const baseName = path.basename(name);
    const targetPath = path.join(dst, baseName);
    onStatus?.(`提取: ${baseName}`);

    try {
      execSync(`"${sevenZipExe}" x -y -o"${dst}" "${src}" "${name}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`7z 提取 ${baseName} 失败: ${msg}`);
    }

    // 若被解压到子目录，移动到根
    const extractedPath = path.join(dst, name);
    if (extractedPath !== targetPath && fs.existsSync(extractedPath)) {
      try {
        fs.renameSync(extractedPath, targetPath);
      } catch {
        copyFileSync(extractedPath, targetPath);
      }
    }
  }
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

  // 下载速度计算
  private _lastBytes = 0;
  private _lastTime = 0;

  // ----- getters / setters -----

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
  }

  setStatus(s: string): void {
    const changed = s !== this.status;
    this.status = s;
    // 状态变化时发出日志，供 LogViewer 页面展示（ipc-handlers 加 [core] 前缀转发）
    if (changed && s) {
      this.emit('log', s);
    }
  }

  setError(e: string): void {
    this.error = e;
    this.status = `❌ ${e}`;
    this.emit('log', `❌ ${e}`);
  }

  // ----- proxy -----

  setProxy(url: string): void {
    this.proxyUrl = url;
  }

  // ----- fetchLatestRelease -----

  private axiosHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': 'llama-launcher/1.0',
    };
  }

  private axiosProxyConfig() {
    return this.proxyUrl
      ? { host: extractProxyHost(this.proxyUrl), port: extractProxyPort(this.proxyUrl), protocol: 'http' }
      : false;
  }

  /** 请求指定 GitHub release API 端点 */
  private async fetchRelease(url: string, label: string): Promise<ReleaseInfo> {
    let resp: AxiosResponse<ReleaseInfo>;
    try {
      resp = await axios.get<ReleaseInfo>(url, {
        headers: this.axiosHeaders(),
        timeout: 30000,
        proxy: this.axiosProxyConfig(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`请求 GitHub API 失败 (${label}): ${msg}`);
    }

    if (resp.status !== 200) {
      throw new Error(`GitHub API 返回 ${resp.status} (${label})`);
    }
    return resp.data;
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
          proxy: this.axiosProxyConfig(),
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
      this.latestTag = nightly.tag_name;
    }

    this.downloadURL = matched.browser_download_url;
    this.downloadSize = matched.size;
    this.assetName = matched.name;
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
    this.downloadSpeed = 0;
    this._lastBytes = 0;
    this._lastTime = 0;

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

        const response = await axios.get(url, {
          responseType: 'stream',
          timeout: 0,
          proxy: this.proxyUrl ? { host: extractProxyHost(this.proxyUrl), port: extractProxyPort(this.proxyUrl), protocol: 'http' } : false,
        });

        if (response.status !== 200) {
          throw new Error(`下载返回 ${response.status}`);
        }

        const writer = fs.createWriteStream(downloadFile);
        let totalSize =
          parseInt(String(response.headers['content-length']), 10) ||
          this.downloadSize;
        let downloaded = 0;

        await new Promise<void>((resolve, reject) => {
          response.data.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const now = Date.now();
            if (this._lastTime === 0) {
              this._lastTime = now;
              this._lastBytes = downloaded;
            } else {
              const elapsed = (now - this._lastTime) / 1000; // 秒
              const diffBytes = downloaded - this._lastBytes;
              if (elapsed > 0) {
                this.downloadSpeed = Math.round((diffBytes / 1024) / elapsed); // KB/s
              }
              this._lastTime = now;
              this._lastBytes = downloaded;
            }
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

          response.data.on('end', () => {
            this.setProgress(
              100,
              Math.floor(downloaded / 1024),
              totalSize > 0 ? Math.floor(totalSize / 1024) : 0,
            );
            resolve();
          });

          response.data.on('error', (err: Error) => {
            writer.close();
            reject(err);
          });

          response.data.pipe(writer);
        });
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
    }
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
      const downloadFile = path.join(DownloadDir(), filename);
      if (!fs.existsSync(downloadFile)) {
        throw new Error(`文件不存在: ${filename}`);
      }

      this.setStatus(`正在解压 ${filename} ...`);
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
