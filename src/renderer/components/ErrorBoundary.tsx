import { Component, type ErrorInfo, type ReactNode } from 'react';

// =============================================================================
// ErrorBoundary — 渲染异常兜底
//   没有它时任何一个组件抛错都会白屏整页（连日志面板都看不到）；
//   崩溃时给出堆栈与「重载」入口，用户至少能复制错误来提问。
// =============================================================================

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

export default function ErrorBoundary({ children }: Props) {
  return <Boundary>{children}</Boundary>;
}

class Boundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? '' });
    console.error('[Renderer] 组件渲染失败:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="h-full p-4 flex flex-col gap-3 bg-gray-900 text-gray-100">
        <h2 className="text-sm font-semibold text-red-400">界面渲染出错：{error.message}</h2>
        <p className="text-xs text-gray-400">
          配置与服务器不受影响。可以复制下面的堆栈用于排查，或重载界面继续。
        </p>
        <pre className="flex-1 overflow-auto bg-black/50 border border-gray-700 rounded p-2 text-[10px] text-gray-400 whitespace-pre-wrap">
          {error.stack}
          {info}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
            onClick={() => window.location.reload()}
          >
            重载界面
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
            onClick={() => this.setState({ error: null, info: '' })}
          >
            清除并重试渲染
          </button>
        </div>
      </div>
    );
  }
}
