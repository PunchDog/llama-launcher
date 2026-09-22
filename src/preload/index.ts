import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { isInvokeChannel, isReceiveChannel } from '../shared/ipc-contract';

// =============================================================================
// Preload — 只暴露白名单通道，不透传 IpcRendererEvent
//   通道契约唯一定义处：src/shared/ipc-contract.ts
// =============================================================================

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isInvokeChannel(channel)) {
      return Promise.reject(new Error(`IPC 通道未授权: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  /** 订阅主进程推送；返回取消订阅函数。回调只收到数据参数，不含 event 对象 */
  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    if (!isReceiveChannel(channel)) {
      console.warn(`[preload] 未授权监听通道: ${channel}`);
      return () => {};
    }
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
