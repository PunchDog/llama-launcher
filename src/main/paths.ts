// =============================================================================
// 路径工具 — 统一处理开发/打包两种模式下的资源路径
// =============================================================================
// 在开发模式下，core/downloads/config.json 位于项目根目录
// 在打包模式下 (electron-builder extraResources)，它们位于 resources/ 子目录

import { app } from 'electron';
import * as path from 'path';

/**
 * 获取应用基础目录：
 *   - 打包后: {exeDir}/resources/  (extraResources 输出位置)
 *   - 开发中: process.cwd()        (项目根目录，electron . 启动位置)
 */
export function getAppBaseDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'resources');
  }
  // 开发模式：electron 二进制路径 ≠ 项目根路径，用 cwd
  return process.cwd();
}

/**
 * 获取 core 目录路径
 */
export function getCoreDir(): string {
  return path.join(getAppBaseDir(), 'core');
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
