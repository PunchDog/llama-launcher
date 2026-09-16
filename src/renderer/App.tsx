import { useState } from 'react';
import StatusBar from './components/StatusBar';
import LogViewer from './components/LogViewer';
import BasicConfig from './components/BasicConfig';
import AdvancedOptions from './components/AdvancedOptions';
import RpcConfig from './components/RpcConfig';
import CoreManager from './components/CoreManager';
import ModelDownloader from './components/ModelDownloader';

const tabs = [
  { key: 'basic', label: '基础配置' },
  { key: 'advanced', label: '高级选项' },
  { key: 'rpc', label: 'RPC 配置' },
  { key: 'core', label: 'Core 管理' },
  { key: 'model', label: '模型下载' },
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('basic');

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-gray-100 select-none">
      <StatusBar />

      {/* 标签栏 */}
      <div className="flex gap-1 px-4 py-2 bg-gray-800 border-b border-gray-700">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 内容区：左 45% 配置 / 右 55% 日志 */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[45%] p-4 border-r border-gray-700">
          {activeTab === 'basic' && <BasicConfig />}
          {activeTab === 'advanced' && <AdvancedOptions />}
          {activeTab === 'rpc' && <RpcConfig />}
          {activeTab === 'core' && <CoreManager />}
          {activeTab === 'model' && <ModelDownloader />}
        </div>
        <div className="flex-1 flex flex-col">
          <LogViewer />
        </div>
      </div>
    </div>
  );
}
