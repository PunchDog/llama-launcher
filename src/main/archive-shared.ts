// =============================================================================
// archive-shared — 主进程与解压 Worker 线程共用的压缩包判定逻辑
//   （Worker 线程无法 require('electron')，不能复用 paths.ts，
//     因此这里只放纯函数与纯 IO 判断）
// =============================================================================

import * as fs from 'fs';

// ---------------------------------------------------------------------------
// 7z magic 校验 (37 7A BC AF 27 1C)
// ---------------------------------------------------------------------------

export function is7zFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(6);
      fs.readSync(fd, buf, 0, 6, 0);
      return (
        buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc &&
        buf[3] === 0xaf && buf[4] === 0x27 && buf[5] === 0x1c
      );
    } finally {
      fs.closeSync(fd);
    }
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

export function isTargetBinary(fileName: string, stat?: { mode?: number }): boolean {
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
export function noBinaryError(format: string): string {
  const desc = process.platform === 'win32' ? 'exe/dll' : '可执行文件/共享库(.so)';
  return `${format} 中未找到任何 ${desc} 文件`;
}
