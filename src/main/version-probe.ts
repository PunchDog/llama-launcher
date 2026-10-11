// =============================================================================
// version-probe — core 目录探测与本地 llama-server 版本读取
//   异步 execFile：spawnSync + sleepSync 会冻结主进程事件循环最长 6 秒
//   （日志流、下载进度、窗口交互全部停摆），必须避免。
// =============================================================================

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { getServerExePath } from './paths';
import { prependCoreLibPath } from './child-env';

export function CheckCoreExists(): boolean {
  return fs.existsSync(getServerExePath());
}

/** 读取本地 llama-server 版本号，输出形如 "b10964"；未安装/无法解析时给中文提示 */
export async function GetLocalVersion(): Promise<string> {
  if (!CheckCoreExists()) return '未安装';

  const exePath = getServerExePath();
  const coreDir = path.dirname(exePath);

  // 非 Windows：需要把 core 目录加入 LD_LIBRARY_PATH，
  // 否则 llama-server 找不到同目录的 .so 库文件
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  prependCoreLibPath(env, coreDir);

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
      if (m) return m[0].toLowerCase();
      // 新版 llama-server 输出 "version: 10964 (84930fa4)"（纯构建号+commit），
      // 归一为 "b10964"：UI 显示与 nightly tag 同口径
      const n = first.match(/version:\s*(\d{3,})/i);
      if (n) return `b${n[1]}`;
      return first;
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
