// =============================================================================
// Log Worker — 在独立线程中处理日志，避免阻塞主事件循环
// =============================================================================
// 主线程通过 postMessage(rawChunk) 发送原始 stdout/stderr 数据
// Worker 完成行切分/截断/缓冲后，逐行 postMessage 回主线程
//
// 为什么用 Worker 而不是主线程处理:
//   llama-server 在某些模型推理时会密集输出日志（每秒数千行）
//   如果主线程同步处理这些字符串操作和 buffer.push，
//   会导致事件循环延迟 → 影响 stdout pipe 的读取速率 →
//   可能反过来阻塞 llama-server 的 write 调用（OS pipe buffer 反压）

import { parentPort } from 'worker_threads';

const MAX_LOG_BUFFER = 5000;

// Worker 侧也维护一份日志缓冲，供 get-server-logs 查询
const logBuffer: string[] = [];

// 残留的不完整行（跨 chunk 拼接）
let leftover = '';

parentPort?.on('message', (data: unknown) => {
  if (typeof data !== 'string') return;

  // 拼接上一轮残留 + 当前数据
  const raw = leftover + data;
  const lines = raw.split('\n');

  // 最后一段可能是不完整的行，保留到下次
  leftover = lines.pop() ?? '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 写入环形缓冲
    logBuffer.push(line);
    while (logBuffer.length > MAX_LOG_BUFFER) {
      logBuffer.shift();
    }

    // 逐行回传主线程
    parentPort?.postMessage({ type: 'log', line });
  }
});

// 主线程可以查询日志缓冲
parentPort?.on('message', (msg: { type: string }) => {
  if (msg.type === 'get-logs') {
    parentPort?.postMessage({ type: 'logs', lines: [...logBuffer] });
  }
});

// 告知主线程 Worker 已就绪
parentPort?.postMessage({ type: 'ready' });
