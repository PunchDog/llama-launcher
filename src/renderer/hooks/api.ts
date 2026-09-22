// =============================================================================
// IPC API 封装 — 渲染进程 ↔ 主进程通信桥
// =============================================================================

import type {
  IpcChannelName,
  IpcResponse,
  IpcChannelMap,
  IpcEnvelope,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// 预加载 API 接口（由 preload.js 通过 contextBridge 注入 window.electronAPI）
// ---------------------------------------------------------------------------

interface PreloadAPI {
  invoke<T extends IpcChannelName>(channel: T, ...args: unknown[]): Promise<unknown>;

  on(channel: string, callback: (...args: unknown[]) => void): () => void;
}

// ---------------------------------------------------------------------------
// 类型安全的 invoke 封装
// ---------------------------------------------------------------------------

function getAPI(): PreloadAPI | null {
  return (window as unknown as { electronAPI?: PreloadAPI }).electronAPI ?? null;
}

/**
 * 统一的 IPC 调用入口。
 * 主进程所有 handle 都返回 IpcEnvelope，失败时不再透传 Error 对象，
 * 此处集中拆封并把 error 字符串还原成异常，调用方沿用 try/catch 语义。
 */
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
  const envelope = (await api.invoke<T>(channel, ...args)) as IpcEnvelope<IpcResponse<T>>;
  if (!envelope || typeof envelope !== 'object') {
    throw new Error(`IPC 通道 ${channel} 返回了非预期响应`);
  }
  if (!envelope.ok) {
    throw new Error(envelope.error || `IPC 调用失败: ${channel}`);
  }
  return envelope.data;
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
