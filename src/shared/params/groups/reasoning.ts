// =============================================================================
// 参数组：推理/思考链 — reasoning 开关与格式、思考预算、模板附加参数
//   本文件是这些参数的唯一声明处：命令行、校验、UI、默认值、v1 迁移都由它推导
//   思考内容是否出现在响应里由 format/preserve 共同决定，模板不认识思考标签时会泄漏进正文
// =============================================================================

import type { ParamDef } from '../schema';
import type { ConfigKey } from '../../types';

export const PARAMS_REASONING = [
  {
    key: 'reasoning.reasoning',
    flag: '--reasoning',
    short: '-rea',
    type: 'enum',
    llamaDefault: "'auto' (detect from template)",
    envName: 'LLAMA_ARG_REASONING',
    tier: 0,
    group: 'reasoning',
    label: '思考链',
    desc: '是否在对话里启用 reasoning/thinking。off 会关掉思考链输出，模型即使生成思考内容也会被丢弃；auto 跟随模板与模型元数据判定',
    options: ['on', 'off', 'auto'],
  },
  {
    key: 'reasoning.reasoning_format',
    flag: '--reasoning-format',
    type: 'enum',
    llamaDefault: 'auto',
    envName: 'LLAMA_ARG_THINK',
    tier: 0,
    group: 'reasoning',
    label: '思考标签格式',
    desc: '决定思考标签是否允许、以及如何从响应里抽取：none 丢弃思考内容，deepseek 抽取到 reasoning_content 字段；选错格式会让思考文本混进正常回复里',
    options: ['auto', 'none', 'deepseek', 'deepseek-legacy'],
  },
  {
    key: 'reasoning.reasoning_effort',
    flag: '--reasoning-effort',
    type: 'enum',
    llamaDefault: 'default',
    envName: 'LLAMA_ARG_REASONING_EFFORT',
    tier: 1,
    group: 'reasoning',
    label: '思考强度',
    desc: '传给聊天模板的 reasoning_effort 档位，只有模板读取该变量时才生效；对简单问题调高只会白白多花时间',
    options: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    key: 'reasoning.reasoning_budget',
    flag: '--reasoning-budget',
    type: 'int',
    llamaDefault: -1,
    envName: 'LLAMA_ARG_THINK_BUDGET',
    tier: 1,
    group: 'reasoning',
    label: '思考预算',
    desc: '思考阶段的 token 预算：-1 不限，0 立即结束思考（等于不出思考链），>0 到量后注入收尾提示。设小了会让复杂问题答得更差',
    min: -1,
    unit: 'tokens',
  },
  {
    key: 'reasoning.reasoning_budget_message',
    flag: '--reasoning-budget-message',
    type: 'string',
    llamaDefault: 'none',
    envName: 'LLAMA_ARG_THINK_BUDGET_MESSAGE',
    tier: 2,
    group: 'reasoning',
    label: '超预算提示语',
    desc: '思考用尽预算时插入到结束标签之前的一句话，用来强制模型立刻给结论；none 表示不插入',
  },
  {
    key: 'reasoning.reasoning_preserve',
    flag: '--reasoning-preserve',
    negFlag: '--no-reasoning-preserve',
    type: 'bool',
    llamaDefault: 'enabled',
    tier: 1,
    group: 'reasoning',
    label: '保留历史思考',
    desc: '把之前各轮的思考内容一起回传给模型，多轮推理更连贯；代价是 prompt 与 KV cache 明显变大，长对话时更易触发截断',
  },
  {
    key: 'reasoning.chat_template_kwargs',
    flag: '--chat-template-kwargs',
    type: 'string',
    widget: 'json',
    envName: 'LLAMA_ARG_CHAT_TEMPLATE_KWARGS',
    tier: 2,
    group: 'reasoning',
    label: '模板附加参数',
    desc: '追加给模板解析器的额外变量，必须是合法的 JSON 对象字符串，例如 {"style":"tulu"}；写坏的 JSON 会让请求直接失败',
    validate: (v) => {
      const text = String(v);
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return '模板附加参数必须是 JSON 对象';
        return null;
      } catch (err) {
        return `模板附加参数不是合法 JSON 对象：${err instanceof Error ? err.message : String(err)}`;
      }
    },
    legacy: { path: 'optional.chatTemplateKwargs', emits: (v) => Boolean(v) },
  },
  {
    key: 'reasoning.prefill_assistant',
    flag: '--prefill-assistant',
    negFlag: '--no-prefill-assistant',
    type: 'bool',
    llamaDefault: 'prefill enabled',
    tier: 2,
    group: 'reasoning',
    label: '预填充 assistant',
    desc: '用模板里的生成引导语预填充 assistant 轮，让续写更贴合模板；模板自带思考标签引导时关掉它可以避免思考内容重复',
  },
  {
    key: 'reasoning.skip_chat_parsing',
    flag: '--skip-chat-parsing',
    negFlag: '--no-skip-chat-parsing',
    type: 'bool',
    llamaDefault: 'disabled',
    tier: 2,
    group: 'reasoning',
    label: '跳过消息解析',
    desc: '不解析 OpenAI 请求的 messages 内容（含多模态数组），原样交给模板；只有非标准客户端才需要，开启后多模态输入会失效',
  },
] as const satisfies readonly ParamDef<ConfigKey>[];
