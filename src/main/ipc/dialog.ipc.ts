import { dialog } from 'electron';
import { getMainWindow, safeHandle } from './registry';

// =============================================================================
// 系统对话框通道 — 文件夹 / 文件（默认 GGUF）选择
// =============================================================================

export function registerDialogIpc(): void {
  safeHandle('dialog:open-folder', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 文件选择对话框 — 默认过滤 GGUF 模型文件（草稿模型选择用）
  safeHandle('dialog:open-file', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
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
