// =============================================================================
// bridge — 渲染层唯一 IPC 订阅点
//   主进程推送（日志 / 服务器状态 / core 进度 / 模型下载进度）全部在此落进各 store，
//   组件一律只读 store，不再各自订阅或轮询。
//   心跳只保留一个 5s 的状态校准（推送窗口不可见时可能积压，用它兜底），
//   原来 useServer 2s / useModelDownloader 500ms 的轮询已删除。
//   startBridge 幂等：main.tsx 只调一次，StrictMode 双跑与 HMR 不会重复订阅。
// =============================================================================

import { invoke, on } from '@/renderer/hooks/api';
import { useConfigStore } from './configStore';
import { useServerStore } from './serverStore';
import { useLogsStore } from './logsStore';
import { useUpdaterStore } from './updaterStore';
import { useDownloaderStore } from './downloaderStore';

/** 状态兜底校准周期 */
const HEARTBEAT_MS = 5000;
/** 日志合批窗口：一窗口内的多行只触发一次重渲染 */
const LOG_FLUSH_MS = 50;
/** 超过此行数立即落库，避免窗口隐藏时 pending 无限增长 */
const LOG_FLUSH_MAX = 200;

let started = false;
let pendingLines: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushLogs(): void {
  flushTimer = null;
  if (pendingLines.length === 0) return;
  const lines = pendingLines;
  pendingLines = [];
  useLogsStore.getState().appendBatch(lines);
}

function enqueueLog(line: string): void {
  pendingLines.push(line);
  if (pendingLines.length >= LOG_FLUSH_MAX) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLogs();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(flushLogs, LOG_FLUSH_MS);
}

export function startBridge(): void {
  if (started) return;
  started = true;

  on('server:on-log', (line) => enqueueLog(line));
  on('server:state-changed', (state) => useServerStore.getState().applyState(state));
  on('updater:progress', (state) => useUpdaterStore.getState().applyState(state));
  on('model:progress', (state) => useDownloaderStore.getState().applyState(state));

  void useConfigStore.getState().load();
  void useServerStore.getState().refresh();
  void useUpdaterStore.getState().refresh();
  void useDownloaderStore.getState().refresh();
  // Python / modelscope 检测结果与下载进度无关，只在启动时查一次（旧 hook 的 mount 效应）
  void useDownloaderStore.getState().checkEnv();

  // 主进程日志环形缓冲的历史部分（F5 或切页后不丢）；seed 自带「已有内容则跳过」守卫
  invoke('server:get-logs')
    .then((history) => useLogsStore.getState().seed(history))
    .catch((err: unknown) => console.error('[bridge] 拉取历史日志失败:', err));

  setInterval(() => {
    void useServerStore.getState().refresh();
  }, HEARTBEAT_MS);
}
