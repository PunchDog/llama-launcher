// =============================================================================
// config.normalize.mjs — 配置归一化 / 版本迁移 / 启动前校验的行为测试
//   直接 require 编译产物（dist-electron/main 与 shared），不依赖 electron 运行时：
//   只调用纯函数 migrateAndNormalize / normalizeConfig / validateParams。
//   运行前提：npm test 会先 build:electron
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...parts) =>
  JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));

const config = require(path.join(root, 'dist-electron', 'main', 'config.js'));
const { migrateAndNormalize, normalizeConfig, defaultConfig } = config;
const { DEFAULT_CONFIG, CONFIG_VERSION } = require(path.join(root, 'dist-electron', 'shared', 'constants.js'));
const { validateParams, hasErrors } = require(path.join(root, 'dist-electron', 'shared', 'params', 'validate.js'));
const { PARAM_INDEX } = require(path.join(root, 'dist-electron', 'shared', 'params', 'index.js'));

const migrated = (raw) => migrateAndNormalize(raw).config;

// ---------------------------------------------------------------------------
// 版本迁移
// ---------------------------------------------------------------------------

test('v1 配置迁移到 v2：值搬到点路径、应用层字段各归其位', () => {
  const v1 = readJson('tests', 'fixtures', 'current.v1.json');
  const { config: out, migrated: didMigrate } = migrateAndNormalize(v1);

  assert.equal(didMigrate, true);
  assert.equal(out.config_version, CONFIG_VERSION);
  assert.equal(out.model.ctx_size, v1.ctx_size);
  assert.equal(out.memory.ngl, String(v1.ngl));
  assert.equal(out.speculative.spec_type, v1.spec_type);
  assert.equal(out.proxy.enabled, v1.proxy_enabled);
  assert.equal(out.proxy.url, v1.proxy_url);
  assert.equal(out.rpc.server.enabled, v1.rpc_server.enabled);
  assert.equal(out.rpc.server.port, v1.rpc_server.port);
  // v1 顶层旧字段不得残留在 v2 结构里
  assert.equal('ctx_size' in out, false);
  assert.equal('proxy_enabled' in out, false);
  assert.equal('rpc_server' in out, false);
});

test('v0 配置先补字段再迁移，隐式 draft-mtp 由 mtp 推断', () => {
  const out = migrated(readJson('tests', 'fixtures', 'legacy.v0.json'));
  assert.equal(out.config_version, CONFIG_VERSION);
  assert.equal(out.model.load_mode, 'mlock');
  assert.equal(out.compute.numa, 'distribute');
  // tensor_batch 补出来的 0 表示「跟随线程数」，v1 也从不发射 -tb，故迁移为 inherit
  assert.equal(out.compute.threads_batch, null);
  assert.equal('tensor_batch' in out.compute, false);
});

test('当前版本（v2）配置不触发回写，未知键一律丢弃', () => {
  const { config: out, migrated: didMigrate } = migrateAndNormalize({
    ...DEFAULT_CONFIG,
    hacked: { nested: 1 },
    server: { ...DEFAULT_CONFIG.server, bogus: 'x', port: '7' },
  });
  assert.equal(didMigrate, false);
  assert.equal('hacked' in out, false);
  assert.equal('bogus' in out.server, false);
  assert.equal(out.server.port, 7, '数字字符串按 int 类型收编');
});

test('原型污染键不落入配置对象', () => {
  const evil = JSON.parse(
    '{"config_version":2,"__proto__":{"polluted":1},"server":{"__proto__":{"host":"evil"}}}',
  );
  const out = migrated(evil);
  assert.equal({}.polluted, undefined);
  assert.equal(out.polluted, undefined);
  assert.notEqual(out.server.host, 'evil');
});

test('旧预设的 config/optional 条目重映射为 v2 点路径，废弃条目丢弃并提示', () => {
  const { config: out, warnings } = migrateAndNormalize(readJson('tests', 'fixtures', 'legacy.v0.json'));
  const changes = out.presets[0].changes;
  assert.equal(changes['model.ctx_size'], 8192);
  assert.equal(changes['compute.numa'], 'distribute');
  assert.equal(changes['sampling.top_k'], 50);
  assert.equal('model' in changes, false, 'changes 必须是扁平点路径表');
  assert.ok(warnings.some((w) => w.includes('optional.mlock')));
  assert.ok(warnings.some((w) => w.includes('optional.tfs_z')));
});

// ---------------------------------------------------------------------------
// 归一化细节
// ---------------------------------------------------------------------------

test('类型不符的值被丢弃并回落默认，而不是写入 NaN 或对象', () => {
  const out = normalizeConfig({
    server: { host: 42, port: 'abc', timeout: null },
    model: { ctx_size: {}, batch_size: Number.NaN },
    advanced: { tools: 'not-an-array' },
  });
  assert.equal(out.server.host, DEFAULT_CONFIG.server.host);
  assert.equal(out.server.port, DEFAULT_CONFIG.server.port);
  assert.equal(out.server.timeout, DEFAULT_CONFIG.server.timeout, 'null = inherit 时回落默认');
  assert.equal(out.model.ctx_size, null);
  assert.equal(out.model.batch_size, null);
  assert.equal(out.advanced.tools, null);
});

test('默认配置不携带任何参数表未声明的键', () => {
  const defaults = defaultConfig();
  const groups = [
    'server', 'model', 'memory', 'compute', 'sampling', 'speculative',
    'reasoning', 'multimodal', 'lora', 'rpc', 'advanced', 'extra',
  ];
  const seen = new Set();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = `${prefix}.${k}`;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
      else seen.add(key);
    }
  };
  for (const group of groups) walk(defaults[group], group);
  assert.ok(seen.size > 150, `默认值键数异常偏少，说明遍历没生效: ${seen.size}`);
  for (const key of seen) {
    if (key.startsWith('rpc.server.')) continue; // 应用层字段，本来就不在参数表里
    assert.ok(PARAM_INDEX.has(key), `默认值里有参数表不认识的键: ${key}`);
  }
});

test('预设的每个改动键都被参数表认识，且类型匹配', () => {
  const { DEFAULT_PRESETS } = require(path.join(root, 'dist-electron', 'shared', 'constants.js'));
  for (const preset of DEFAULT_PRESETS) {
    for (const [key, value] of Object.entries(preset.changes)) {
      const def = PARAM_INDEX.get(key);
      assert.ok(def, `预设 ${preset.id} 引用了参数表不存在的键: ${key}`);
      const actual = Array.isArray(value) ? 'string[]' : typeof value;
      assert.ok(
        def.type === actual ||
          (def.type === 'int' || def.type === 'float') === (actual === 'number') ||
          (def.type === 'path' || def.type === 'enum' || def.type === 'secret' || def.type === 'string') ===
            (actual === 'string'),
        `预设 ${preset.id} 的 ${key} 类型 ${actual} 与 ${def.type} 不匹配`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 启动前校验
// ---------------------------------------------------------------------------

test('模型目录与模型文件都没设置时给出 error 级问题，字段为点路径', () => {
  const issues = validateParams(defaultConfig());
  const dir = issues.find((i) => i.field === 'server.models_dir');
  assert.ok(dir, '两者都缺时应报出没有可加载模型');
  assert.equal(dir.severity, 'error');
  assert.equal(hasErrors(issues), true);
});

test('只设置模型文件（router 目录留空）不算错误', () => {
  const cfg = defaultConfig();
  cfg.model.model = 'D:\\models\\qwen3-vl.gguf';
  const issues = validateParams(cfg);
  assert.equal(issues.find((i) => i.field === 'server.models_dir'), undefined);
  assert.equal(hasErrors(issues), false);
});

test('预测长度超过上下文只给 warning，不阻断启动', () => {
  const cfg = defaultConfig();
  cfg.server.models_dir = 'D:\\models';
  cfg.model.ctx_size = 4096;
  cfg.model.n_predict = 999999;
  const issues = validateParams(cfg);
  const over = issues.find((i) => i.field === 'model.n_predict');
  assert.ok(over, '应提示 n_predict 超过 ctx_size');
  assert.equal(over.severity, 'warning');
  assert.equal(hasErrors(issues), false);
});

test('非法枚举与越界数值按 error 拦截，inherit 一律放行', () => {
  const cfg = defaultConfig();
  cfg.server.models_dir = 'D:\\models';
  cfg.server.port = 99999;
  cfg.model.flash_attn = 'sometimes';
  cfg.memory.cache_type_k = null;
  const issues = validateParams(cfg);
  assert.ok(issues.some((i) => i.field === 'server.port' && i.severity === 'error'));
  assert.ok(issues.some((i) => i.field === 'model.flash_attn' && i.severity === 'error'));
  assert.equal(issues.find((i) => i.field === 'memory.cache_type_k'), undefined);
});

test('草稿模型缺失按条件必填拦截；ngram 方式不要求草稿模型', () => {
  const cfg = defaultConfig();
  cfg.server.models_dir = 'D:\\models';
  cfg.speculative.spec_type = 'draft-eagle3';
  assert.ok(
    validateParams(cfg).some((i) => i.field === 'speculative.draft_model' && i.severity === 'error'),
  );
  cfg.speculative.spec_type = 'ngram-simple';
  assert.equal(
    validateParams(cfg).find((i) => i.field === 'speculative.draft_model'),
    undefined,
  );
});

test('启用本机 rpc-server 却填 0 端口按 error 拦截', () => {
  const cfg = defaultConfig();
  cfg.server.models_dir = 'D:\\models';
  cfg.rpc.server.enabled = true;
  cfg.rpc.server.port = 0;
  const issues = validateParams(cfg);
  assert.ok(issues.some((i) => i.field === 'rpc.server.port' && i.severity === 'error'));
});
