import type { ParamGroupId } from '@/shared/params/schema';
import { ALL_PARAMS } from '@/shared/params';
import { useUIStore } from '@/renderer/stores/uiStore';
import { SearchInput } from '../ui';

// =============================================================================
// ParamToolbar — 参数页的层级 / 只看已改 / 搜索
//   tier 与 onlyChanged 存在 uiStore（并写穿 localStorage），
//   所以切页、重渲染都不会把用户的浏览偏好重置掉。
// =============================================================================

const TIER_LABEL: Record<0 | 1 | 2, string> = { 0: '常用', 1: '进阶', 2: '专家' };
const TIERS: (0 | 1 | 2)[] = [0, 1, 2];

/** 各层级累计可见的参数条数，给按钮当提示 */
const COUNT_BY_TIER: Record<0 | 1 | 2, number> = {
  0: ALL_PARAMS.filter((d) => d.tier === 0).length,
  1: ALL_PARAMS.filter((d) => d.tier <= 1).length,
  2: ALL_PARAMS.length,
};

const TIER_CLASS_ACTIVE = 'bg-blue-600 text-white';
const TIER_CLASS_IDLE = 'text-gray-400 hover:bg-gray-700 hover:text-gray-200';

interface ParamToolbarProps {
  /** 本页面渲染的参数组；统计总数时只数这些组 */
  groups?: readonly ParamGroupId[];
  showSearch?: boolean;
}

export default function ParamToolbar({ groups, showSearch = true }: ParamToolbarProps) {
  const maxTier = useUIStore((s) => s.maxTier);
  const onlyChanged = useUIStore((s) => s.onlyChanged);
  const search = useUIStore((s) => s.search);
  const setMaxTier = useUIStore((s) => s.setMaxTier);
  const setOnlyChanged = useUIStore((s) => s.setOnlyChanged);
  const setSearch = useUIStore((s) => s.setSearch);

  const scoped = groups ? ALL_PARAMS.filter((d) => groups.includes(d.group)) : ALL_PARAMS;
  const total = scoped.filter((d) => d.tier <= maxTier).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            onClick={() => setMaxTier(tier)}
            title={`显示到「${TIER_LABEL[tier]}」层级（共 ${COUNT_BY_TIER[tier]} 项参数）`}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              maxTier === tier ? TIER_CLASS_ACTIVE : TIER_CLASS_IDLE
            }`}
          >
            {TIER_LABEL[tier]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOnlyChanged(!onlyChanged)}
        className={`px-2.5 py-1 rounded text-xs border transition-colors ${
          onlyChanged
            ? 'border-blue-500/60 text-blue-300 bg-blue-500/10'
            : 'border-gray-600 text-gray-400 hover:text-gray-200'
        }`}
      >
        只看已改
      </button>

      <span className="text-[10px] text-gray-500">当前层级 {total} 项</span>

      {showSearch && (
        <div className="ml-auto w-56">
          <SearchInput value={search} onChange={setSearch} placeholder="搜索参数名 / 说明 / 命令行" />
        </div>
      )}
    </div>
  );
}
