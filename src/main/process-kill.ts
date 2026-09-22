// =============================================================================
// 进程树终止 — 统一 server / rpc-server / 退出清理三处的 kill 逻辑
//   Windows: taskkill /T /F 同步等待完成，杜绝「spawn 了 taskkill 但主进程
//   先退出导致 taskkill 没跑完」的孤儿进程竞态
// =============================================================================

import { spawn, spawnSync } from 'child_process';
import * as os from 'os';

/**
 * 同步终止进程树。before-quit 等「函数返回后进程必须已死」的场景必须用这个。
 * @returns taskkill/kill 是否成功（进程已不存在也视为成功）
 */
export function killTreeSync(pid: number, timeoutMs = 10000): boolean {
  if (os.platform() === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: timeoutMs,
    });
    if (r.error) return false;
    // taskkill 对已退出的 PID 返回非 0（找不到进程），同样视为达成目标
    return true;
  }
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

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
