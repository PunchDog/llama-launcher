import { ipcMain, BrowserWindow, dialog } from 'electron';
import { loadConfig, saveConfig, updateConfigField, getCachedConfig } from './config';
import { buildArgs } from './params';
import { LlamaServerManager, getServerManager } from './server';
import { CoreUpdater } from './core-updater';
import {
  CheckCoreExists,
  GetLocalVersion,
  ListDownloadedFiles,
} from './core-updater';

// =============================================================================
// IPC 通信层 — 注册所有 ipcMain.handle 通道
// =============================================================================

let updaterInstance: CoreUpdater | null = null;
let serverInstance: LlamaServerManager | null = null;

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  serverInstance = getServerManager();
  updaterInstance = new CoreUpdater();

  // ---------------------------------------------------------------------------
  // Server 事件转发 — 只注册一次，避免重复监听
  // ---------------------------------------------------------------------------

  serverInstance.on('log', (line: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:on-log', line);
    }
  });

  serverInstance.on('state-change', (newState: number) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:state-changed', newState);
    }
  });

  // ---------------------------------------------------------------------------
  // Core 管理日志转发 — 复用 server:on-log 通道，LogViewer 页面统一展示
  // ---------------------------------------------------------------------------

  updaterInstance.on('log', (line: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:on-log', `[core] ${line}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Config 通道
  // ---------------------------------------------------------------------------

  ipcMain.handle('config:load', () => {
    return loadConfig();
  });

  ipcMain.handle('config:save', (_event, config) => {
    saveConfig(config);
  });

  ipcMain.handle('config:update', (_event, { key, value }: { key: string; value: unknown }) => {
    return updateConfigField(key, value);
  });

  // ---------------------------------------------------------------------------
  // Server 通道
  // ---------------------------------------------------------------------------

  ipcMain.handle('server:start', (_event, { args }: { args: string[] }) => {
    if (!serverInstance) {
      console.error('[IPC] ServerManager 未初始化');
      throw new Error('服务器管理器未初始化');
    }
    const cfg = getCachedConfig() ?? loadConfig();
    serverInstance.start(cfg);
  });

  ipcMain.handle('server:stop', () => {
    if (!serverInstance) {
      console.error('[IPC] ServerManager 未初始化');
      throw new Error('服务器管理器未初始化');
    }
    serverInstance.stop();
  });

  ipcMain.handle('server:get-state', () => {
    return serverInstance!.getState();
  });

  ipcMain.handle('server:get-logs', () => {
    return serverInstance!.getLogs();
  });

  ipcMain.handle('server:get-command', () => {
    return serverInstance!.getCommand();
  });

  ipcMain.handle('server:preview-command', (_event, config) => {
    return serverInstance!.previewCommand(config);
  });

  // ---------------------------------------------------------------------------
  // Updater 通道
  // ---------------------------------------------------------------------------

  ipcMain.handle('updater:check-latest', async () => {
    const upd = updaterInstance!;
    await upd.fetchLatestRelease();
    const state = upd.getState();
    return {
      tag: state.latestTag,
      releaseTag: state.latestReleaseTag,
      size: state.downloadSize,
    };
  });

  ipcMain.handle('updater:check-core-exists', () => {
    return CheckCoreExists();
  });

  ipcMain.handle('updater:get-local-version', () => {
    const ver = GetLocalVersion();
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:on-log', `[core] 本地版本: ${ver}`);
    }
    return ver;
  });

  ipcMain.handle('updater:download-and-extract', async () => {
    const upd = updaterInstance!;
    const progressInterval = setInterval(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', upd.getState());
      }
    }, 200);

    try {
      await upd.downloadAndExtract();
    } finally {
      clearInterval(progressInterval);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', upd.getState());
      }
    }
  });

  ipcMain.handle('updater:extract-specific', async (_event, { filename }: { filename: string }) => {
    await updaterInstance!.extractSpecific(filename);
  });

  ipcMain.handle('updater:list-downloaded-files', () => {
    return ListDownloadedFiles();
  });

  ipcMain.handle('updater:get-progress', () => {
    return updaterInstance!.getState();
  });

  ipcMain.handle('updater:set-proxy', (_event, { proxy }: { proxy: string }) => {
    updaterInstance!.setProxy(proxy);
  });

  ipcMain.handle('updater:set-backend', (_event, { backend }: { backend: string }) => {
    const upd = updaterInstance!;
    const valid = backend === 'vulkan' || backend === 'rocm' ? backend : 'vulkan';
    upd.selectedBackend = valid;
    return upd.getState();
  });

  // 文件夹选择对话框
  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 文件选择对话框 — 默认过滤 GGUF 模型文件（草稿模型选择用）
  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'GGUF 模型文件', extensions: ['gguf'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
