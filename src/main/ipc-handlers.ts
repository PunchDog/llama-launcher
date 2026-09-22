import { ipcMain, BrowserWindow, dialog, IpcMainInvokeEvent } from 'electron';
import type { IpcChannelMap, IpcEnvelope } from '../shared/types';
import { isInvokeChannel, type InvokeChannel } from '../shared/ipc-contract';
import { loadConfig, saveConfig, updateConfigField, getCachedConfig } from './config';
import { LlamaServerManager, getServerManager } from './server';
import { CoreUpdater } from './core-updater';
import { ModelDownloader } from './model-downloader';
import {
  CheckCoreExists,
  GetLocalVersion,
  ListDownloadedFiles,
} from './core-updater';
import { validateConfig } from './params';

// =============================================================================
// IPC 通信层 — 注册所有 ipcMain.handle 通道
//   统一响应封套 IpcEnvelope：成功 {ok:true,data}，失败 {ok:false,error:string}
//   渲染层 api.ts 负责拆封并抛错，主进程不再向渲染层透传原始 Error 对象
// =============================================================================

let updaterInstance: CoreUpdater | null = null;
let serverInstance: LlamaServerManager | null = null;
let modelInstance: ModelDownloader | null = null;

// 窗口引用与注册状态 — macOS activate 重建窗口时二次调用 registerIpcHandlers，
// ipcMain.handle 同通道重复注册会直接抛异常，因此 handler 只注册一次，
// 事件转发统一走 activeWindow
let activeWindow: BrowserWindow | null = null;
let ipcRegistered = false;

function sendToWindow(channel: string, payload?: unknown): void {
  if (activeWindow && !activeWindow.isDestroyed()) {
    activeWindow.webContents.send(channel, payload);
  }
}

/**
 * 应用层日志（core 更新 / 模型下载器）统一入口：先落进 server 的环形历史缓冲，
 * 再推给渲染层 —— 否则刷新界面后 `server:get-logs` 只能捞回子进程日志。
 */
function appLog(line: string): void {
  serverInstance?.recordExternalLog(line);
  sendToWindow('server:on-log', line);
}

type RequestOf<T extends InvokeChannel> = IpcChannelMap[T] extends { request: infer R }
  ? R
  : undefined;
type ResponseOf<T extends InvokeChannel> = IpcChannelMap[T] extends { response: infer R }
  ? R
  : never;

/**
 * 注册带封套的 handler：白名单校验 + 异常统一转 {ok:false,error}，
 * 避免每个通道各写一份 try/catch，也避免异常击穿成 Electron 默认错误弹窗。
 * 通道名与请求/响应类型都由 IpcChannelMap 推导，写错通道或类型直接编译失败。
 */
function safeHandle<T extends InvokeChannel>(
  channel: T,
  handler: (event: IpcMainInvokeEvent, req: RequestOf<T>) => ResponseOf<T> | Promise<ResponseOf<T>>,
): void {
  if (!isInvokeChannel(channel)) {
    throw new Error(`IPC 通道未在白名单中: ${String(channel)}`);
  }
  ipcMain.handle(channel, async (event, req): Promise<IpcEnvelope<ResponseOf<T>>> => {
    try {
      const data = await handler(event, req);
      return { ok: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[IPC] ${String(channel)} 处理失败:`, msg);
      return { ok: false, error: msg };
    }
  });
}

function requireServer(): LlamaServerManager {
  if (!serverInstance) throw new Error('服务器管理器未初始化');
  return serverInstance;
}

function currentConfig() {
  return getCachedConfig() ?? loadConfig();
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  activeWindow = mainWindow;
  if (ipcRegistered) return;
  ipcRegistered = true;

  serverInstance = getServerManager();
  updaterInstance = new CoreUpdater();
  modelInstance = new ModelDownloader();

  // ---------------------------------------------------------------------------
  // ModelScope 下载日志转发 — 复用 server:on-log 通道，LogViewer 统一展示
  //   `[modelscope]` 前缀只在这一层加，下载器自身不再重复拼接
  // ---------------------------------------------------------------------------

  modelInstance.on('log', (line: string) => {
    appLog(`[modelscope] ${line}`);
  });

  modelInstance.on('progress', (state: ReturnType<ModelDownloader['getState']>) => {
    sendToWindow('model:progress', state);
  });

  // ---------------------------------------------------------------------------
  // Server 事件转发 — 只注册一次，避免重复监听
  // ---------------------------------------------------------------------------

  serverInstance.on('log', (line: string) => {
    sendToWindow('server:on-log', line);
  });

  serverInstance.on('state-change', (newState: number) => {
    sendToWindow('server:state-changed', newState);
  });

  // EventEmitter 的 'error' 事件无监听者时会抛未捕获异常直接击穿主进程，
  // 必须兜底（启动失败等路径都会 emit('error')）
  serverInstance.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[IPC] ServerManager 错误:', msg);
  });

  // ---------------------------------------------------------------------------
  // Core 管理日志 / 进度转发 — 进度由主进程推送，渲染层不再轮询
  // ---------------------------------------------------------------------------

  updaterInstance.on('log', (line: string) => {
    appLog(`[core] ${line}`);
  });

  updaterInstance.on('progress', (state: ReturnType<CoreUpdater['getState']>) => {
    sendToWindow('updater:progress', state);
  });

  // ---------------------------------------------------------------------------
  // Config 通道
  // ---------------------------------------------------------------------------

  safeHandle('config:load', () => loadConfig());

  safeHandle('config:save', (_event, config) => saveConfig(config));

  safeHandle('config:update', (_event, { key, value }) => updateConfigField(key, value));

  safeHandle('config:validate', (_event, config) => validateConfig(config));

  // ---------------------------------------------------------------------------
  // Server 通道
  // ---------------------------------------------------------------------------

  safeHandle('server:start', () => {
    const message = requireServer().start(currentConfig());
    if (message) throw new Error(message);
  });

  safeHandle('server:stop', async () => {
    await requireServer().stop();
  });

  safeHandle('server:restart', async () => {
    await requireServer().restart(currentConfig());
  });

  safeHandle('server:get-state', () => requireServer().getState());

  safeHandle('server:get-logs', () => requireServer().getLogs());

  safeHandle('server:get-command', () => requireServer().getCommand());

  safeHandle('server:preview-command', (_event, config) => requireServer().previewCommand(config));

  // ---------------------------------------------------------------------------
  // Updater 通道
  // ---------------------------------------------------------------------------

  safeHandle('updater:check-latest', async () => {
    const upd = updaterInstance!;
    await upd.fetchLatestRelease();
    const state = upd.getState();
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
    await updaterInstance!.downloadAndExtract();
  });

  safeHandle('updater:extract-specific', async (_event, { filename }) => {
    await updaterInstance!.extractSpecific(filename);
  });

  safeHandle('updater:list-downloaded-files', () => ListDownloadedFiles());

  safeHandle('updater:get-progress', () => updaterInstance!.getState());

  safeHandle('updater:set-proxy', (_event, { proxy }) => {
    updaterInstance!.setProxy(proxy);
  });

  safeHandle('updater:set-backend', (_event, { backend }) => {
    const upd = updaterInstance!;
    const valid = backend === 'rocm' ? 'rocm' : backend === 'vulkan' ? 'vulkan' : upd.selectedBackend;
    upd.selectedBackend = valid;
    return upd.getState();
  });

  // ---------------------------------------------------------------------------
  // ModelScope 模型下载通道
  // ---------------------------------------------------------------------------

  safeHandle('model:check-env', () => modelInstance!.checkEnv());

  safeHandle('model:install-modelscope', async () => {
    await modelInstance!.installModelscope();
  });

  safeHandle('model:search-models', (_event, { keyword }) => modelInstance!.searchModels(keyword));

  safeHandle('model:list-files', (_event, { modelId }) => modelInstance!.listFiles(modelId));

  safeHandle('model:download', async (_event, req) => {
    await modelInstance!.download(req);
  });

  safeHandle('model:get-progress', () => modelInstance!.getState());

  safeHandle('model:set-proxy', (_event, { proxy }) => {
    modelInstance!.setProxy(proxy);
  });

  safeHandle('model:cancel', () => {
    modelInstance!.cancel();
  });

  // 文件夹选择对话框
  safeHandle('dialog:open-folder', async () => {
    if (!activeWindow || activeWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(activeWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 文件选择对话框 — 默认过滤 GGUF 模型文件（草稿模型选择用）
  safeHandle('dialog:open-file', async () => {
    if (!activeWindow || activeWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(activeWindow, {
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
