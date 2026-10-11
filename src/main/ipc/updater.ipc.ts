import { CoreUpdater } from '../core-updater';
import { CheckCoreExists, GetLocalVersion } from '../version-probe';
import { ListDownloadedFiles } from '../archive-util';
import { errMsg } from '../../shared/errors';
import type { GpuBackend } from '../../shared/constants';
import { appLog, safeHandle, sendToWindow } from './registry';

// =============================================================================
// Updater 通道 — llama.cpp core 版本检查 / 下载解压 / 后端与代理设置
//   进度与日志由 CoreUpdater 事件推送（渲染层不再轮询）；
//   模块级单例，退出清理（app-lifecycle）可通过 getCoreUpdater() 触达。
// =============================================================================

let instance: CoreUpdater | null = null;

export function getCoreUpdater(): CoreUpdater {
  if (!instance) instance = new CoreUpdater();
  return instance;
}

export function registerUpdaterIpc(): void {
  const updater = getCoreUpdater();

  updater.on('log', (line: string) => {
    appLog(`[core] ${line}`);
  });

  updater.on('progress', (state) => {
    sendToWindow('updater:progress', state);
  });

  safeHandle('updater:check-latest', async () => {
    await updater.fetchLatestRelease();
    const state = updater.getState();
    return {
      tag: state.latestTag,
      releaseTag: state.latestReleaseTag,
      size: state.downloadSize,
    };
  });

  safeHandle('updater:check-core-exists', () => CheckCoreExists());

  safeHandle('updater:get-local-version', async () => {
    const ver = await GetLocalVersion();
    appLog(`[core] 本地版本: ${ver}`);
    return ver;
  });

  safeHandle('updater:download-and-extract', async () => {
    await updater.downloadAndExtract();
  });

  safeHandle('updater:extract-specific', async (_event, { filename }) => {
    await updater.extractSpecific(filename);
  });

  safeHandle('updater:list-downloaded-files', () => ListDownloadedFiles());

  safeHandle('updater:get-progress', () => updater.getState());

  safeHandle('updater:set-proxy', (_event, { proxy }) => {
    updater.setProxy(proxy);
  });

  safeHandle('updater:set-backend', (_event, { backend }) => {
    const valid: GpuBackend =
      backend === 'rocm' || backend === 'vulkan' ? backend : updater.selectedBackend;
    updater.selectedBackend = valid;
    return updater.getState();
  });
}
