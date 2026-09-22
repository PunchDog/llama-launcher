// =============================================================================
// ParamDef — llama-server 参数的唯一声明结构
//   groups/*.ts 里的表是本项目的唯一事实来源：命令行发射、校验、UI 控件、
//   默认配置、v1 迁移全部由这张表推导，禁止在任何其他地方硬编码参数名。
//
// 三态约定（Tri）：
//   null      = inherit，不发射该参数，交给 llama.cpp 自己决定（llamaDefault）
//   非 null   = explicit，发射该参数
//   数组型参数用 [] 表示 inherit
//
// 为什么三态不是美化：llama-server 的 --fit 只会调整「未显式设置」的参数，
// 旧版对 -c/-b/-ngl/--parallel 无条件发射，等于永久关掉了 --fit。
// =============================================================================

import type { Tri } from '../types';

/** 参数发射方式 */
export type EmitKind =
  /** `--flag <值>`，布尔型带值参数（on/off/auto）同此 */
  | 'value'
  /** 裸开关：true → `--flag`；false → `--neg-flag`（未声明 negFlag 时不发射） */
  | 'flagIfTrue'
  /** 数组 → `--flag a,b,c` */
  | 'csv'
  /** 数组 → `--flag a --flag b` */
  | 'repeat'
  /** 数组 → `--flag a b`（llama 要求一个 flag 跟多个独立 argv 时用） */
  | 'spread'
  /** 数组元素原样作为独立 argv 追加（仅 extra.args 逃生口使用，永远排在最后） */
  | 'raw'
  /** 应用层字段，永不发射到 llama-server 命令行 */
  | 'none';

export type ParamType =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  /** 密钥类字符串：命令行预览与日志里一律脱敏，界面用密码框 */
  | 'secret'
  | 'enum'
  /** 文件/目录路径；pathKind 决定界面「浏览」按钮弹哪种对话框 */
  | 'path'
  | 'string[]';

/** 参数分组 id — 决定 UI 卡片与命令行发射顺序 */
export type ParamGroupId =
  | 'server'
  | 'model'
  | 'memory'
  | 'compute'
  | 'sampling'
  | 'speculative'
  | 'reasoning'
  | 'multimodal'
  | 'lora'
  | 'rpc'
  | 'advanced'
  | 'extra';

/**
 * 一条依赖规则：本参数只在目标 key 命中条件时发射。
 * oneOf 与 noneOf 二选一：noneOf 用来表达「 llama 默认开着，只有显式关掉才失效」这类条件
 * （如 --fit-target 只在 --fit 不为 off 时有效，而 fit 留 inherit 时它其实仍然有效）。
 */
export interface RequireRule {
  key: string;
  oneOf?: readonly unknown[];
  noneOf?: readonly unknown[];
}

export interface ParamDef<K extends string = string> {
  /** v2 配置里的点路径，如 'model.ctx_size'；同时是 config:update 的路径 */
  key: K;
  /** CLI 长选项；emit 为 'none' 时可省略 */
  flag?: string;
  /** 短选项（仅用于展示与 v1 迁移对照，发射时统一用长选项，可读性优先） */
  short?: string;
  /** 布尔参数的关闭形态，如 --no-kv-unified */
  negFlag?: string;
  /** 发射方式；缺省：bool → 'flagIfTrue'，其余 → 'value' */
  emit?: EmitKind;
  type: ParamType;
  /** llama-server --help 里的真实默认值说明，用于「跟随默认 (xxx)」展示 */
  llamaDefault?: string | number | boolean;
  /** 对应环境变量（help 里的 env: LLAMA_ARG_*），仅用于提示：设环境变量会盖过命令行 */
  envName?: string;
  /** 界面层级：0 常用 / 1 进阶 / 2 专家（默认只显示 tier ≤ 当前层级） */
  tier: 0 | 1 | 2;
  group: ParamGroupId;
  /** 控件标题（专有名词保留英文，说明文字用中文） */
  label: string;
  /** 中文说明：做什么、什么时候需要、副作用 */
  desc?: string;
  min?: number;
  max?: number;
  step?: number;
  /** 小数位；0 表示整数（发射时按 String(v)，>0 时按 toFixed 定长输出） */
  precision?: number;
  unit?: string;
  /** 枚举候选值；'inherit' 由控件统一注入，不写在这里 */
  options?: readonly string[];
  /** type='path' 时界面「浏览」按钮的对话框类型，缺省按文件处理 */
  pathKind?: 'file' | 'dir';
  /** 仅影响界面控件选型，不参与发射与校验：'json' 用带解析校验的多行编辑器 */
  widget?: 'json';
  /** 依赖条件：不满足时既不发射，也会在校验时给出 warning */
  requires?: readonly RequireRule[];
  /** 条件必填：目标 key 命中 oneOf 时本字段不得为空 */
  requiredWhen?: { rule: RequireRule; message: string };
  /** UI 可见性（ngram 参数按 spec_type 显示这类），不影响发射 */
  visibleWhen?: (params: Record<string, unknown>) => boolean;
  /** 自定义校验（error 级）；返回文案表示不合法 */
  validate?: (value: unknown, cfg: unknown) => string | null;
  /** 配置默认值（缺省 = null，即 inherit）；仅 launcher 必须知道的值显式给 */
  default?: Tri<number | string | boolean | readonly string[]>;
  /** v1（config_version 1）里的字段路径与「旧版是否会发射」的谓词 */
  legacy?: {
    path: string;
    /** 返回 false 表示旧版不会发射 → 迁移为 inherit(null)；缺省表示总是显式 */
    emits?: (value: unknown) => boolean;
  };
}

export type AnyParamDef = ParamDef<string>;

/**
 * 把嵌套的 ParamsConfig 展平成「组.字段」点路径联合类型。
 * ParamDef.key 用它做编译期约束：元数据表里写错路径直接报类型错误，
 * 不会出现界面能改、命令行永不生效的死字段。
 */
export type ParamKeyOf<T> = {
  [K in keyof T & string]: NonNullable<T[K]> extends readonly unknown[]
    ? K
    : NonNullable<T[K]> extends object
      ? `${K}.${ParamKeyOf<NonNullable<T[K]>>}`
      : K;
}[keyof T & string];
