/** @jest-environment node */
import { embyProxyUrl, readEmbyPlaylist, rewriteEmbyPlaylist, verifyEmbyResource } from '../emby-playback';
import { clearEmbyCache, embyUserCacheKey, getCachedEmbyList, setCachedEmbyList } from '../emby-cache';

const context = { token: 'proxy', filename: 'master.m3u8', itemId: 'episode-1', embyKey: 'private & source', audioStreamIndex: 2 };
const secret = 'test-only-signing-secret';
const upstream = 'https://emby.example/emby/Videos/episode-1/master.m3u8?api_key=TOKEN';

function verifyProxy(value: string) {
  const parsed = new URL(value, 'https://lunatv.example');
  expect(parsed.origin).toBe('https://lunatv.example');
  expect(parsed.searchParams.get('embyKey')).toBe(context.embyKey);
  expect(parsed.searchParams.get('audioStreamIndex')).toBe('2');
  const resource = parsed.searchParams.get('resource')!;
  expect(verifyEmbyResource(resource, context.itemId, parsed.searchParams.get('signature')!, secret)).toBe(true);
  return { parsed, resource };
}

test('proxy URL preserves HLS extension and encodes source identity', () => {
  const parsed = new URL(embyProxyUrl(context), 'https://lunatv.example');
  expect(parsed.pathname.endsWith('/master.m3u8')).toBe(true);
  expect(parsed.searchParams.get('embyKey')).toBe(context.embyKey);
});

test('master variants, audio and I-frame playlists all stay on authenticated route', () => {
  const output = rewriteEmbyPlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8?api_key=T%25"\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="iframe.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmain.m3u8?api_key=T%25', upstream, context, secret);
  const urls = [...output.matchAll(/URI="([^"]+)"/g)].map(m => m[1]);
  urls.push(output.split('\n').at(-1)!);
  expect(urls).toHaveLength(3);
  for (const url of urls) expect(verifyProxy(url).parsed.pathname.endsWith('.m3u8')).toBe(true);
  expect(verifyProxy(urls[2]).resource).toContain('api_key=T%25');
});

test('segments, keys, init maps and LL-HLS parts are signed and resolved correctly', () => {
  const output = rewriteEmbyPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/keys/key.bin?token=%252F"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:DURATION=0.5,URI="part.m4s"\n#EXTINF:4,\nsegment.ts?api_key=TOKEN', upstream, context, secret);
  const urls = [...output.matchAll(/URI="([^"]+)"/g)].map(m => m[1]);
  urls.push(output.split('\n').at(-1)!);
  const resources = urls.map(url => verifyProxy(url).resource);
  expect(resources[0]).toBe('https://emby.example/keys/key.bin?token=%252F');
  expect(resources[1]).toBe('https://emby.example/emby/Videos/episode-1/init.mp4');
  expect(resources[3]).toContain('segment.ts?api_key=TOKEN');
});

test('altered target, item, signature and secret fail verification', () => {
  const output = rewriteEmbyPlaylist('#EXTM3U\nsegment.ts', upstream, context, secret);
  const parsed = verifyProxy(output.split('\n')[1]).parsed;
  const resource = parsed.searchParams.get('resource')!;
  const signature = parsed.searchParams.get('signature')!;
  expect(verifyEmbyResource(resource + 'changed', context.itemId, signature, secret)).toBe(false);
  expect(verifyEmbyResource(resource, 'other-item', signature, secret)).toBe(false);
  expect(verifyEmbyResource(resource, context.itemId, 'invalid', secret)).toBe(false);
  expect(verifyEmbyResource(resource, context.itemId, signature, 'other-secret')).toBe(false);
});

test('playlist body is read as UTF-8 and bounded', async () => {
  expect(await readEmbyPlaylist(new Response('#EXTM3U\n#中文'))).toContain('中文');
  await expect(readEmbyPlaylist(new Response('x'.repeat(5 * 1024 * 1024 + 1)))).rejects.toThrow('exceeds');
});

test('same source key in separate accounts cannot share list cache', () => {
  clearEmbyCache();
  const alice = embyUserCacheKey('alice', 'default');
  const bob = embyUserCacheKey('bob', 'default');
  setCachedEmbyList(1, 20, { list: ['alice-movie'] }, undefined, alice);
  expect(getCachedEmbyList(1, 20, undefined, bob)).toBeNull();
  expect(getCachedEmbyList(1, 20, undefined, alice).list).toEqual(['alice-movie']);
});
