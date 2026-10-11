import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
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
import { downloadToPartFile } from './part-download';
import {
  getArchiveExt,
  extractArchive,
  sha256File,
  walkAndFlatten,
} from './archive-util';
import { CheckCoreExists } from './version-probe';
import { safeJoin } from '../shared/fs-safe';
import { getCoreDir, getDownloadDir } from './paths';
import { errMsg } from '../shared/errors';

// =============================================================================
// formatSize — 仅用于「最新版本」状态文案里的包体积
// =============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  /** 进行中的下载流中止句柄（应用退出时 abort，保留 .part 供续传） */
  private _abort: AbortController | null = null;
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
      const msg = errMsg(err);
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
    const backend = this.selectedBackend;
    const keyword = getBackendKeyword(backend, process.platform);

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
          `nightly ${nightlyTag} 中未找到 ${getBackendLabel(backend, process.platform)} 版本 (关键词: ${keyword})`,
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
      `最新版本: ${tagDesc} (${formatSize(matched.size)}) [${getBackendLabel(backend, process.platform)}]`,
    );
  }

  // ----- downloadAndExtract -----

  async downloadAndExtract(): Promise<void> {
    if (this.isDownloading) {
      throw new Error('正在下载中，请等待');
    }

    this.isDownloading = true;
    this._abort = new AbortController();
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

      const downloadDirPath = getDownloadDir();
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
        await downloadToPartFile({
          url,
          dest: downloadFile,
          proxy: this.proxyCfg(),
          signal: this._abort?.signal,
          expectedSize: this.downloadSize,
          onProgress: (_inc, downloaded, totalSize) => {
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
          },
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
      const coreDir = getCoreDir();
      fs.mkdirSync(coreDir, { recursive: true });

      await extractArchive(downloadFile, coreDir, (msg) => this.setStatus(msg));

      // 递归展平 exe/dll 到 core 根目录
      if (!CheckCoreExists()) {
        this.setStatus('正在整理文件...');
        await walkAndFlatten(coreDir);
      }

      if (CheckCoreExists()) {
        this.setStatus(`✅ 更新完成！${tag} [${getBackendLabel(backend, process.platform)}]`);
      } else {
        this.setStatus('⚠️ 解压完成但未找到 llama-server，请检查 core 目录');
      }
    } catch (err: unknown) {
      const msg = errMsg(err);
      this.setError(msg);
      throw err;
    } finally {
      this._abort = null;
      this.isDownloading = false;
      this.emitProgress(true);
    }
  }

  /** 应用退出：掐断进行中的下载流；残包按 .part 规则保留 */
  abort(): void {
    this._abort?.abort();
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
      // filename 来自渲染进程，可能是任意字符串：只收纯文件名，
      // 拼接统一过 safeJoin（fs-safe），解析结果必须位于 downloads 目录内
      const safeName = path.basename(filename);
      if (safeName !== filename) {
        throw new Error(`非法文件名: ${filename}`);
      }
      const downloadFile = safeJoin(getDownloadDir(), safeName);
      if (!fs.existsSync(downloadFile)) {
        throw new Error(`文件不存在: ${filename}`);
      }

      this.setStatus(`正在解压 ${safeName} ...`);
      const coreDir = getCoreDir();
      fs.mkdirSync(coreDir, { recursive: true });

      await extractArchive(downloadFile, coreDir, (msg) => this.setStatus(msg));

      if (!CheckCoreExists()) {
        await walkAndFlatten(coreDir);
      }

      if (CheckCoreExists()) {
        this.setStatus(`✅ 解压完成！${filename}`);
      } else {
        this.setStatus('⚠️ 解压完成但未找到 llama-server');
      }
    } catch (err: unknown) {
      const msg = errMsg(err);
      this.setError(msg);
      throw err;
    } finally {
      this.isDownloading = false;
      this.emitProgress(true);
    }
  }
}
