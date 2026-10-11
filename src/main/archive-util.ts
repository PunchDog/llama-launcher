// =============================================================================
// archive-util — llama.cpp 发布包的落盘辅助（解压在 extract-worker 线程，
//   这里只留主进程侧的调度与校验）
//   extractArchive — 把解压派给 Worker，主进程只收状态/结果消息
//   sha256File     — 流式哈希，数百 MB 包不整读进内存
//   walkAndFlatten — 递归展平 exe/dll/.so 到 core 根目录（llama.cpp 包内
//                    二进制藏在 gpu 子目录且 .so 多为符号链接）
// =============================================================================

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import { Worker } from 'worker_threads';
import { getCoreDir, getDownloadDir, exeName } from './paths';
import { isTargetBinary } from './archive-shared';

export function getArchiveExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  if (lower.endsWith('.tgz')) return '.tar.gz';
  return path.extname(name);
}

/** 优先 core/7za(win: .exe)，找不到则回退 PATH 中的 7z（由主进程解析，Worker 无 electron） */
function resolveSevenZipExe(): string | undefined {
  const local = path.join(getCoreDir(), exeName('7za'));
  return fs.existsSync(local) ? local : undefined;
}

export async function extractArchive(
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

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d: Buffer) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err: Error) => reject(err));
  });
}

/** downloads 目录里的发布包文件名，降序（最新在前） */
export function ListDownloadedFiles(): string[] {
  const dir = getDownloadDir();
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

/**
 * 递归展平二进制文件到目录根。
 * llama.cpp 发布包中 .so 通常是符号链接
 * （如 libggml.so → libggml.so.0 → libggml.so.0.0.0），
 * 需要跟随到实际文件再判断和移动，否则只移走了 symlink
 * 而实际 .so 文件留在子目录中。
 * 全异步 fs.promises：core 树可达数千条目，同步递归会卡住主进程事件循环。
 */
export async function walkAndFlatten(dir: string, rootDir?: string): Promise<void> {
  rootDir = rootDir || dir;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndFlatten(fullPath, rootDir);
      continue;
    }

    // 解析 symlink：llama.cpp 发布包中 .so 通常是符号链接
    // （如 libggml.so → libggml.so.0 → libggml.so.0.0.0），
    // 需要跟随到实际文件再判断和移动，否则只移走了 symlink
    // 而实际 .so 文件留在子目录中
    let realName = entry.name;
    let realPath = fullPath;
    if (entry.isSymbolicLink()) {
      try {
        const linkTarget = await fsp.readlink(fullPath);
        const resolved = path.resolve(path.dirname(fullPath), linkTarget);
        try {
          const st = await fsp.stat(resolved);
          if (st.isFile()) {
            realName = path.basename(resolved);
            realPath = resolved;
          }
        } catch {
          // 链接目标不存在：与旧的 existsSync 分支一致，按原路径继续判定
        }
      } catch {
        continue; // 死链接，跳过
      }
    }

    if (!isTargetBinary(realName)) continue;

    const moved = path.dirname(realPath) !== rootDir;
    const finalPath = moved ? path.join(rootDir, realName) : realPath;
    if (moved) {
      await fsp.rm(finalPath, { force: true });
      try {
        await fsp.rename(realPath, finalPath);
      } catch {
        // 跨卷（临时目录与目标不同盘）rename 失败时退化为复制
        await fsp.copyFile(realPath, finalPath);
      }
    }
    // 非 Windows 平台：确保可执行权限
    if (process.platform !== 'win32') {
      try {
        await fsp.chmod(finalPath, 0o755);
      } catch {
        // silently skip — 库文件 (.so) 保持 644 也可工作
      }
    }
  }
}
