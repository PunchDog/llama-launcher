// =============================================================================
// part-download — 「先写 .part 再 rename」的流式下载唯一实现
//   core-updater（缓存包，整包重写，失败删残包）与
//   model-downloader（模型文件，Range 续传，失败保留残包）共用；
//   两条旧实现约各 60 行、结构几乎相同，差异全部收敛到 options。
// =============================================================================

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { errMsg } from '../shared/errors';
import type { AxiosProxyConfig } from './net-util';

export interface PartDownloadOptions {
  url: string;
  /** 最终落盘路径；下载中的临时文件为同路径 + .part 后缀 */
  dest: string;
  proxy: AxiosProxyConfig | false;
  /** true 时若存在 .part 残包，带 Range 续传（206 追加 / 200 从头覆写） */
  resume?: boolean;
  /** 失败或不完整时保留 .part 供续传；false 则删除残包 */
  keepPartOnFailure?: boolean;
  signal?: AbortSignal;
  /** 调用方已知的文件大小，响应头缺失时作为总大小兜底 */
  expectedSize?: number;
  /**
   * inc — 本次新增字节（206 续传时首回调为已续传的头部大小）；
   * downloaded — 全文件累计（含续传头部）；totalSize — 0 表示未知。
   */
  onProgress: (inc: number, downloaded: number, totalSize: number) => void;
}

export async function downloadToPartFile(o: PartDownloadOptions): Promise<void> {
  const resume = o.resume === true;
  const keepPart = o.keepPartOnFailure === true;
  const expectedSize = o.expectedSize ?? 0;
  const partFile = `${o.dest}.part`;
  fs.mkdirSync(path.dirname(o.dest), { recursive: true });

  let startPos = 0;
  if (resume) {
    try {
      if (fs.existsSync(partFile)) startPos = fs.statSync(partFile).size;
    } catch {
      startPos = 0;
    }
  }

  const headers: Record<string, string> = {};
  if (startPos > 0) {
    headers.Range =
      expectedSize > 0 && startPos > expectedSize ? 'bytes=0-' : `bytes=${startPos}-`;
  }

  const resp = await axios.get(o.url, {
    responseType: 'stream',
    timeout: 0,
    proxy: o.proxy,
    signal: o.signal,
    headers,
  });

  if (resp.status === 200) {
    // 服务器不支持 Range（或本就全量请求）：从头覆写
    startPos = 0;
  } else if (!(resp.status === 206 && resume && startPos > 0)) {
    try {
      resp.data?.destroy?.();
    } catch {
      // ignore
    }
    throw new Error(`下载响应异常：HTTP ${resp.status}`);
  }

  const contentLength = parseInt(String(resp.headers['content-length']), 10) || 0;
  // content-range: "bytes start-end/total" 给出全文件长度
  const rangeTotal = parseInt(
    String(resp.headers['content-range'] ?? '').split('/').pop() ?? '',
    10,
  );
  const totalSize =
    (Number.isFinite(rangeTotal) && rangeTotal > 0 && rangeTotal >= startPos ? rangeTotal : 0) ||
    (contentLength > 0 ? contentLength + startPos : 0) ||
    expectedSize;

  const writer = fs.createWriteStream(partFile, { flags: startPos > 0 ? 'a' : 'w' });
  let downloaded = startPos;

  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const dropPart = () => {
      if (keepPart) return;
      try {
        fs.unlinkSync(partFile);
      } catch {
        // 文件可能不存在
      }
    };
    const fail = (err: Error) => {
      if (!failed) {
        failed = true;
        reject(err);
      }
    };

    if (startPos > 0) o.onProgress(startPos, startPos, totalSize);

    resp.data.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      o.onProgress(chunk.length, downloaded, totalSize);
    });
    resp.data.on('error', (err: Error) => {
      fail(err);
      writer.destroy();
    });
    writer.on('error', (err: Error) => {
      fail(err);
      writer.destroy();
    });

    // writer 'close' 在所有数据落盘（或 destroy 完成）后触发，
    // 此时 rename/unlink 才不会在 Windows 上因句柄未释放而失败
    writer.on('close', () => {
      if (failed) {
        dropPart();
        return;
      }
      if (totalSize > 0 && downloaded < totalSize) {
        dropPart();
        reject(
          new Error(
            `下载不完整（${downloaded}/${totalSize} 字节），` +
              (keepPart ? '残包已保留供续传' : '已丢弃残包，请重试'),
          ),
        );
        return;
      }
      try {
        fs.renameSync(partFile, o.dest);
        resolve();
      } catch (err) {
        reject(new Error(`落盘失败: ${errMsg(err)}`));
      }
    });

    resp.data.pipe(writer);
  });
}
