import { BrowserWindow } from 'electron';
import { setMainWindow } from './ipc/registry';
import { registerConfigIpc } from './ipc/config.ipc';
import { registerServerIpc } from './ipc/server.ipc';
import { registerUpdaterIpc } from './ipc/updater.ipc';
import { registerModelIpc } from './ipc/model.ipc';
import { registerDialogIpc } from './ipc/dialog.ipc';

// =============================================================================
// IPC 注册入口 — 各域 handler 见 main/ipc/*.ipc.ts，公共设施见 ipc/registry.ts
//   macOS activate 重建窗口时会二次调用本函数：ipcMain.handle 同通道重复注册
//   直接抛异常，因此 handler 只注册一次，事件转发统一走 activeWindow。
// =============================================================================

let ipcRegistered = false;

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  setMainWindow(mainWindow);
  if (ipcRegistered) return;
  ipcRegistered = true;

  registerServerIpc();
  registerConfigIpc();
  registerUpdaterIpc();
  registerModelIpc();
  registerDialogIpc();
}
