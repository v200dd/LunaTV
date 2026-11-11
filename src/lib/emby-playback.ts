import { createHmac, timingSafeEqual } from 'crypto';

export interface EmbyProxyContext {
  token: string;
  filename: string;
  itemId: string;
  embyKey?: string;
  audioStreamIndex?: number;
}

export function embyProxyUrl(context: EmbyProxyContext): string {
  const query = new URLSearchParams({ itemId: context.itemId });
  if (context.embyKey) query.set('embyKey', context.embyKey);
  if (context.audioStreamIndex !== undefined) {
    query.set('audioStreamIndex', String(context.audioStreamIndex));
  }
  return `/api/emby/play/${encodeURIComponent(context.token)}/${encodeURIComponent(context.filename)}?${query}`;
}

function resourceSignature(url: string, itemId: string, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify([itemId, url])).digest('hex');
}

export function verifyEmbyResource(url: string, itemId: string, signature: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(resourceSignature(url, itemId, secret), 'hex'));
}

/** Every nested playlist, segment, init map and key stays on the authenticated
 * Emby route. Signed URLs cannot turn this endpoint into an arbitrary proxy. */
export function rewriteEmbyPlaylist(content: string, upstreamUrl: string, context: EmbyProxyContext, secret: string): string {
  const rewrite = (uri: string, playlist = false): string => {
    const resolved = new URL(uri, upstreamUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) throw new Error('Unsupported HLS resource protocol');
    const filename = playlist || /\.m3u8$/i.test(resolved.pathname) ? 'master.m3u8' : 'resource';
    const proxy = embyProxyUrl({ ...context, filename });
    const query = new URLSearchParams({
      resource: resolved.toString(),
      signature: resourceSignature(resolved.toString(), context.itemId, secret),
    });
    return `${proxy}&${query}`;
  };
  let nextIsPlaylist = false;
  return content.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) {
      const result = rewrite(trimmed, nextIsPlaylist);
      nextIsPlaylist = false;
      return result;
    }
    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) nextIsPlaylist = true;
    const playlistTag = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(trimmed);
    return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri, playlistTag)}"`);
  }).join('\n');
}

export async function readEmbyPlaylist(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty HLS playlist');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('HLS playlist exceeds 5 MB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
