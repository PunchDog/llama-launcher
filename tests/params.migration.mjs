// =============================================================================
// params.migration.mjs — v1 配置迁移后必须发射出与旧版逐字一致的命令行
//   比对基准：tests/__snapshots__/params-golden.json（旧版 buildArgs 的冻结快照）
//   唯一放行的是 migrate.ts 里 INTENTIONAL_DIFFS 列出的 flag
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
const readJson = (...parts) => JSON.parse(read(...parts));

const { buildArgs, ALL_PARAMS } = require(path.join(root, 'dist-electron/shared/params/index.js'));
const { migrateV1ToV2, INTENTIONAL_DIFFS } = require(path.join(root, 'dist-electron/shared/params/migrate.js'));

const GOLDEN = readJson('tests', '__snapshots__', 'params-golden.json');
const FIXTURES = {
  'current.v1': readJson('tests', 'fixtures', 'current.v1.json'),
  'edge-cases.v1': readJson('tests', 'fixtures', 'edge-cases.v1.json'),
  'defaults.v1': readJson('tests', 'fixtures', 'defaults.v1.json'),
};
const ALLOWED_FLAGS = new Set(INTENTIONAL_DIFFS.map((d) => d.flag));

/** llama --help 里同一参数有多个写法（-ngl / --gpu-layers / --n-gpu-layers）；v1 命令行混用 */
const HELP_FLAGS = readJson('tests', 'llama-help-flags.json').flags;
const SPELLINGS = new Map(); // 任一写法 → 该参数的所有长写法候选
for (const f of HELP_FLAGS) {
  const candidates = [f.flag, ...(f.aliases ?? [])];
  const spellings = f.short ? [f.short, ...candidates] : candidates;
  for (const token of spellings) {
    if (token === f.short && !/^-(?!-)/.test(token)) continue; // --no-x 形态的「短选项」不参与归一
    SPELLINGS.set(token, [...(SPELLINGS.get(token) ?? []), ...candidates]);
  }
}

/** 每个 flag 吃几个 argv（含自身）：布尔开关 1，带值参数 2 */
const ARITY = new Map();
for (const def of ALL_PARAMS) {
  if (!def.flag) continue;
  const kind = def.emit ?? (def.type === 'bool' ? 'flagIfTrue' : 'value');
  ARITY.set(def.flag, kind === 'flagIfTrue' ? 1 : 2);
}

/** 归一到参数表里声明的那个写法，找不到就原样返回（由 ARITY 检查报错） */
function canonical(token) {
  if (ARITY.has(token)) return token;
  return (SPELLINGS.get(token) ?? []).find((candidate) => ARITY.has(candidate)) ?? token;
}

/** 把扁平 argv 切成 [flag, ...值] 的块并排序，使比对不受发射顺序影响 */
function toChunks(args) {
  const chunks = [];
  for (let i = 0; i < args.length; i++) {
    const flag = canonical(args[i]);
    const arity = ARITY.get(flag);
    assert.ok(arity, `参数表里没有 ${flag}，无法确定它是否带值`);
    const values = args.slice(i + 1, i + arity);
    assert.equal(values.length, arity - 1, `${flag} 缺少取值`);
    chunks.push([flag, ...values].join(' '));
    i += arity - 1;
  }
  return chunks.sort();
}

function diffChunks(v1Chunks, v2Chunks) {
  const v1 = new Set(v1Chunks);
  const v2 = new Set(v2Chunks);
  const dropped = [...v1].filter((c) => !v2.has(c) && !ALLOWED_FLAGS.has(c.split(' ')[0]));
  const added = [...v2].filter((c) => !v1.has(c) && !ALLOWED_FLAGS.has(c.split(' ')[0]));
  return { dropped, added };
}

for (const [name, v1] of Object.entries(FIXTURES)) {
  test(`${name} 迁移后的命令行与旧版一致`, () => {
    assert.ok(GOLDEN[name], `golden 快照缺少 ${name}`);
    const { config } = migrateV1ToV2(structuredClone(v1));
    const { dropped, added } = diffChunks(toChunks(GOLDEN[name]), toChunks(buildArgs(ALL_PARAMS, config)));
    assert.deepEqual({ dropped, added }, { dropped: [], added: [] }, `${name} 迁移后命令行发生变化`);
  });
}

test('迁移不丢字段：默认 v1 配置无警告，其它 fixture 只剩已知的历史残留提示', () => {
  assert.deepEqual(migrateV1ToV2(structuredClone(FIXTURES['defaults.v1'])).warnings, []);
  for (const name of ['current.v1', 'edge-cases.v1']) {
    const warnings = migrateV1ToV2(structuredClone(FIXTURES[name])).warnings;
    assert.deepEqual(
      warnings.filter((w) => !w.includes('未被参数表认领')),
      [],
      `${name} 迁移出现非预期警告`,
    );
  }
});

test('全部参数留 inherit 时命令行只含带默认值的启动器必填项', () => {
  const { config } = migrateV1ToV2({});
  const args = buildArgs(ALL_PARAMS, config);
  const flags = args.filter((a) => a.startsWith('--'));
  assert.ok(flags.length > 0, ' inherit 配置也应发射启动器默认项');
  for (const def of ALL_PARAMS) {
    if (def.default === undefined && def.flag) assert.ok(!flags.includes(def.flag), `${def.flag} 未设值却被发射`);
  }
});
