// =============================================================================
// 参数组：RPC — 通过 ggml-rpc 把模型层分布到多台机器上
//   本文件是这些参数的唯一声明处：命令行、校验、UI、默认值、v1 迁移都由它推导
//   本机 rpc-server 子进程本身（开关/host/port）是应用层配置，不会发射到这里
// =============================================================================

import type { ParamDef } from '../schema';
import type { ConfigKey } from '../../types';

export const PARAMS_RPC = [
  {
    key: 'rpc.endpoints',
    flag: '--rpc',
    emit: 'csv',
    type: 'string[]',
    envName: 'LLAMA_ARG_RPC',
    tier: 1,
    group: 'rpc',
    label: 'RPC 端点',
    desc: 'host:port 列表，配合外部 ggml-rpc-server 把模型层分布到多台机器，用来看能不能凑出足够显存跑大模型；任一端点连不上都会让启动失败。本启动器的「RPC 配置」页也能自动拉起本机 rpc-server，那种用法留 inherit 即可',
    // 不走 legacy：v1 的 rpc_server.{enabled,host,port} 是应用层字段，由 migrate 组装成端点列表
  },
] as const satisfies readonly ParamDef<ConfigKey>[];
