// =============================================================================
// 参数组：逃生口 — 元数据表还没覆盖的参数，原样追加到命令行末尾
//   本文件是这些参数的唯一声明处：命令行、校验、UI、默认值、v1 迁移都由它推导
//   raw 发射且永远排在最后，所以同名参数的最终值以这里为准
// =============================================================================

import type { ParamDef } from '../schema';
import type { ConfigKey } from '../../types';

export const PARAMS_EXTRA = [
  {
    key: 'extra.args',
    emit: 'raw',
    type: 'string[]',
    tier: 2,
    group: 'extra',
    label: '追加原始参数',
    desc: '不做任何校验地追加到命令行末尾，用来试元数据表里还没有的新 flag，或临时压住界面上的某个值；因为排在最后，它会覆盖前面同名参数。每个数组元素就是一个独立的命令行参数，所以 flag 和它的取值要分成两项写，如 `--parallel`、`1`',
    default: [],
  },
] as const satisfies readonly ParamDef<ConfigKey>[];
