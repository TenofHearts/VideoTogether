import Hls from 'hls.js';

export type HlsErrorData = {
  fatal?: boolean;
  type?: string;
  details?: string;
};

export type HlsInstance = Hls;
export type HlsConstructor = typeof Hls;

export async function loadHlsConstructor(): Promise<HlsConstructor | null> {
  return Hls;
}
