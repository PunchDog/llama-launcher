// =============================================================================
// Log Worker — 在独立线程中处理日志，避免阻塞主事件循环
// =============================================================================
// 主线程通过 postMessage(rawChunk: string) 发送原始 stdout/stderr 数据，
// 或控制消息 {type:'get-logs'|'reset'}。
// Worker 完成行切分/截断/缓冲后，每 50ms 攒批回传 {type:'logs', lines[]} —
// 逐行 postMessage 在日志密集期（每秒数千行）会把消息风暴原样转嫁给主线程，
// 攒批让 IPC/事件循环开销与行数解耦。
//
// 为什么用 Worker 而不是主线程处理:
//   llama-server 在某些模型推理时会密集输出日志
//   如果主线程同步处理这些字符串操作和 buffer.push，
//   会导致事件循环延迟 → 影响 stdout pipe 的读取速率 →
//   可能反过来阻塞 llama-server 的 write 调用（OS pipe buffer 反压）

import { parentPort } from 'worker_threads';
import { MAX_LOG_BUFFER } from '../shared/constants';

// Worker 侧也维护一份日志缓冲（主线程 getLogs 用本地缓冲，此处供 get-logs 查询）
const logBuffer: string[] = [];

// 残留的不完整行（跨 chunk 拼接）
let leftover = '';

// 攒批队列 + 50ms 定时 flush
let pending: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 50);
}

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.length === 0) return;
  const lines = pending;
  pending = [];
  parentPort?.postMessage({ type: 'logs', lines });
}

function ingest(raw: string): void {
  const combined = leftover + raw;
  const lines = combined.split('\n');
  leftover = lines.pop() ?? '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    logBuffer.push(line);
    while (logBuffer.length > MAX_LOG_BUFFER) {
      logBuffer.shift();
    }
    pending.push(line);
  }
  if (pending.length >= 200) {
    // 大批量时不等定时器，立即出货，控制内存峰值
    flush();
  } else {
    scheduleFlush();
  }
}

parentPort?.on('message', (data: unknown) => {
  if (typeof data === 'string') {
    ingest(data);
    return;
  }
  if (data && typeof data === 'object') {
    const msg = data as { type?: string };
    if (msg.type === 'get-logs') {
      flush();
      parentPort?.postMessage({ type: 'logs', lines: [...logBuffer] });
    } else if (msg.type === 'reset') {
      // 新进程启动：清空缓冲与半行残留，上一轮日志不再回灌
      flush();
      logBuffer.length = 0;
      pending = [];
      leftover = '';
    }
  }
});

// 告知主线程 Worker 已就绪
parentPort?.postMessage({ type: 'ready' });
