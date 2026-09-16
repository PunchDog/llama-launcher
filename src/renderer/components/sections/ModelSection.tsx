import { Config } from '../../../shared/types';
import { Section, Field, PathInput, NumberInput, TextInput } from '../ui';

// =============================================================================
// ModelSection — 模型目录 / 最大加载 / 超时 / API Key
// =============================================================================

interface ModelSectionProps {
  config: Config;
  updateField: (key: string, value: unknown) => void;
}

export default function ModelSection({ config, updateField }: ModelSectionProps) {
  const pickModelsDir = async () => {
    const folder = await window.electronAPI.invoke('dialog:open-folder');
    if (folder) updateField('models_dir', folder);
  };

  return (
    <Section title="模型配置" desc="llama-server 加载模型的根目录与基础服务参数">
      <div className="grid grid-cols-2 gap-3">
        <Field label="模型目录" span={2}>
          <PathInput
            value={config.models_dir}
            onChange={(v) => updateField('models_dir', v)}
            onPick={pickModelsDir}
            placeholder="未选择"
            title={config.models_dir}
          />
        </Field>
        <Field label="最大加载">
          <NumberInput
            value={config.models_max}
            onChange={(v) => updateField('models_max', v)}
            min={0}
          />
        </Field>
        <Field label="超时(s)">
          <NumberInput value={config.timeout} onChange={(v) => updateField('timeout', v)} min={0} />
        </Field>
        <Field label="API Key" span={2} hint="留空则不校验；设置后客户端需在 Authorization 中携带">
          <TextInput
            value={config.api_key}
            onChange={(v) => updateField('api_key', v)}
            mono
            placeholder="sk-..."
          />
        </Field>
      </div>
    </Section>
  );
}
