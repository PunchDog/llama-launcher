import { Config } from '../../../shared/types';
import { SPEC_TYPES, needsDraftMax, needsDraftModel } from '../../../shared/constants';
import { Section, Field, NumberInput, SelectInput, PathInput } from '../ui';

// =============================================================================
// SpecSection — 投机解码（Spec Type / Draft N Max / 草稿模型 / Draft NGL）
// =============================================================================

interface SpecSectionProps {
  config: Config;
  updateField: (key: string, value: unknown) => void;
}

const SPEC_TYPE_OPTIONS = SPEC_TYPES.map((t) => ({
  value: t.value,
  label: `${t.label} — ${t.desc}`,
  title: t.desc,
}));

const NGL_MODE_OPTIONS = [
  { value: 'auto', label: 'auto（默认）' },
  { value: 'all', label: 'all（全部卸载 GPU）' },
  { value: 'custom', label: '自定义层数' },
] as const;

export default function SpecSection({ config, updateField }: SpecSectionProps) {
  const specType = config.spec_type || 'none';
  // NGL 模式：'all' / 纯数字（custom）/ 其他归为 'auto'
  const draftNglMode =
    config.spec_draft_ngl === 'all'
      ? 'all'
      : /^\d+$/.test(config.spec_draft_ngl || '')
        ? 'custom'
        : 'auto';

  const handleNglModeChange = (mode: string) => {
    updateField('spec_draft_ngl', mode === 'custom' ? '0' : mode);
  };

  const pickDraftModel = async () => {
    const file = await window.electronAPI.invoke('dialog:open-file');
    if (file) updateField('spec_draft_model', file);
  };

  return (
    <Section
      title="投机解码"
      desc="Speculative Decoding：用草稿模型（或 n-gram）预生成 token 再由主模型验证，显著提升解码速度"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Spec Type">
          <SelectInput
            value={specType}
            onChange={(v) => updateField('spec_type', v)}
            options={SPEC_TYPE_OPTIONS}
          />
        </Field>
        {needsDraftMax(specType) && (
          <Field label="Draft N Max" hint="最多草拟的 token 数（--spec-draft-n-max）">
            <NumberInput value={config.mtp} onChange={(v) => updateField('mtp', v)} min={0} />
          </Field>
        )}
      </div>

      {needsDraftModel(specType) && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="草稿模型路径" hint="DFlash2 / EAGLE3 等草稿模型 GGUF 文件">
            <PathInput
              value={config.spec_draft_model || ''}
              onChange={(v) => updateField('spec_draft_model', v)}
              onPick={pickDraftModel}
              placeholder="选择草稿模型 .gguf 文件"
            />
          </Field>
          <Field label="Draft NGL" hint="草稿模型 GPU 层数（--spec-draft-ngl）">
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <SelectInput
                  value={draftNglMode}
                  onChange={handleNglModeChange}
                  options={NGL_MODE_OPTIONS}
                />
              </div>
              {draftNglMode === 'custom' && (
                <div className="w-20 shrink-0">
                  <NumberInput
                    value={/^\d+$/.test(config.spec_draft_ngl || '') ? parseInt(config.spec_draft_ngl, 10) : 0}
                    onChange={(v) => updateField('spec_draft_ngl', String(v))}
                    min={0}
                  />
                </div>
              )}
            </div>
          </Field>
        </div>
      )}
    </Section>
  );
}
