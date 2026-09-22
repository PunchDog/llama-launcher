// =============================================================================
// params.metadata.mjs — 参数元数据表与 llama-server --help 快照的一致性审计
//   目的：元数据表是本项目的唯一事实来源，一旦写了 help 里不存在的 flag，
//   llama-server 会直接退出；这类错误只能靠机械比对拦住，不能靠人眼 review
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const { ALL_PARAMS, PARAM_INDEX, PARAM_GROUPS, KEY_ALIASES } = require(
  path.join(root, 'dist-electron/shared/params/index.js'),
);

const HELP = read('tests', 'llama-help-snapshot.txt');
const FLAGS = JSON.parse(read('tests', 'llama-help-flags.json')).flags;

/** llama 接受的写法全集（长选项 + 别名 + 真正的短选项） */
const KNOWN = new Set();
for (const f of FLAGS) {
  KNOWN.add(f.flag);
  for (const a of f.aliases ?? []) KNOWN.add(a);
  if (f.short && /^-(?!-)/.test(f.short)) KNOWN.add(f.short);
}

/** llama.cpp 已删除的历史 flag — 出现即说明表里抄了旧文档 */
const REMOVED = [
  '--mlock',
  '--no-mmap',
  '--quant-kv',
  '--qkv',
  '--watchdog',
  '--draft-model',
  '--draft',
  '--spec-draft',
  '--spec-ngram-size-n',
];

test('每个 flag / negFlag / short 都存在于 --help 快照', () => {
  const bad = [];
  for (const def of ALL_PARAMS) {
    for (const token of [def.flag, def.negFlag, def.short]) {
      if (token && !KNOWN.has(token)) bad.push(`${def.key}: ${token}`);
    }
  }
  assert.deepEqual(bad, [], '元数据表里有 llama-server 不认识的写法');
});

test('不使用 llama.cpp 已删除的 flag', () => {
  const used = new Set(
    ALL_PARAMS.flatMap((def) => [def.flag, def.negFlag, def.short].filter(Boolean)),
  );
  const stale = [...used].filter((token) => REMOVED.includes(token));
  assert.deepEqual(stale, [], '这些 flag 在当前 llama.cpp 里已不存在');
});

test('当前版本仍然接受 --cache-type-k（曾被误判为已删参数）', () => {
  assert.ok(KNOWN.has('--cache-type-k'));
  assert.ok(HELP.includes('--cache-type-k'));
});

test('envName 与 help 文本一致', () => {
  const bad = ALL_PARAMS.filter((def) => def.envName && !HELP.includes(`env: ${def.envName}`)).map(
    (def) => `${def.key}: ${def.envName}`,
  );
  assert.deepEqual(bad, [], '环境变量的名字与 help 里记录的不一致');
});

test('requires / requiredWhen 指向的 key 一定存在，且条件不与自己冲突', () => {
  const bad = [];
  for (const def of ALL_PARAMS) {
    const rules = [...(def.requires ?? []), ...(def.requiredWhen ? [def.requiredWhen.rule] : [])];
    for (const rule of rules) {
      if (!PARAM_INDEX.has(rule.key)) bad.push(`${def.key} → 不存在的 ${rule.key}`);
      if (!rule.oneOf && !rule.noneOf) bad.push(`${def.key} → ${rule.key} 没写 oneOf/noneOf`);
      assert.ok(
        !def.requires?.some((r) => r.key === def.key) && def.requiredWhen?.rule.key !== def.key,
        `${def.key} 依赖了自己`,
      );
    }
  }
  assert.deepEqual(bad, [], '条件依赖指向了不存在的参数');
});

test('key 的前缀与所属组一致，组顺序与聚合表一致', () => {
  const groupIds = PARAM_GROUPS.map((group) => group[0].key.split('.')[0]);
  assert.deepEqual(
    groupIds,
    ['server', 'model', 'memory', 'compute', 'sampling', 'speculative', 'reasoning', 'multimodal', 'lora', 'rpc', 'advanced', 'extra'],
    '组顺序即命令行发射顺序，调整它必须说明理由',
  );
  assert.equal(groupIds.at(-1), 'extra', 'extra.args 必须最后发射，才能压住界面上的同名值');

  const bad = [];
  for (const group of PARAM_GROUPS) {
    for (const def of group) {
      const [prefix, field] = def.key.split('.');
      if (def.key.includes('.', def.key.indexOf('.') + 1)) bad.push(`${def.key}: key 必须是 组.字段 两层`);
      if (def.group !== prefix) bad.push(`${def.key}: group 写成 ${def.group}`);
      if (!/^\w+$/.test(field)) bad.push(`${def.key}: 字段名不合法`);
    }
  }
  assert.deepEqual(bad, [], '参数分组与 key 不一致');
});

test('除逃生口外每项都有 flag，且带值参数的值不会被 llama 当成下一个 flag 吞掉', () => {
  const bad = ALL_PARAMS.filter((def) => !def.flag && def.emit !== 'raw' && def.emit !== 'none').map(
    (def) => def.key,
  );
  assert.deepEqual(bad, [], '没有 flag 又非 raw/none 的参数永远不会出现在命令行');
  assert.equal(ALL_PARAMS.find((def) => def.emit === 'raw')?.key, 'extra.args');
});

test('legacy 路径唯一，且与 v2 key 一一映射', () => {
  const seen = new Map();
  const bad = [];
  for (const def of ALL_PARAMS) {
    if (!def.legacy) continue;
    const prior = seen.get(def.legacy.path);
    if (prior) bad.push(`${def.legacy.path} 同时被 ${prior} 和 ${def.key} 认领`);
    seen.set(def.legacy.path, def.key);
  }
  assert.deepEqual(bad, [], '一个 v1 字段迁移到两个 v2 字段，结果取决于遍历顺序');
  assert.equal(KEY_ALIASES.size, seen.size);
});

test('枚举参数都有候选值，候选值非空且不重复', () => {
  const bad = [];
  for (const def of ALL_PARAMS) {
    if (def.type === 'enum' && !(def.options?.length)) bad.push(`${def.key}: enum 没有 options`);
    if (def.options) {
      const values = def.options.map(String);
      if (new Set(values).size !== values.length) bad.push(`${def.key}: options 有重复值`);
      if (values.some((v) => !v.trim())) bad.push(`${def.key}: options 有空值`);
      // enum/string[] 用 options 作候选；string 的 options 只是建议值（如 -ngl 的 auto/all）
      if (!['enum', 'string[]', 'string'].includes(def.type)) bad.push(`${def.key}: ${def.type} 不该带 options`);
    }
    if (def.type === 'bool' && def.options) bad.push(`${def.key}: bool 用开关控件，不用 options`);
  }
  assert.deepEqual(bad, [], '枚举候选值声明有问题');
});

test('三态默认值：只有启动器必须知道的字段才带 default', () => {
  const withDefault = ALL_PARAMS.filter((def) => def.default !== undefined).map((def) => def.key);
  assert.deepEqual(
    withDefault,
    ['server.host', 'server.port', 'server.timeout', 'server.models_max', 'extra.args'],
    '新增默认值会让该参数永远被发射，从而关掉 llama-server 的 --fit 自适应，必须逐条确认',
  );
});

test('每个参数都有中文标题，说明文案不留空（逃生口除外）', () => {
  const bad = ALL_PARAMS.filter((def) => !def.label?.trim() || (!def.desc?.trim() && def.emit !== 'raw')).map(
    (def) => def.key,
  );
  assert.deepEqual(bad, [], '界面上会出现没有说明的控件');
});
