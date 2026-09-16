declare module 'tar' {
  import { Writable, Readable } from 'stream';

  interface FileStat {
    type: string;
    [key: string]: unknown;
  }

  interface ExtractOptions {
    cwd?: string;
    filter?: (path: string, stat: FileStat) => boolean;
    [key: string]: unknown;
  }

  function extract(options?: ExtractOptions): Writable;
}
