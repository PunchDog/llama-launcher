import { useMemo } from 'react';
import type { ParamGroupId } from '../../../shared/params/schema';
import { GROUP_META, PARAMS_BY_GROUP, PARAM_INDEX, flatParams, paramVisible } from '../../../shared/params';
import { useConfigStore } from '../../stores/configStore';
import { useUIStore } from '../../stores/uiStore';
import { isDeviated } from '../../utils/paramDiff';
import { Section } from '../ui';
import ParamField from './ParamField';

// =============================================================================
// ParamGroupCard — 一个参数组渲染成一张卡片
//   字段清单完全来自参数表：表里新增一条，界面自动出现，无需改本文件。
//   本组件只订阅「可见字段集合」的签名串：值变了但可见性没变时不重渲染，
//   每个字段的值由 ParamField 各自订阅，改一个只重渲染一个控件。
// =============================================================================

interface ParamGroupCardProps {
  groupId: ParamGroupId;
  /** 卡片初始是否展开 */
  defaultOpen?: boolean;
  /** 是否显示每个参数的中文说明 */
  showDesc?: boolean;
  /** 栅格列数 */
  columns?: 2 | 4;
  /** 只渲染这些点路径（如 RPC 页只要 rpc.endpoints） */
  only?: readonly string[];
  /** 覆盖全局层级（少数页面需要固定展示到某个层级） */
  maxTier?: 0 | 1 | 2;
}

// Tailwind 只扫描源码里的完整类名，动态拼接（grid-cols-${n}）不会生成样式
const GRID_CLASS: Record<number, string> = {
  2: 'grid-cols-2',
  4: 'grid-cols-4',
};

function matchesSearch(def: (typeof PARAMS_BY_GROUP)[ParamGroupId][number], q: string): boolean {
  return (
    def.label.toLowerCase().includes(q) ||
    def.key.toLowerCase().includes(q) ||
    (def.flag ?? '').toLowerCase().includes(q) ||
    (def.desc ?? '').toLowerCase().includes(q)
  );
}

export default function ParamGroupCard({
  groupId,
  defaultOpen = true,
  showDesc = false,
  columns = 2,
  only,
  maxTier: maxTierOverride,
}: ParamGroupCardProps) {
  const tierPref = useUIStore((s) => s.maxTier);
  const onlyChanged = useUIStore((s) => s.onlyChanged);
  const search = useUIStore((s) => s.search);
  const maxTier = maxTierOverride ?? tierPref;

  const table = PARAMS_BY_GROUP[groupId];
  const meta = GROUP_META[groupId];
  const query = search.trim().toLowerCase();

  const signature = useConfigStore((s) => {
    const cfg = s.config;
    if (!cfg) return '';
    const flat = flatParams(cfg);
    return table
      .filter(
        (def) =>
          def.tier <= maxTier &&
          (only ? only.includes(def.key) : true) &&
          paramVisible(def, flat) &&
          (!onlyChanged || isDeviated(cfg, def.key)) &&
          (query === '' || matchesSearch(def, query)),
      )
      .map((def) => def.key)
      .join('|');
  });

  const defs = useMemo(
    () =>
      signature === ''
        ? []
        : signature.split('|').flatMap((key) => {
            const def = PARAM_INDEX.get(key);
            return def ? [def] : [];
          }),
    [signature],
  );

  if (defs.length === 0) return null;

  return (
    <Section title={meta.title} desc={meta.desc} defaultOpen={defaultOpen}>
      <div className={`grid ${GRID_CLASS[columns]} gap-3`}>
        {defs.map((def) => (
          <ParamField
            key={def.key}
            def={def}
            showDesc={showDesc}
            span={def.emit === 'raw' || def.type === 'string[]' ? columns : 1}
          />
        ))}
      </div>
    </Section>
  );
}
