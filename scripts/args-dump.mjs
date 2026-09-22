// =============================================================================
// args-dump.mjs — 由 config JSON 打印 llama-server 命令行
//   用法: node scripts/args-dump.mjs [config.json路径]   （默认仓库 config.json）
//   前提: npm run build:electron
// =============================================================================
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildArgs } = require(path.join(root, 'dist-electron/main/params.js'));

const cfgPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const args = buildArgs(cfg);

const exe = path.join(root, 'core', 'llama-server.exe');
console.log(args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '));
void exe;
