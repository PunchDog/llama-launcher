import { Config } from '../../../shared/types';
import { Section, Field, TextInput, NumberInput, SelectInput, Switch } from '../ui';

// =============================================================================
// CoreParamsSection — 网络与核心参数（Host/Port/线程/上下文/批大小/KV 等）
// =============================================================================

interface CoreParamsSectionProps {
  config: Config;
  updateField: (key: string, value: unknown) => void;
}

const FLASH_ATTN_OPTIONS = [
  { value: 'auto', label: 'auto' },
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
] as const;

const CACHE_TYPE_OPTIONS = [
  { value: 'f16', label: 'f16' },
  { value: 'f32', label: 'f32' },
  { value: 'q8_0', label: 'q8_0' },
  { value: 'q4_0', label: 'q4_0' },
] as const;

export default function CoreParamsSection({ config, updateField }: CoreParamsSectionProps) {
  return (
    <Section title="网络与核心参数" desc="服务监听地址与推理核心参数，修改后即时写入配置">
      <div className="grid grid-cols-4 gap-3">
        <Field label="Host">
          <TextInput value={config.host} onChange={(v) => updateField('host', v)} />
        </Field>
        <Field label="Port">
          <NumberInput value={config.port} onChange={(v) => updateField('port', v)} min={0} />
        </Field>
        <Field label="线程">
          <NumberInput value={config.threads} onChange={(v) => updateField('threads', v)} min={0} />
        </Field>
        <Field label="上下文">
          <NumberInput value={config.ctx_size} onChange={(v) => updateField('ctx_size', v)} min={0} />
        </Field>
        <Field label="预测长度">
          <NumberInput
            value={config.n_predict}
            onChange={(v) => updateField('n_predict', v)}
            min={0}
          />
        </Field>
        <Field label="并行数">
          <NumberInput value={config.parallel} onChange={(v) => updateField('parallel', v)} min={0} />
        </Field>
        <Field label="GPU 层数" hint="999 表示全部卸载">
          <NumberInput value={config.ngl} onChange={(v) => updateField('ngl', v)} min={0} />
        </Field>
        <Field label="批大小">
          <NumberInput
            value={config.batch_size}
            onChange={(v) => updateField('batch_size', v)}
            min={0}
          />
        </Field>
        <Field label="张量批">
          <NumberInput
            value={config.tensor_batch}
            onChange={(v) => updateField('tensor_batch', v)}
            min={0}
          />
        </Field>
        <Field label="Flash Attn">
          <SelectInput
            value={config.flash_attn}
            onChange={(v) => updateField('flash_attn', v)}
            options={FLASH_ATTN_OPTIONS}
          />
        </Field>
        <Field label="Cache K">
          <SelectInput
            value={config.cache_type_k}
            onChange={(v) => updateField('cache_type_k', v)}
            options={CACHE_TYPE_OPTIONS}
          />
        </Field>
        <Field label="Cache V">
          <SelectInput
            value={config.cache_type_v}
            onChange={(v) => updateField('cache_type_v', v)}
            options={CACHE_TYPE_OPTIONS}
          />
        </Field>
        <Field label="">
          <Switch label="Metrics" checked={config.metrics} onChange={(v) => updateField('metrics', v)} />
        </Field>
        <Field label="">
          <Switch
            label="KV Unified"
            checked={config.kv_unified}
            onChange={(v) => updateField('kv_unified', v)}
          />
        </Field>
      </div>
    </Section>
  );
}
