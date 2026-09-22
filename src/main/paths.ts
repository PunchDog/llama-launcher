// =============================================================================
// 路径工具 — 统一处理开发/打包两种模式下的资源路径
// =============================================================================
// 在开发模式下，core/downloads/config.json 位于项目根目录
// 在打包模式下 (electron-builder extraResources)，它们位于 resources/ 子目录

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 获取应用基础目录：
 *   - 打包后且 resources/ 可写: {exeDir}/resources/  (绿色/portable 目录形态，
 *     core 更新与 config 保存直接落在安装包旁)
 *   - 打包后且 resources/ 只读: {userData}/          (装入 Program Files 等
 *     受保护位置时回退到用户数据目录，避免 EPERM)
 *   - 开发中: process.cwd()        (项目根目录，electron . 启动位置)
 */
let cachedBaseDir: string | null = null;

/**
 * 目录是否真的可写 —— fs.accessSync(W_OK) 只看 ACL 标志，Program Files 等
 * 受保护位置会误报可写，必须实际试写一个探针文件才能可靠判断。
 */
function isDirWritable(dir: string): boolean {
  const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** 只读安装场景：以 userData 为基目录，并从打包资源播种 config.json */
function resolveUserDataBase(resourcesBase: string): string {
  const base = app.getPath('userData');
  try {
    fs.mkdirSync(base, { recursive: true });
    const targetConfig = path.join(base, 'config.json');
    const bundledConfig = path.join(resourcesBase, 'config.json');
    if (!fs.existsSync(targetConfig) && fs.existsSync(bundledConfig)) {
      fs.copyFileSync(bundledConfig, targetConfig);
    }
  } catch (err) {
    console.error('[Paths] userData 初始化失败:', err);
  }
  return base;
}

export function getAppBaseDir(): string {
  if (cachedBaseDir) return cachedBaseDir;

  if (!app.isPackaged) {
    // 开发模式：app.getAppPath() 由 electron 启动入口决定，比 process.cwd()
    // 可靠（从其他目录用绝对路径启动 electron 时 cwd 会指错）；
    // 取不到或不存在时再退回 cwd
    let base = '';
    try {
      base = app.getAppPath();
    } catch {
      // getAppPath 在极少数场景会抛错
    }
    cachedBaseDir = base && fs.existsSync(base) ? base : process.cwd();
    return cachedBaseDir;
  }

  const resourcesBase = path.join(path.dirname(app.getPath('exe')), 'resources');
  cachedBaseDir = isDirWritable(resourcesBase)
    ? resourcesBase
    : resolveUserDataBase(resourcesBase);
  return cachedBaseDir;
}

/**
 * 获取 core 目录路径。
 * 历史版本可能把核心装在不同的基目录（可写 resources / 只读回退 userData /
 * 开发模式 cwd），逐一探测，取第一个真正包含 llama-server 二进制的目录，
 * 避免「装了却找不到」；全部落空时用基目录下的 core/ 作为写入位置。
 */
function llamaServerName(): string {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

let cachedCoreDir: string | null = null;

export function getCoreDir(): string {
  if (cachedCoreDir) return cachedCoreDir;

  const primary = path.join(getAppBaseDir(), 'core');
  const candidates = [primary];
  try {
    candidates.push(path.join(app.getPath('userData'), 'core'));
  } catch {
    // app 未就绪时跳过
  }
  try {
    candidates.push(
      path.join(path.dirname(app.getPath('exe')), 'resources', 'core'),
    );
  } catch {
    // 同上
  }
  candidates.push(path.join(process.cwd(), 'core'));

  const seen = new Set<string>();
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    try {
      if (fs.existsSync(path.join(dir, llamaServerName()))) {
        cachedCoreDir = dir;
        return dir;
      }
    } catch {
      // 探测失败继续下一个候选
    }
  }
  cachedCoreDir = primary;
  return primary;
}

/**
 * 获取 downloads 目录路径
 */
export function getDownloadDir(): string {
  return path.join(getAppBaseDir(), 'downloads');
}

/**
 * 获取 config.json 路径
 */
export function getConfigPath(): string {
  return path.join(getAppBaseDir(), 'config.json');
}

/**
 * 获取 llama-server.exe 完整路径
 */
export function getServerExePath(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(getCoreDir(), `llama-server${ext}`);
}
