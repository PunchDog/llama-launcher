import type { AnyParamDef } from '../../../shared/params/schema';
import { isInherit } from '../../../shared/params';
import { JsonEditor, PathInput, SelectInput, TextInput, NumberWithUnit, inputBase } from '../ui';
import type { SelectOption } from '../ui';
import { useParam, useParamMeta } from '../../hooks/useParam';
import { invoke } from '../../hooks/api';
import TriStateControl from './TriStateControl';

// =============================================================================
// ParamField — 按 ParamDef 元数据渲染单个三态参数控件（自订阅，改一个只重渲染一个）
//   inherit（config 里为 null / [] / ''）= 不发射该参数，交给 llama-server 决定；
//   控件必须能表达这三态，否则用户无法把参数改回「跟随默认」，--fit 也就永久失效。
//   有 options 的（枚举 / 布尔）把「跟随默认」做成下拉首项；其余用标题行切换按钮。
// =============================================================================

interface ParamFieldProps {
  def: AnyParamDef;
  /** 是否显示 desc 说明文字（进阶/专家层级用） */
  showDesc?: boolean;
  disabled?: boolean;
  span?: number;
}

/** inherit → 自定义时的起始值：优先启动器默认，再取 llama 默认（不可解析时给中性值） */
function seedValue(def: AnyParamDef): unknown {
  const raw = def.default ?? def.llamaDefault;
  switch (def.type) {
    case 'int':
    case 'float': {
      const num = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(num) ? num : 0;
    }
    case 'bool':
      return true;
    case 'string[]':
      return Array.isArray(raw) ? [...raw] : [];
    case 'enum':
      return def.options?.[0] ?? '';
    default:
      return typeof raw === 'string' ? raw : '';
  }
}

export default function ParamField({ def, showDesc = false, disabled = false, span = 1 }: ParamFieldProps) {
  const { value, setValue, deviated, reset } = useParam(def.key);
  const { tooltip, inheritLabel } = useParamMeta(def);
  const inherit = isInherit(value);

  const control = () => {
    if (def.type === 'bool') {
      const options: SelectOption[] = [
        { value: '', label: inheritLabel, title: '不传该参数，由 llama-server 决定' },
        { value: '1', label: `开启 ${def.flag ?? ''}` },
      ];
      if (def.negFlag) options.push({ value: '0', label: `关闭 ${def.negFlag}` });
      return (
        <SelectInput
          value={inherit ? '' : value ? '1' : '0'}
          onChange={(v) => setValue(v === '' ? null : v === '1')}
          options={options}
          disabled={disabled}
          title={tooltip}
        />
      );
    }

    if (def.options && def.options.length > 0) {
      const options: SelectOption[] = [
        { value: '', label: inheritLabel },
        ...def.options.map((opt) => ({ value: opt, label: opt })),
      ];
      return (
        <SelectInput
          value={inherit ? '' : String(value)}
          onChange={(v) => setValue(v === '' ? null : v)}
          options={options}
          disabled={disabled}
          title={tooltip}
        />
      );
    }

    if (def.type === 'int' || def.type === 'float') {
      return (
        <NumberWithUnit
          value={inherit ? null : Number(value)}
          onChange={(v) => setValue(v)}
          min={def.min}
          max={def.max}
          step={def.step ?? (def.precision && def.precision > 0 ? 0.01 : 1)}
          precision={def.precision}
          placeholder={inheritLabel}
          disabled={disabled}
          title={tooltip}
          unit={def.unit}
        />
      );
    }

    if (def.emit === 'raw') {
      // 逃生口：一行一个 argv（argv 本身可以带空格），不能按逗号切
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <textarea
          rows={3}
          value={list.join('\n')}
          disabled={disabled}
          title={tooltip}
          placeholder={'每行一个命令行片段，按原样追加到末尾\n例如\n--parallel\n1'}
          onChange={(e) => setValue(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
          className={`${inputBase} font-mono resize-y`}
        />
      );
    }

    if (def.widget === 'json') {
      return (
        <JsonEditor
          value={inherit ? '' : String(value)}
          onChange={(v) => setValue(v)}
          disabled={disabled}
          title={tooltip}
        />
      );
    }

    if (def.type === 'string[]') {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <TextInput
          value={list.join(', ')}
          onChange={(v) => setValue(v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])}
          placeholder={inheritLabel}
          mono
          disabled={disabled}
          title={tooltip}
        />
      );
    }

    if (def.type === 'path') {
      const pick = async () => {
        const got =
          def.pathKind === 'dir' ? await invoke('dialog:open-folder') : await invoke('dialog:open-file');
        if (got) setValue(got);
      };
      return (
        <PathInput
          value={inherit ? '' : String(value)}
          onChange={(v) => setValue(v)}
          onPick={pick}
          placeholder={inheritLabel}
          disabled={disabled}
          title={tooltip}
        />
      );
    }

    return (
      <TextInput
        value={inherit ? '' : String(value)}
        onChange={(v) => setValue(v)}
        placeholder={inheritLabel}
        mono={def.type === 'secret'}
        password={def.type === 'secret'}
        disabled={disabled}
        title={tooltip}
      />
    );
  };

  // 下拉型（布尔 / 枚举）已内置「跟随默认」选项，不再叠加标题行的切换按钮
  const showToggle = !(def.options && def.options.length > 0) && def.type !== 'bool';

  return (
    <TriStateControl
      def={def}
      inherit={inherit}
      deviated={deviated}
      tooltip={tooltip}
      span={span}
      showToggle={showToggle}
      disabled={disabled}
      showDesc={showDesc}
      onToggleInherit={() => setValue(inherit ? seedValue(def) : null)}
      onReset={reset}
    >
      {control()}
    </TriStateControl>
  );
}
