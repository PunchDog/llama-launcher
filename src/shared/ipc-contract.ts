// =============================================================================
// IPC 通道白名单 — preload 与主进程共用的唯一契约
//   渲染进程只能 invoke/receive 此处显式列出的通道，
//   防止任意通道透传（如 ipcRenderer.removeAllListeners 破坏主进程事件）
// =============================================================================

import type { IpcChannelName } from './types';

/** 渲染进程 → 主进程（invoke/handle） */
export const ALLOWED_INVOKE_CHANNELS = [
  'config:load',
  'config:save',
  'config:update',
  'config:validate',
  'server:start',
  'server:stop',
  'server:restart',
  'server:get-state',
  'server:get-logs',
  'server:get-command',
  'server:preview-command',
  'updater:check-latest',
  'updater:check-core-exists',
  'updater:get-local-version',
  'updater:download-and-extract',
  'updater:extract-specific',
  'updater:list-downloaded-files',
  'updater:get-progress',
  'updater:set-proxy',
  'updater:set-backend',
  'model:check-env',
  'model:install-modelscope',
  'model:search-models',
  'model:list-files',
  'model:download',
  'model:get-progress',
  'model:set-proxy',
  'model:cancel',
  'dialog:open-folder',
  'dialog:open-file',
] as const satisfies readonly IpcChannelName[];

/** 主进程 → 渲染进程（send/on）推送 */
export const ALLOWED_RECEIVE_CHANNELS = [
  'server:on-log',
  'server:state-changed',
  'updater:progress',
  'model:progress',
] as const satisfies readonly IpcChannelName[];

export type InvokeChannel = (typeof ALLOWED_INVOKE_CHANNELS)[number];
export type ReceiveChannel = (typeof ALLOWED_RECEIVE_CHANNELS)[number];

const invokeSet: ReadonlySet<string> = new Set<string>(ALLOWED_INVOKE_CHANNELS);
const receiveSet: ReadonlySet<string> = new Set<string>(ALLOWED_RECEIVE_CHANNELS);

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return invokeSet.has(channel);
}

export function isReceiveChannel(channel: string): channel is ReceiveChannel {
  return receiveSet.has(channel);
}
