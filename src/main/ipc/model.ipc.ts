import { ModelDownloader } from '../model-downloader';
import { appLog, safeHandle, sendToWindow } from './registry';

// =============================================================================
// ModelScope 模型下载通道 — 环境检测 / 搜索 / 文件清单 / 下载 / 取消
//   `[modelscope]` 日志前缀只在这一层加，下载器自身不重复拼接；
//   模块级单例，退出清理（app-lifecycle）可通过 getModelDownloader() 触达。
// =============================================================================

let instance: ModelDownloader | null = null;

export function getModelDownloader(): ModelDownloader {
  if (!instance) instance = new ModelDownloader();
  return instance;
}

export function registerModelIpc(): void {
  const downloader = getModelDownloader();

  downloader.on('log', (line: string) => {
    appLog(`[modelscope] ${line}`);
  });

  downloader.on('progress', (state) => {
    sendToWindow('model:progress', state);
  });

  safeHandle('model:check-env', () => downloader.checkEnv());

  safeHandle('model:install-modelscope', async () => {
    await downloader.installModelscope();
  });

  safeHandle('model:search-models', (_event, { keyword }) => downloader.searchModels(keyword));

  safeHandle('model:list-files', (_event, { modelId }) => downloader.listFiles(modelId));

  safeHandle('model:download', async (_event, req) => {
    await downloader.download(req);
  });

  safeHandle('model:get-progress', () => downloader.getState());

  safeHandle('model:set-proxy', (_event, { proxy }) => {
    downloader.setProxy(proxy);
  });

  safeHandle('model:cancel', () => {
    downloader.cancel();
  });
}
