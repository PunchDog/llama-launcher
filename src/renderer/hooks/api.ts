// =============================================================================
// IPC API 封装 — 渲染进程 ↔ 主进程通信桥
// =============================================================================

import type {
  IpcChannelName,
  IpcRequest,
  IpcResponse,
  IpcChannelMap,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// 预加载 API 接口（由 preload.js 通过 contextBridge 注入 window.electronAPI）
// ---------------------------------------------------------------------------

interface PreloadAPI {
  invoke<T extends IpcChannelName>(
    channel: T,
    ...args: unknown[]
  ): Promise<IpcResponse<T>>;

  on(channel: string, callback: (...args: unknown[]) => void): () => void;

  once(channel: string, callback: (...args: unknown[]) => void): void;

  removeAllListeners(channel: string): void;
}

// ---------------------------------------------------------------------------
// 类型安全的 invoke 封装
// ---------------------------------------------------------------------------

function getAPI(): PreloadAPI | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI ?? null;
}

export async function invoke<T extends IpcChannelName>(
  channel: T,
  ...args: IpcChannelMap[T] extends { request: infer R }
    ? R extends never
      ? []
      : [R]
    : []
): Promise<IpcResponse<T>> {
  const api = getAPI();
  if (!api) {
    throw new Error('electronAPI 未就绪，请确保在 Electron 环境中运行');
  }
  return api.invoke<T>(channel, ...args) as Promise<IpcResponse<T>>;
}

export function on<T extends IpcChannelName>(
  channel: T,
  callback: (data: IpcResponse<T>) => void,
): () => void {
  const api = getAPI();
  if (!api) {
    console.warn(`electronAPI 未就绪，无法监听通道: ${channel}`);
    return () => {};
  }
  return api.on(channel, callback as (...args: unknown[]) => void);
}

export function once<T extends IpcChannelName>(
  channel: T,
  callback: (data: IpcResponse<T>) => void,
): void {
  const api = getAPI();
  if (!api) {
    console.warn(`electronAPI 未就绪，无法监听通道: ${channel}`);
    return;
  }
  api.once(channel, callback as (...args: unknown[]) => void);
}

export function removeAllListeners(channel: IpcChannelName): void {
  const api = getAPI();
  if (!api) return;
  api.removeAllListeners(channel);
}
