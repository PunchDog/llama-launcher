// =============================================================================
// Extract Worker — 在独立线程中解压 llama.cpp 发布包，主进程事件循环零阻塞
// =============================================================================
// 入参: { op: 'extract', src, dst, sevenZipExe? }
//   sevenZipExe 由主进程解析后传入（Worker 无法加载 electron，用不了 paths.ts）
// 回传: {type:'status',msg} 进度文案 / {type:'done'} 成功 / {type:'error',message}
//
// 为什么放 Worker：
//   adm-zip 只有同步 API，数百 MB 的 zip 解压 + Windows 文件占用重试的
//   sleepSync 会在主线程冻结 UI 数秒（🟠17）；7z 需 spawn 外部进程并
//   整理临时目录，同样含同步递归 IO。移入 Worker 后主线程只收状态消息。

import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import tar from 'tar';
import { safeJoin } from '../shared/fs-safe';
import { is7zFile, isTargetBinary, noBinaryError } from './archive-shared';

interface ExtractRequest {
  op: 'extract';
  src: string;
  dst: string;
  sevenZipExe?: string;
}

function post(type: string, extra?: Record<string, unknown>): void {
  parentPort?.postMessage({ type, ...extra });
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

// ---------------------------------------------------------------------------
// zip — 逐条提取目标二进制，Windows 文件占用时重试并显式上报失败
// ---------------------------------------------------------------------------

function extractZip(src: string, dst: string, onStatus: (msg: string) => void): void {
  const zip = new AdmZip(src);
  const entries = zip.getEntries();
  let count = 0;
  const failed: string[] = [];
  const MAX_ATTEMPTS = 3;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const baseName = path.basename(entry.entryName);
    if (!isTargetBinary(baseName)) continue;

    onStatus(`提取: ${baseName}`);

    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try {
        zip.extractEntryTo(entry, dst, false, true, false, baseName);
        ok = true;
        count++;
      } catch (err: unknown) {
        if (attempt < MAX_ATTEMPTS) {
          onStatus(`提取 ${baseName} 失败（第 ${attempt} 次），重试中...`);
          sleepSync(400);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          failed.push(`${baseName}: ${msg}`);
        }
      }
    }
  }

  if (count === 0) throw new Error(noBinaryError('zip'));
  if (failed.length > 0) {
    throw new Error(
      `以下文件解压失败（文件可能被占用，请先停止正在运行的 llama-server 再更新）:\n${failed.join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// tar.gz — 流式解压，按 basename 过滤目标文件
// ---------------------------------------------------------------------------

async function extractTarGz(src: string, dst: string, onStatus: (msg: string) => void): Promise<void> {
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
            onStatus(`提取: ${baseName}`);
            count++;
            return true;
          },
        }),
      )
      .on('finish', () => {
        if (count === 0) reject(new Error(noBinaryError('tar.gz')));
        else resolve();
      })
      .on('error', (err: Error) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// 7z — 全解到临时目录，再把白名单文件搬回目标目录
//   不再解析 `7z l` 文本输出（列格式一变解析就静默漏文件），
//   搬回统一过 safeJoin 防条目名穿越
// ---------------------------------------------------------------------------

function spawn7z(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', (err) => reject(new Error(`启动 ${exe} 失败: ${err.message}（未找到 7z 工具？请安装 7-Zip 或将 7za.exe 放入 core 目录）`)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${exe} 退出码 ${code}`));
    });
  });
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

async function extract7z(src: string, dst: string, sevenZipExe: string | undefined, onStatus: (msg: string) => void): Promise<void> {
  if (!is7zFile(src)) {
    throw new Error(
      `文件不是有效的 7z 格式，可能下载不完整，请删除 ${path.basename(src)} 后重试`,
    );
  }
  const exe = sevenZipExe || '7z';
  onStatus('正在使用 7z 解压...');

  const tmpDir = `${dst}.7ztmp-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    await spawn7z(exe, ['x', '-y', `-o${tmpDir}`, src]);

    let count = 0;
    for (const file of walkFiles(tmpDir)) {
      const baseName = path.basename(file);
      if (!isTargetBinary(baseName)) continue;
      const target = safeJoin(dst, baseName);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      onStatus(`提取: ${baseName}`);
      try {
        fs.renameSync(file, target);
      } catch {
        // 跨卷（临时目录与目标不同盘）rename 失败时退化为复制
        fs.copyFileSync(file, target);
      }
      count++;
    }
    if (count === 0) throw new Error(noBinaryError('7z'));
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响解压结果
    }
  }
}

// ---------------------------------------------------------------------------
// 消息循环
// ---------------------------------------------------------------------------

parentPort?.on('message', async (req: ExtractRequest) => {
  if (!req || req.op !== 'extract') return;
  const onStatus = (msg: string) => post('status', { msg });
  try {
    fs.mkdirSync(req.dst, { recursive: true });
    const lower = req.src.toLowerCase();
    if (lower.endsWith('.zip')) {
      extractZip(req.src, req.dst, onStatus);
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      await extractTarGz(req.src, req.dst, onStatus);
    } else {
      await extract7z(req.src, req.dst, req.sevenZipExe, onStatus);
    }
    post('done');
  } catch (err: unknown) {
    post('error', { message: err instanceof Error ? err.message : String(err) });
  }
});

post('ready');
