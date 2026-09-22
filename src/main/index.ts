import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { registerIpcHandlers } from './ipc-handlers';
import { getServerManager } from './server';

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
  // pathToFileURL 会正确编码空格/中文等字符，裸拼 file:// 在含空格路径下会失效
  return pathToFileURL(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html')).href;
}

// ---------------------------------------------------------------------------
// 创建主窗口
// ---------------------------------------------------------------------------

const DEV_SERVER_URL = 'http://127.0.0.1:5174';

// sandbox 尝试开启；若 preload 在沙箱下加载失败（preload-error），
// 回退 sandbox=false 重建一次窗口并记录日志
let sandboxFallback = false;

function isAllowedExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

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
      sandbox: !sandboxFallback,
    },
  });

  // 安全：弹窗一律拦截，仅 https 外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url).catch((err: unknown) => {
        console.error('[App] openExternal 失败:', err);
      });
    }
    return { action: 'deny' };
  });

  // 安全：禁止页面导航离开自身（拖拽文件、恶意链接等），dev 模式放行 HMR 重连
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev() && url.startsWith(DEV_SERVER_URL);
    if (!allowed) {
      event.preventDefault();
    }
  });

  if (!sandboxFallback) {
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[App] preload 在 sandbox 下加载失败: ${preloadPath}`, error);
      const broken = mainWindow;
      // 先建新窗再销毁旧窗：若反过来，destroy 触发的 window-all-closed
      // 会在重建前把整个应用退出
      sandboxFallback = true;
      mainWindow = null;
      createWindow();
      broken?.destroy();
    });
  }

  // CSP 安全策略
  if (isDev()) {
    // dev 必须放行 inline：vite 注入到 <head> 最前部的 react-refresh preamble
    // 是内联脚本，被 header CSP 拦下会让所有组件模块抛
    // "@vitejs/plugin-react can't detect preamble" 导致白屏；
    // 'unsafe-eval' 供 HMR/sourcemap 使用。生产构建无 preamble，保持严格策略
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:",
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

// 退出前终止 llama-server 子进程，避免遗留孤儿进程占用 GPU/内存
//   stop() 内 taskkill 是异步的，直接同步退出会留下孤儿 —— 必须先阻止退出，
//   等清理链完成（或 3s 超时兜底）再以 app.exit 强制离开
let quitCleanupDone = false;
app.on('before-quit', (event) => {
  if (quitCleanupDone) return;
  event.preventDefault();
  const cleanup = getServerManager()
    .destroy()
    .catch((err: unknown) => console.error('[App] 退出前清理服务器失败:', err));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  void Promise.race([cleanup, timeout]).finally(() => {
    quitCleanupDone = true;
    app.exit(0);
  });
});

// 防止多实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // app.quit() 会走本实例的 before-quit 流程造成时序混乱，直接退出进程
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
