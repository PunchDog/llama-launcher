// =============================================================================
// param-help-snapshot.mjs — 抓取 core/llama-server.exe --help 并解析参数默认值表
//   产物:
//     tests/llama-help-snapshot.txt  原始 --help 输出（人工比对用）
//     tests/llama-help-flags.json    { version, flags: [{flag, short, arg, defaultText}] }
//   P3 的元数据一致性测试以此为真实默认值来源
//   用法: node scripts/param-help-snapshot.mjs
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(root, 'core', 'llama-server.exe');
if (!fs.existsSync(exe)) {
  console.error('未找到 core/llama-server.exe — 请先在 Core 管理页下载核心');
  process.exit(1);
}

let help;
try {
  help = execFileSync(exe, ['--help'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
} catch (err) {
  // llama-server --help 正常退出码为 0，但 Windows 下偶发非零；stdout 仍在
  help = (err.stdout || '').toString();
  if (!help) throw err;
}

fs.writeFileSync(path.join(root, 'tests/llama-help-snapshot.txt'), help);

// help 块格式示例（条目行顶格，续行缩进）:
//   -fit,  --fit [on|off]                   whether to adjust unset arguments ... ('on' or
//                                           'off', default: on)
//   -cram, --cache-ram N                    set the maximum cache size in MiB (default: 8192, ...)
//   --temp, --temperature N                 temperature (default: 0.80)
// 解析策略: 顶格行开启一个条目块（吞并后续缩进续行），块内提取所有 --long 别名与 default 文本
const lines = help.split(/\r?\n/);
const ENTRY_RE = /^(-[\w-]+,|--[a-z0-9-]+)/;
const blocks = [];
for (const line of lines) {
  if (ENTRY_RE.test(line)) blocks.push(line);
  else if (blocks.length && /^\s+\S/.test(line)) blocks[blocks.length - 1] += ' ' + line.trim();
}

const flagMap = new Map(); // flag → entry；主名（条目首个长名）优先于描述性提及
for (const block of blocks) {
  const firstLine = block; // 块即首行+续行拼接；描述起点 = 首个其后不接 '-' 的 ≥2 空格间隙
  const gapRe = /\s{2,}/g;
  let optionEnd = firstLine.length;
  let gm;
  while ((gm = gapRe.exec(firstLine))) {
    const after = firstLine.slice(gm.index + gm[0].length);
    if (after.startsWith('-')) continue; // 选项对齐空格（如 "-fit,  --fit"）
    if (gm.index > 0) { optionEnd = gm.index; break; }
  }
  const optionPart = firstLine.slice(0, optionEnd);
  const longNames = [...new Set([...optionPart.matchAll(/--[a-z0-9][a-z0-9-]*/g)].map((m) => m[0]))];
  if (!longNames.length) continue;
  const [primary, ...aliases] = longNames;
  if (flagMap.has(primary)) continue; // 真正重复的主名保留首个条目
  const shortMatch = block.match(/^(-[\w-]+),/);
  const desc = block.slice(optionEnd).trim();
  let defaultText = '';
  const dm = block.match(/\(default:\s*([^)]*)\)/) || block.match(/,\s*default:\s*(\S[^\n)]*)/);
  if (dm) defaultText = dm[1].trim();
  flagMap.set(primary, {
    flag: primary,
    aliases,
    short: shortMatch ? shortMatch[1] : null,
    help: desc,
    defaultText,
  });
  for (const a of aliases) {
    if (!flagMap.has(a)) flagMap.set(a, { ...flagMap.get(primary), flag: a, aliases: [primary] });
  }
}
const flags = [...flagMap.values()];

const versionMatch = help.match(/version:\s*(\S+)/i);
const out = {
  version: versionMatch ? versionMatch[1] : 'unknown',
  capturedAt: new Date().toISOString(),
  flags,
};
fs.writeFileSync(path.join(root, 'tests/llama-help-flags.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`已解析 ${flags.length} 个参数条目 → tests/llama-help-flags.json (version: ${out.version})`);
