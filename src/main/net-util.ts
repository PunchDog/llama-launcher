// =============================================================================
// net-util — 主进程网络公共工具（唯一实现，core-updater / model-downloader 共用）
//   resolveProxy   — 代理 URL → axios proxy 配置（原先三套解析规则合并）
//   SpeedSampler   — 下载速度采样（KB/s，0.5s 最小刷新间隔防抖）
//   ghFetch        — GitHub API 抓取：内存 ETag 缓存(304 免流量) + 403/429 限流处理
// =============================================================================

import axios from 'axios';

export interface AxiosProxyConfig {
  host: string;
  port: number;
  protocol: 'http' | 'https';
}

/**
 * 解析代理 URL（如 http://127.0.0.1:7890）为 axios proxy 配置。
 * 空串/非法 URL 返回 false（axios 约定：false = 不走代理）。
 * 未写端口时按协议默认端口（http 80 / https 443），无协议前缀时按裸 host:port 解析。
 */
export function resolveProxy(proxyUrl: string): AxiosProxyConfig | false {
  if (!proxyUrl) return false;
  try {
    const u = new URL(proxyUrl);
    const protocol = u.protocol === 'https:' ? 'https' : 'http';
    const port = parseInt(u.port, 10) || (protocol === 'https' ? 443 : 80);
    if (!u.hostname || !Number.isFinite(port) || port <= 0 || port > 65535) return false;
    return { host: u.hostname, port, protocol };
  } catch {
    // 允许 "127.0.0.1:7890" 这类无 scheme 写法
    const m = /^([^:/\s]+):(\d{1,5})$/.exec(proxyUrl.trim());
    if (m) {
      const port = parseInt(m[2], 10);
      if (port > 0 && port <= 65535) return { host: m[1], port, protocol: 'http' };
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// SpeedSampler — 累计字节增量采样，至少间隔 500ms 才刷新一次速度
// ---------------------------------------------------------------------------

export class SpeedSampler {
  private lastBytes = 0;
  private lastTime = 0;
  /** KB/s */
  speed = 0;

  reset(): void {
    this.lastBytes = 0;
    this.lastTime = 0;
    this.speed = 0;
  }

  /** 用「累计已下载字节」更新采样；返回当前 KB/s */
  update(totalBytes: number): number {
    const now = Date.now();
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.lastBytes = totalBytes;
      return this.speed;
    }
    const elapsed = (now - this.lastTime) / 1000;
    if (elapsed < 0.5) return this.speed;
    const diff = totalBytes - this.lastBytes;
    this.speed = diff > 0 ? Math.round(diff / 1024 / elapsed) : 0;
    this.lastTime = now;
    this.lastBytes = totalBytes;
    return this.speed;
  }
}

// ---------------------------------------------------------------------------
// ghFetch — GitHub API GET（带 ETag 条件缓存与限流友好报错）
// ---------------------------------------------------------------------------

interface EtagCacheEntry {
  etag: string;
  data: unknown;
}

const etagCache = new Map<string, EtagCacheEntry>();

export class GitHubRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfterSeconds(resp: AxiosResponseLike): number {
  const v = resp.headers['retry-after'];
  const n = parseInt(Array.isArray(v) ? v[0] : v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface AxiosResponseLike {
  status: number;
  headers: Record<string, unknown>;
  data: unknown;
}

/**
 * 抓取 GitHub API JSON 资源。
 * - 命中缓存时带 If-None-Match，304 直接复用缓存数据（不消耗限流配额的响应体）
 * - 403/429：解析 Retry-After，15s 以内自动等待重试一次，否则抛出带等待时长的明确错误
 */
export async function ghFetch<T>(url: string, proxy: AxiosProxyConfig | false): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'llama-launcher/1.0',
  };
  const cached = etagCache.get(url);
  if (cached) headers['If-None-Match'] = cached.etag;

  const request = async (): Promise<AxiosResponseLike> => {
    try {
      const resp = await axios.get<T>(url, { headers, timeout: 30000, proxy, validateStatus: () => true });
      return { status: resp.status, headers: resp.headers as Record<string, unknown>, data: resp.data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`请求 GitHub API 失败 (${url}): ${msg}`, { cause: err });
    }
  };

  let resp = await request();

  if (resp.status === 403 || resp.status === 429) {
    const wait = retryAfterSeconds(resp);
    if (wait > 0 && wait <= 15) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      resp = await request();
    } else {
      throw new GitHubRateLimitError(
        resp.status === 429
          ? `GitHub API 触发速率限制，请 ${wait > 0 ? `${wait} 秒后` : '稍后'}重试`
          : `GitHub API 拒绝访问（403，通常为本机 IP 未认证限流），请配置代理或稍后重试`,
        wait,
      );
    }
  }

  if (resp.status === 304 && cached) {
    return cached.data as T;
  }
  if (resp.status !== 200) {
    throw new Error(`GitHub API 返回 ${resp.status} (${url})`);
  }
  const etag = resp.headers.etag;
  if (typeof etag === 'string' && etag) {
    etagCache.set(url, { etag, data: resp.data });
  }
  return resp.data as T;
}

/** 清空 ETag 缓存（切换代理/后端后可调用，避免拿到旧缓存） */
export function clearGhCache(): void {
  etagCache.clear();
}
