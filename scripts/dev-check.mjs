// =============================================================================
// dev-check.mjs — 启动 dev 前的清场检查（Windows）
//   1) 探测 5174/8080/5555 端口占用（vite strictPort 是刻意设计，占用会快速报错）
//   2) 探测孤儿 electron / llama-server / ggml-rpc-server 进程
//   仅报告不杀进程；带 --kill 时清理孤儿（不含 llama-server 之外的用户进程）
//   用法: npm run dev:check [-- --kill]
// =============================================================================
import { execSync } from 'node:child_process';
import net from 'node:net';

const PORTS = [5174, 8080, 5555];
const KILL = process.argv.includes('--kill');
const ORPHAN_IMAGES = ['llama-server.exe', 'ggml-rpc-server.exe'];

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}

let pidByPort = {};
try {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m) pidByPort[m[1]] = m[2];
  }
} catch { /* netstat 失败不阻塞 */ }

let dirty = false;
for (const p of PORTS) {
  if (await portInUse(p)) {
    dirty = true;
    console.log(`✗ 端口 ${p} 被占用 (PID ${pidByPort[p] ?? '?'})`);
  }
}

const found = [];
try {
  const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)",/);
    if (m && ORPHAN_IMAGES.includes(m[0].split('","')[0].replace(/^"/, '').toLowerCase())) {
      found.push({ image: m[1].toLowerCase(), pid: m[2] });
    }
  }
} catch { /* tasklist 失败不阻塞 */ }
if (found.length) {
  dirty = true;
  for (const f of found) console.log(`✗ 孤儿进程 ${f.image} (PID ${f.pid})`);
}

if (dirty && KILL) {
  for (const f of found) {
    try { execSync(`taskkill /PID ${f.pid} /T /F`, { stdio: 'ignore' }); console.log(`✓ 已终止 PID ${f.pid} (${f.image})`); } catch { }
  }
  const stillDirty = PORTS.some((p) => pidByPort[p]);
  if (!stillDirty) {
    console.log('✓ 孤儿 llama 进程已清理（端口占用需另行处理）');
    process.exit(0);
  }
}

if (dirty) {
  console.log('\n环境不干净 — 有残留时 npm run dev 可能报 strictPort/单实例锁错误，先排查而非改端口');
  process.exit(1);
} else {
  console.log('✓ 端口空闲、无 llama 孤儿进程，可以 npm run dev');
}
