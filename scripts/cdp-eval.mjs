// =============================================================================
// cdp-eval — 在运行中的渲染进程里求值一段表达式（实机验证 UI 用，不依赖第三方 ws 客户端）
//   用法：npx electron . --remote-debugging-port=9222 启动后
//         node scripts/cdp-eval.mjs "document.title"
//   表达式返回 Promise 时会 await；结果按 JSON 打印。CDP_DEBUG=1 输出帧日志。
// =============================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';

const expr = process.argv[2] ?? '1+1';
const DBG = !!process.env.CDP_DEBUG;
const log = (...a) => { if (DBG) console.error('[cdp]', ...a); };
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 20000).unref();

const targets = await new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: '/json/list' }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const u = new URL(page.webSocketDebuggerUrl);
const wsKey = crypto.randomBytes(16).toString('base64');
const sock = net.connect(Number(u.port), u.hostname);
sock.on('error', (e) => { console.error('SOCKERR', e.message); process.exit(1); });

let upgraded = false;
let buf = Buffer.alloc(0);
const pending = new Map();
let seq = 0;
function send(obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xfe; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xff; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  sock.write(Buffer.concat([header, mask, masked]));
}
function call(method, params) {
  const mid = ++seq;
  return new Promise((res) => { pending.set(mid, res); send({ id: mid, method, params }); });
}
function pump() {
  for (;;) {
    if (buf.length < 2) return;
    const first = buf[1] & 0x7f;
    let off = 2, len = first;
    if (first === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (first === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + len) return;
    const body = buf.subarray(off, off + len);
    buf = buf.subarray(off + len);
    let msg; try { msg = JSON.parse(body.toString()); } catch { continue; }
    log('recv', JSON.stringify(msg).slice(0, 160));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
}
sock.on('connect', () => {
  log('tcp connected');
  sock.write('GET ' + u.pathname + ' HTTP/1.1\r\nHost: ' + u.host + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + wsKey + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
});
sock.on('data', (chunk) => {
  log('data', chunk.length, 'upgraded=' + upgraded);
  buf = Buffer.concat([buf, chunk]);
  if (!upgraded) {
    const i = buf.indexOf('\r\n\r\n');
    if (i < 0) return;
    upgraded = true;
    log('http response', buf.subarray(0, 40).toString().replace(/\r\n/g, ' | '));
    buf = buf.subarray(i + 4);
  }
  pump();
});
await new Promise((r) => setTimeout(r, 300));
const en = await call('Runtime.enable', {});
log('enabled', !!en.result);
const ev = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(ev.result ?? ev.error, null, 2));
sock.end();
process.exit(0);
