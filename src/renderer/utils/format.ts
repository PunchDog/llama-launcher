// =============================================================================
// format — 下载体积/速度的动态单位格式化（Core 管理与模型下载共用）
// =============================================================================

/** 动态格式化字节数：自动切换 B, KB, MB, GB */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 动态格式化速度（入参 KB/s）：根据数值大小自动切换 B/s, KB/s, MB/s, GB/s */
export function formatSpeed(kbps: number): string {
  if (kbps <= 0) return '0 B/s';
  const bytesPerSec = kbps * 1024;
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${kbps.toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(kbps / 1024).toFixed(2)} MB/s`;
  return `${(kbps / (1024 * 1024)).toFixed(2)} GB/s`;
}
