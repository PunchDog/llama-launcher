import { useState } from 'react';
import { GROUP_META } from '../../shared/params';
import type { ParamGroupId } from '../../shared/params/schema';
import { useUIStore } from '../stores/uiStore';
import { Section } from './ui';
import ParamGroupCard from './params/ParamGroupCard';
import ParamToolbar from './params/ParamToolbar';

// =============================================================================
// AdvancedOptions — 全部参数组按层级展开
//   层级 / 只看已改 / 搜索都存 uiStore（见 ParamToolbar），切页不会丢；
//   每张卡片内部再按 requires 过滤，界面上出现的都是真正会发射的参数。
// =============================================================================

const GROUP_IDS = Object.keys(GROUP_META) as ParamGroupId[];

export default function AdvancedOptions() {
  const maxTier = useUIStore((s) => s.maxTier);
  const [showDesc, setShowDesc] = useState(true);

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        <Section
          title="参数层级"
          desc="层级越高越接近 llama-server 的原始参数面；不确定的参数保持「跟随默认」，让 --fit 等自适应机制继续生效"
        >
          <div className="space-y-2">
            <ParamToolbar groups={GROUP_IDS} />
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={showDesc}
                onChange={(e) => setShowDesc(e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"
              />
              显示说明
            </label>
          </div>
        </Section>

        {GROUP_IDS.map((groupId) => (
          <ParamGroupCard
            key={groupId}
            groupId={groupId}
            columns={2}
            showDesc={showDesc}
            defaultOpen={maxTier === 0}
          />
        ))}
      </div>
    </div>
  );
}
