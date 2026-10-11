import { getCachedConfig, loadConfig } from '../config';
import { getServerManager } from '../server';
import { errMsg } from '../../shared/errors';
import { safeHandle, sendToWindow } from './registry';

// =============================================================================
// Server 通道 — llama-server 启停 / 状态 / 日志 / 命令预览
//   事件转发只在本文件 register 一次（ipcRegistered 守卫在 ipc-handlers.ts），
//   窗口重建时统一走 sendToWindow 的 activeWindow，不重复挂监听。
// =============================================================================

function currentConfig() {
  return getCachedConfig() ?? loadConfig();
}

export function registerServerIpc(): void {
  const server = getServerManager();

  server.on('log', (line: string) => {
    sendToWindow('server:on-log', line);
  });

  server.on('state-change', (newState: number) => {
    sendToWindow('server:state-changed', newState);
  });

  // EventEmitter 的 'error' 事件无监听者时会抛未捕获异常直接击穿主进程，
  // 必须兜底（启动失败等路径都会 emit('error')）
  server.on('error', (err: unknown) => {
    console.error('[IPC] ServerManager 错误:', errMsg(err));
  });

  safeHandle('server:start', () => {
    const message = server.start(currentConfig());
    if (message) throw new Error(message);
  });

  safeHandle('server:stop', async () => {
    await server.stop();
  });

  safeHandle('server:get-state', () => server.getState());

  safeHandle('server:get-logs', () => server.getLogs());

  safeHandle('server:preview-command', (_event, config) => server.previewCommand(config));
}
