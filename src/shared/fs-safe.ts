// =============================================================================
// 文件系统安全工具 — 路径穿越防护 / 命令行参数注入防护 / 原子写入
//   下载文件名、解压条目名等「来自远端的数据」在拼接落盘路径前必须过 safeJoin
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';

/**
 * 把不受信任的相对路径安全地拼接到根目录下。
 * 拒绝：绝对路径、盘符、UNC、`..` 穿越、控制字符。
 * 通过 path.resolve 归一化后再次断言结果仍在 root 内（双重防护）。
 * @throws 路径不合法或穿越根目录时抛出 Error
 */
export function safeJoin(root: string, untrusted: string): string {
  if (typeof untrusted !== 'string' || untrusted.length === 0) {
    throw new Error('非法路径：空字符串');
  }
  // 控制字符（含 NUL 截断攻击）与 DEL
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(untrusted)) {
    throw new Error(`非法路径：包含控制字符: ${JSON.stringify(untrusted)}`);
  }
  // 绝对路径 / 盘符 / UNC（Windows 与 POSIX 都检查）
  if (
    path.isAbsolute(untrusted) ||
    /^[a-zA-Z]:[\\/]/.test(untrusted) ||
    untrusted.startsWith('\\\\') ||
    untrusted.startsWith('//')
  ) {
    throw new Error(`非法路径：不允许绝对路径: ${untrusted}`);
  }

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, untrusted);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`非法路径：检测到目录穿越: ${untrusted}`);
  }
  return target;
}

/**
 * 校验将作为子进程位置参数传递的字符串（文件名/路径），
 * 拒绝以 `-` 或 `/` 开头的值，防止被解析成命令行选项（参数注入）。
 * @throws 值可能被当作选项时抛出 Error
 */
export function assertSafeArg(value: string, label = '参数'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`非法${label}：空字符串`);
  }
  if (value.startsWith('-') || value.startsWith('/')) {
    throw new Error(`非法${label}：不允许以 - 或 / 开头: ${value}`);
  }
  return value;
}

/** 过滤出非空字符串数组，供 spawn 参数列表兜底使用 */
export function normalizeCliArgs(args: readonly unknown[]): string[] {
  return args.filter((a): a is string => typeof a === 'string' && a.length > 0);
}

/** 生成同目录唯一临时文件名（pid + 计数器 + 随机后缀防碰撞） */
let tmpCounter = 0;
function tmpPathFor(filePath: string): string {
  tmpCounter = (tmpCounter + 1) % 1000;
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${filePath}.${process.pid}.${tmpCounter}.${rand}.tmp`;
}

/**
 * 原子写入（同步版）：先写同目录临时文件再 rename。
 * 避免写入中途崩溃/断电留下半截 config.json。
 */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): void {
  const tmp = tmpPathFor(filePath);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 临时文件可能未创建，忽略
    }
    throw err;
  }
}

/** 原子写入（异步版），语义同 writeFileAtomic */
export async function writeFileAtomicAsync(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const tmp = tmpPathFor(filePath);
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      // 忽略清理失败
    }
    throw err;
  }
}
