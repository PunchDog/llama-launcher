import { useServer } from '../hooks/useServer';

// =============================================================================
// StatusBar — 顶部状态栏（状态圆点 + 文案）
// =============================================================================

const DOT_COLOR: Record<number, string> = {
  0: 'bg-gray-500',    // Stopped
  1: 'bg-yellow-400',  // Starting
  2: 'bg-green-400',   // Running
  3: 'bg-orange-400',  // Stopping
};

export default function StatusBar() {
  const { state, stateLabel } = useServer();
  const color = DOT_COLOR[state] ?? 'bg-gray-500';

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-800 border-b border-gray-700">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${color} ${state === 1 ? 'animate-pulse' : ''}`}
      />
      <span className="text-sm text-gray-300">状态：{stateLabel}</span>
    </div>
  );
}
