// =============================================================================
// ipc/registry — IPC 注册的公共设施（各域 handler 文件共用）
//   safeHandle   — 统一响应封套 IpcEnvelope：成功 {ok:true,data}，失败 {ok:false,error}
//                  渲染层 api.ts 拆封并抛错，主进程不向渲染层透传原始 Error 对象
//   sendToWindow — 走 activeWindow 转发推送；窗口重建（macOS activate）只换引用不换监听
//   appLog       — core 更新 / 模型下载日志汇入 server 环形历史缓冲 + 渲染层日志区
// =============================================================================

import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { IpcChannelMap, IpcEnvelope } from '../../shared/types';
import type { InvokeChannel } from '../../shared/ipc-contract';
import { errMsg } from '../../shared/errors';
import { getServerManager } from '../server';

let activeWindow: BrowserWindow | null = null;

/** macOS activate 重建窗口时更新转发目标（重复注册守卫见 ipc-handlers.ts） */
export function setMainWindow(win: BrowserWindow): void {
  activeWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return activeWindow && !activeWindow.isDestroyed() ? activeWindow : null;
}

export function sendToWindow(channel: string, payload?: unknown): void {
  if (activeWindow && !activeWindow.isDestroyed()) {
    activeWindow.webContents.send(channel, payload);
  }
}

/**
 * 应用层日志（core 更新 / 模型下载器）统一入口：先落进 server 的环形历史缓冲，
 * 再推给渲染层 —— 否则刷新界面后 `server:get-logs` 只能捞回子进程日志。
 */
export function appLog(line: string): void {
  getServerManager().recordExternalLog(line);
  sendToWindow('server:on-log', line);
}

type RequestOf<T extends InvokeChannel> = IpcChannelMap[T] extends { request: infer R }
  ? R
  : undefined;
type ResponseOf<T extends InvokeChannel> = IpcChannelMap[T] extends { response: infer R }
  ? R
  : never;

/**
 * 注册带封套的 handler：异常统一转 {ok:false,error}，
 * 避免每个通道各写一份 try/catch，也避免异常击穿成 Electron 默认错误弹窗。
 * 通道名与请求/响应类型都由 IpcChannelMap 推导，写错通道或类型直接编译失败。
 */
export function safeHandle<T extends InvokeChannel>(
  channel: T,
  handler: (event: IpcMainInvokeEvent, req: RequestOf<T>) => ResponseOf<T> | Promise<ResponseOf<T>>,
): void {
  ipcMain.handle(channel, async (event, req): Promise<IpcEnvelope<ResponseOf<T>>> => {
    try {
      const data = await handler(event, req);
      return { ok: true, data };
    } catch (err) {
      const msg = errMsg(err);
      console.error(`[IPC] ${String(channel)} 处理失败:`, msg);
      return { ok: false, error: msg };
    }
  });
}
