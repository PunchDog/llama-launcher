import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';

// =============================================================================
// Electron 主入口 — 应用生命周期管理
// =============================================================================

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// 判断是否为开发模式
// ---------------------------------------------------------------------------

function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

// ---------------------------------------------------------------------------
// getPreloadPath — 预加载脚本路径
// ---------------------------------------------------------------------------

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'index.js');
}

// ---------------------------------------------------------------------------
// getRendererUrl — 渲染进程 URL
//   开发模式 → Vite dev server; 生产模式 → dist-renderer/index.html
// ---------------------------------------------------------------------------

function getRendererUrl(): string {
  if (isDev()) {
    // 与 vite.config.ts server.port 保持一致（5173 常被其他项目占用）
    return 'http://127.0.0.1:5174';
  }
  return `file://${path.join(__dirname, '..', '..', 'dist-renderer', 'index.html')}`;
}

// ---------------------------------------------------------------------------
// 创建主窗口
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    title: 'llama.cpp Server Launcher',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // 安全：禁止导航到外部 URL（内联链接用默认浏览器打开）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // CSP 安全策略
  if (isDev()) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:",
          ],
        },
      });
    });
  } else {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
          ],
        },
      });
    });
  }

  // 注册 IPC handlers
  registerIpcHandlers(mainWindow);

  // 加载渲染进程
  mainWindow.loadURL(getRendererUrl());

  // 窗口就绪后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App 生命周期
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createWindow();

  // macOS: dock 点击时如果没有窗口则重新创建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 防止多实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
