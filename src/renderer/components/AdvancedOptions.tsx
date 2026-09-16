import { useCallback } from 'react';
import { useConfig } from '../hooks/useConfig';
import { Section, Field, TextInput, NumberInput, Switch } from './ui';

// =============================================================================
// AdvancedOptions — 采样 / Penalty / RoPE / 功能开关 / 日志 / 对话模板
// =============================================================================

export default function AdvancedOptions() {
  const { config, updateField } = useConfig();

  const handleUpdate = useCallback(
    (key: string, value: unknown) => {
      updateField(key, value);
    },
    [updateField],
  );

  if (!config) {
    return <div className="text-gray-400 text-sm">加载配置中...</div>;
  }

  const opt = config.optional;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        {/* 模型 */}
        <Section title="模型" desc="留空则自动扫描 models_dir 下的模型文件">
          <Field label="模型路径">
            <TextInput
              value={opt.model}
              onChange={(v) => handleUpdate('optional.model', v)}
              placeholder="留空则自动扫描 models_dir"
              mono
            />
          </Field>
        </Section>

        {/* 采样参数 */}
        <Section title="采样参数" desc="控制生成文本的随机性与多样性">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperature" hint="越低越确定，越高越发散">
              <NumberInput
                value={opt.temperature}
                onChange={(v) => handleUpdate('optional.temperature', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="Top-K">
              <NumberInput
                value={opt.top_k}
                onChange={(v) => handleUpdate('optional.top_k', v)}
                min={0}
              />
            </Field>
            <Field label="Top-P">
              <NumberInput
                value={opt.top_p}
                onChange={(v) => handleUpdate('optional.top_p', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="Min-P">
              <NumberInput
                value={opt.min_p}
                onChange={(v) => handleUpdate('optional.min_p', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="TFS-Z">
              <NumberInput
                value={opt.tfs_z}
                onChange={(v) => handleUpdate('optional.tfs_z', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="Repeat Last N">
              <NumberInput
                value={opt.repeat_last_n}
                onChange={(v) => handleUpdate('optional.repeat_last_n', v)}
                min={0}
              />
            </Field>
          </div>
        </Section>

        {/* Penalty 参数 */}
        <Section title="Penalty" desc="重复惩罚相关参数，0 表示不额外惩罚" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeat Penalty">
              <NumberInput
                value={opt.repeat_penalty}
                onChange={(v) => handleUpdate('optional.repeat_penalty', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="Presence Penalty">
              <NumberInput
                value={opt.presence_penalty}
                onChange={(v) => handleUpdate('optional.presence_penalty', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="Frequency Penalty">
              <NumberInput
                value={opt.frequency_penalty}
                onChange={(v) => handleUpdate('optional.frequency_penalty', v)}
                min={0}
                precision={2}
              />
            </Field>
          </div>
        </Section>

        {/* RoPE & Pooling */}
        <Section title="RoPE & Pooling" desc="位置编码缩放与句向量池化方式" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RoPE Scaling">
              <TextInput
                value={opt.rope_scaling}
                onChange={(v) => handleUpdate('optional.rope_scaling', v)}
                placeholder="如 linear / yarn"
              />
            </Field>
            <Field label="Pooling">
              <TextInput
                value={opt.pooling}
                onChange={(v) => handleUpdate('optional.pooling', v)}
                placeholder="none / mean / cls / last"
              />
            </Field>
            <Field label="Freq Base">
              <NumberInput
                value={opt.rope_freq_base}
                onChange={(v) => handleUpdate('optional.rope_freq_base', v)}
                min={0}
                precision={2}
              />
            </Field>
            <Field label="Freq Scale">
              <NumberInput
                value={opt.rope_freq_scale}
                onChange={(v) => handleUpdate('optional.rope_freq_scale', v)}
                min={0}
                precision={2}
              />
            </Field>
          </div>
        </Section>

        {/* 功能选项 */}
        <Section title="功能选项" desc="按需开启，未列出的开关保持 llama.cpp 默认值" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            <Switch
              label="Cont Batching"
              checked={opt.cont_batching}
              onChange={(v) => handleUpdate('optional.cont_batching', v)}
            />
            <Switch
              label="Verbose"
              checked={opt.verbose}
              onChange={(v) => handleUpdate('optional.verbose', v)}
            />
            <Switch label="MLock" checked={opt.mlock} onChange={(v) => handleUpdate('optional.mlock', v)} />
            <Switch
              label="No MMap"
              checked={opt.no_mmap}
              onChange={(v) => handleUpdate('optional.no_mmap', v)}
            />
            <Switch
              label="Embedding"
              checked={opt.embedding}
              onChange={(v) => handleUpdate('optional.embedding', v)}
            />
            <Switch
              label="Log Disable"
              checked={opt.log_disable}
              onChange={(v) => handleUpdate('optional.log_disable', v)}
            />
            <Switch label="NUMA" checked={opt.numa} onChange={(v) => handleUpdate('optional.numa', v)} />
            <Switch
              label="Low VRAM"
              checked={opt.low_vram}
              onChange={(v) => handleUpdate('optional.low_vram', v)}
            />
          </div>
        </Section>

        {/* 日志 */}
        <Section title="日志" desc="留空使用 llama.cpp 默认文本格式" defaultOpen={false}>
          <Field label="日志格式">
            <TextInput
              value={opt.log_format}
              onChange={(v) => handleUpdate('optional.log_format', v)}
              placeholder="text / json"
            />
          </Field>
        </Section>

        {/* 对话模板 */}
        <Section title="对话模板" desc="Jinja 模板与模板参数（--chat-template-kwargs）" defaultOpen={false}>
          <div className="space-y-3">
            <Switch label="使用 Jinja 模板（--jinja）" checked={opt.jinja} onChange={(v) => handleUpdate('optional.jinja', v)} />
            <Field label="Chat Template Kwargs">
              <TextInput
                value={opt.chatTemplateKwargs}
                onChange={(v) => handleUpdate('optional.chatTemplateKwargs', v)}
                placeholder='{"preserve_thinking":true}'
                mono
              />
            </Field>
          </div>
        </Section>
      </div>
    </div>
  );
}
