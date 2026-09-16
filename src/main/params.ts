import { Config } from '../shared/types';
import { needsDraftModel } from '../shared/constants';

export function buildArgs(cfg: Config): string[] {
  const args: string[] = [];

  // Required args
  args.push('--models-dir', cfg.models_dir);
  args.push('--models-max', String(cfg.models_max));
  args.push('--timeout', String(cfg.timeout));
  args.push('--host', cfg.host);
  args.push('--port', String(cfg.port));
  args.push('-ngl', String(cfg.ngl));
  args.push('--flash-attn', cfg.flash_attn);
  args.push('--cache-type-k', cfg.cache_type_k);
  args.push('--cache-type-v', cfg.cache_type_v);
  args.push('-t', String(cfg.threads));
  args.push('-b', String(cfg.batch_size));
  args.push('-c', String(cfg.ctx_size));
  args.push('--n-predict', String(cfg.n_predict));
  args.push('--parallel', String(cfg.parallel));
  args.push('--metrics');
  args.push('-tb', String(cfg.tensor_batch));
  args.push('--kv-unified');

  // 投机解码 — 按 spec_type 分支生成
  const specType = cfg.spec_type || 'none';
  if (specType !== 'none') {
    args.push('--spec-type', specType);
    // draft-* 类需要草拟 token 上限；ngram-* 类不支持该参数
    if (specType.startsWith('draft-') && cfg.mtp > 0) {
      args.push('--spec-draft-n-max', String(cfg.mtp));
    }
    // 需要草稿模型文件的类型（DFlash2 走 draft-dflash + --spec-draft-model）
    if (needsDraftModel(specType)) {
      if (cfg.spec_draft_model) {
        args.push('--spec-draft-model', cfg.spec_draft_model);
      }
      const draftNgl = cfg.spec_draft_ngl || 'auto';
      if (draftNgl !== 'auto') {
        args.push('--spec-draft-ngl', draftNgl);
      }
    }
  }

  // 离线模式 — 阻止 llama-server 主动发起外部 HTTP 请求（如 HF 下载）
  // 不加 --offline 因为 Router 模式需要 localhost 内部 HTTP 通信
  // args.push('--offline');

  // Optional args — only added when different from default
  const opt = cfg.optional;
  if (opt.model) args.push('--model', opt.model);
  if (opt.cont_batching) args.push('--cont-batching');
  if (opt.log_format) args.push('--log-format', opt.log_format);
  if (opt.log_disable) args.push('--log-disable');
  if (opt.verbose) args.push('--verbose');
  if (opt.mlock) args.push('--mlock');
  if (opt.no_mmap) args.push('--no-mmap');
  if (opt.embedding) args.push('--embedding');
  if (opt.pooling && opt.pooling !== 'none') args.push('--pooling', opt.pooling);
  if (opt.rope_scaling) args.push('--rope-scaling', opt.rope_scaling);
  if (opt.rope_freq_base > 0) args.push('--rope-freq-base', String(opt.rope_freq_base));
  if (opt.rope_freq_scale > 0) args.push('--rope-freq-scale', opt.rope_freq_scale.toFixed(4));
  if (opt.numa) args.push('--numa');
  if (opt.low_vram) args.push('--low-vram');

  // Sampling — only added when different from default
  if (opt.tfs_z < 1.0) args.push('--tfs-z', opt.tfs_z.toFixed(2));
  if (opt.top_k > 0 && opt.top_k !== 40) args.push('--top-k', String(opt.top_k));
  if (opt.top_p > 0 && opt.top_p !== 0.95) args.push('--top-p', opt.top_p.toFixed(2));
  if (opt.min_p > 0) args.push('--min-p', opt.min_p.toFixed(2));
  if (opt.temperature > 0 && opt.temperature !== 0.8) args.push('--temperature', opt.temperature.toFixed(2));

  // Penalties — only added when different from default
  if (opt.repeat_penalty > 0 && opt.repeat_penalty !== 1.1) args.push('--repeat-penalty', opt.repeat_penalty.toFixed(2));
  if (opt.repeat_last_n > 0 && opt.repeat_last_n !== 64) args.push('--repeat-last-n', String(opt.repeat_last_n));
  if (opt.presence_penalty > 0) args.push('--presence-penalty', opt.presence_penalty.toFixed(2));
  if (opt.frequency_penalty > 0) args.push('--frequency-penalty', opt.frequency_penalty.toFixed(2));

  // API Key
  if (cfg.api_key) args.push('--api-key', cfg.api_key);

  // Chat template
  if (opt.jinja) args.push('--jinja');
  if (opt.chatTemplateKwargs) args.push('--chat-template-kwargs', opt.chatTemplateKwargs);

  // RPC Server
  if (cfg.rpc_server.enabled) {
    args.push('--rpc-server');
    args.push('--rpc-server-host', cfg.rpc_server.host);
    args.push('--rpc-server-port', String(cfg.rpc_server.port));
    args.push('--rpc-workers', String(cfg.rpc_server.workers));
    args.push('--rpc-timeout', String(cfg.rpc_server.timeout));
  }

  return args;
}