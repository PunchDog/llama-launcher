import { useState, useEffect, useRef, useMemo } from 'react';
import { Config } from '../../../shared/types';
import { useConfigStore } from '../../stores/configStore';
import { Section, SelectInput, Button, type SelectOption } from '../ui';

// =============================================================================
// PresetSection — 参数预设（数据来自 config.json 顶层 presets 字段）
//   预设只写「点路径 → 值」，套用即按路径覆盖；未在预设里出现的参数保持原值
// =============================================================================

interface PresetSectionProps {
  config: Config;
}

export default function PresetSection({ config }: PresetSectionProps) {
  const setParams = useConfigStore((s) => s.setParams);
  const presets = useMemo(() => config.presets ?? [], [config.presets]);
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? '');
  const [appliedName, setAppliedName] = useState('');
  const timerRef = useRef<number | null>(null);

  // 预设列表变化（手改 config.json）后校正选中项
  useEffect(() => {
    if (presets.length > 0 && !presets.some((p) => p.id === selectedId)) {
      setSelectedId(presets[0].id);
    }
  }, [presets, selectedId]);

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const selected = presets.find((p) => p.id === selectedId);

  const options: SelectOption[] = presets.map((p) => ({
    value: p.id,
    label: `${p.name} — ${p.desc}`,
    title: p.hint,
  }));

  const handleApply = () => {
    if (!selected) return;
    // 走 configStore 的统一写路径：一次乐观合批 + 一次落盘，非法路径在那里拦下
    setParams({ ...selected.changes } as unknown as Record<string, unknown>);
    setAppliedName(selected.name);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setAppliedName(''), 3000);
  };

  return (
    <Section title="参数预设" desc="一键套用一组优化参数；预设存于 config.json 的 presets 字段，可手动编辑增删">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <SelectInput
            value={selectedId}
            onChange={setSelectedId}
            options={options}
            disabled={presets.length === 0}
          />
        </div>
        <Button variant="primary" onClick={handleApply} disabled={!selected}>
          应用预设
        </Button>
      </div>
      <div className="mt-2">
        {appliedName ? (
          <p className="text-xs text-green-400 transition-colors">已应用预设：{appliedName}</p>
        ) : selected ? (
          <p className="text-xs text-gray-500 transition-colors">{selected.hint}</p>
        ) : (
          <p className="text-xs text-gray-500">config.json 中未定义任何预设</p>
        )}
      </div>
    </Section>
  );
}
