// =============================================================================
// modelscope-env — Python / modelscope CLI 探测与子进程环境（全异步）
//   spawnSync 会冻结主进程事件循环最长数秒，这里一律 execFile/spawn 异步；
//   ModelDownloader 只保留状态缓存与事件推送，探测细节在此。
// =============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { exeName } from './paths';

export interface PythonInfo {
  path: string;
  version: string;
}

/** execFile 包装：永不 reject，返回退出码与输出；超时/无法启动以 code=-1 表示 */
export function execFileText(
  file: string,
  args: string[],
  timeout: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'utf-8', timeout, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (('code' in error && typeof error.code === 'number') ? error.code : -1) : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

export async function findPython(): Promise<PythonInfo | null> {
  for (const cmd of ['python', 'python3']) {
    const r = await execFileText(cmd, ['--version'], 10000);
    const ver = (r.stdout || r.stderr || '').trim();
    if (r.code === 0 && ver) return { path: cmd, version: ver };
  }
  return null;
}

/** 是否运行在 venv 中（venv 内 pip --user 会报错，只有全局安装才需要 --user） */
export async function isInVenv(py: string): Promise<boolean> {
  const r = await execFileText(
    py,
    ['-c', 'import sys;print(1 if sys.prefix != sys.base_prefix else 0)'],
    15000,
  );
  return r.stdout.trim() === '1';
}

/** modelscope 包版本号；未安装或探测失败返回空串 */
export async function probeModelscopeVersion(py: string): Promise<string> {
  const r = await execFileText(
    py,
    ['-c', 'import modelscope; print(modelscope.__version__)'],
    20000,
  );
  return r.code === 0 ? r.stdout.trim() : '';
}

/**
 * 解析 modelscope CLI 可执行文件路径。
 * CLI 入口是 console 脚本（Scripts/modelscope.exe），`python -m modelscope.cli.download`
 * 在新版（≥1.16）中不存在。优先从 Python prefix 的 Scripts 目录定位，其次回退 PATH。
 */
export async function resolveModelscopeBin(pythonPath: string): Promise<string> {
  const r = await execFileText(
    pythonPath || 'python',
    ['-c', 'import sys,os;print(os.path.join(sys.prefix, "Scripts"))'],
    15000,
  );
  const scriptsDir = r.stdout.trim();
  if (r.code === 0 && scriptsDir) {
    const p = path.join(scriptsDir, exeName('modelscope'));
    if (fs.existsSync(p)) return p;
  }
  // 回退到 PATH 查找
  return 'modelscope';
}

/** Python 子进程环境：强制 UTF-8 输出 + 代理透传（modelscope 只认环境变量） */
export function buildCliEnv(proxyUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Windows 控制台默认 GBK，modelscope 输出会被按 UTF-8 解出乱码；强制 Python 用 UTF-8 输出
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.MODELSCOPE_HTTP_PROXY = proxyUrl;
    env.MODELSCOPE_HTTPS_PROXY = proxyUrl;
  }
  return env;
}
