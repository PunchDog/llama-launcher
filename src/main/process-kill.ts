// =============================================================================
// 进程树终止 — 统一 server / rpc-server / 退出清理三处的 kill 逻辑
//   Windows: taskkill /T /F 异步等待 close 后 resolve —— 调用方 await 即可
//   杜绝「spawn 了 taskkill 但主进程先退出」的孤儿进程竞态，且不再冻结事件循环
// =============================================================================

import { spawn } from 'child_process';
import * as os from 'os';

/** 异步终止进程树（事件循环还需继续工作的场景，如运行中点「停止」） */
export function killTree(pid: number): Promise<boolean> {
  if (os.platform() !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程可能已退出
    }
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      }
    };
    const timer = setTimeout(() => finish(false), 15000);
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
      });
      killer.on('error', () => finish(false));
      killer.on('close', (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}
