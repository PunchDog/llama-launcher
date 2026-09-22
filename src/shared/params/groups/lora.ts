// =============================================================================
// 参数组：LoRA 与控制向量 — 启动时叠加到主模型上的适配器与风格向量
//   本文件是这些参数的唯一声明处：命令行、校验、UI、默认值、v1 迁移都由它推导
//   适配器列表在加载期定死，运行中只能靠 POST /lora-adapters 切换，故需配合 lora_init_without_apply
// =============================================================================

import type { ParamDef } from '../schema';
import type { ConfigKey } from '../../types';

export const PARAMS_LORA = [
  {
    key: 'lora.lora',
    flag: '--lora',
    emit: 'csv',
    type: 'string[]',
    tier: 1,
    group: 'lora',
    label: 'LoRA 适配器',
    desc: '多个适配器会合并成一次逗号分隔传参，并按填写顺序叠加；与「LoRA 适配器（带强度）」二选一，同一文件在两边都填会被重复加载一遍',
  },
  {
    key: 'lora.lora_scaled',
    flag: '--lora-scaled',
    type: 'string',
    tier: 2,
    group: 'lora',
    label: 'LoRA 适配器（带强度）',
    desc: '整串按 FNAME:SCALE,... 原样交给 llama-server，SCALE 1.0 为原强度、0 等于不生效、>1 加强；想逐个调权重时用这条替代「LoRA 适配器」',
  },
  {
    key: 'lora.control_vector',
    flag: '--control-vector',
    emit: 'csv',
    type: 'string[]',
    tier: 2,
    group: 'lora',
    label: '控制向量',
    desc: '加载 llama-control-vector 产出的向量文件，强度已在生成时定死，可一次多个；它作用在激活值上，与 LoRA 同时挂会叠加两种影响',
  },
  {
    key: 'lora.control_vector_scaled',
    flag: '--control-vector-scaled',
    type: 'string',
    tier: 2,
    group: 'lora',
    label: '控制向量（带强度）',
    desc: '整串按 FNAME:SCALE,... 原样传递，SCALE 1.0 为原强度、0 相当于关掉该向量；与「控制向量」二选一',
  },
  {
    key: 'lora.control_vector_layer_range',
    flag: '--control-vector-layer-range',
    emit: 'spread',
    type: 'string[]',
    tier: 2,
    group: 'lora',
    label: '控制向量层范围',
    desc: '把向量的作用范围限制在起止层号之间（含两端），只在中间层施加风格时用；两项分别填起始层与结束层，如 5 与 20',
    validate: (v) => {
      const items = (v as unknown[]).map(String);
      if (items.length !== 2) return '需要恰好两项：起始层号、结束层号';
      if (items.some((item) => !/^\d+$/.test(item.trim()))) return '起止层号必须是非负整数';
      return null;
    },
  },
  {
    key: 'lora.lora_init_without_apply',
    flag: '--lora-init-without-apply',
    type: 'bool',
    llamaDefault: 'disabled',
    tier: 2,
    group: 'lora',
    label: '加载但不应用',
    desc: '启动时把适配器读进内存却不生效，之后靠 POST /lora-adapters 在线切换，做对比或多风格热切换才有意义；代价是这些适配器的显存占用从一开始就存在',
  },
] as const satisfies readonly ParamDef<ConfigKey>[];
