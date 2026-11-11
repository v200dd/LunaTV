/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/emby/play/[token]/[filename]/route';
import { getAuthInfoFromCookie } from '../auth';
import { embyManager } from '../emby-manager';

jest.mock('../auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('../config', () => ({ getConfig: jest.fn() }));
jest.mock('../emby-manager', () => ({ embyManager: {
  getClientForUser: jest.fn(), getClient: jest.fn(), clearUserCache: jest.fn(), clearCache: jest.fn(),
} }));
const client = {
  getStreamUrl: jest.fn(), getPlaybackProxySecret: jest.fn(), getPlaybackHeaders: jest.fn(),
};
const params = Promise.resolve({ token: 'proxy', filename: 'master.m3u8' });
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue({ username: 'alice' });
  (embyManager.getClientForUser as jest.Mock).mockResolvedValue(client);
  client.getStreamUrl.mockResolvedValue('https://emby.example/master.m3u8?api_key=TOKEN');
  client.getPlaybackProxySecret.mockResolvedValue('TEST_SECRET');
  client.getPlaybackHeaders.mockReturnValue({ 'X-Emby-Token': 'TOKEN' });
  global.fetch = jest.fn();
});
afterAll(() => { global.fetch = originalFetch; });
const request = (suffix = '', headers = {}) => new NextRequest(`https://tv.example/api/emby/play/proxy/master.m3u8?itemId=1&embyKey=private${suffix}`, { headers });

test('preserves audio selection and rewrites the playlist to the authenticated route', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(new Response('#EXTM3U\n#EXTINF:4,\nseg.ts', {
    headers: { 'content-type': 'application/vnd.apple.mpegurl', 'content-length': '30' },
  }));
  const response = await GET(request('&audioStreamIndex=1&AudioStreamIndex=3'), { params });
  expect(response.status).toBe(200);
  expect(client.getStreamUrl).toHaveBeenCalledWith('1', true, true, 3);
  expect(response.headers.get('content-length')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.text()).toContain('/api/emby/play/proxy/resource?');
});

test('forwards Range and keeps 206 headers and bytes for original files', async () => {
  client.getStreamUrl.mockResolvedValue('https://emby.example/stream?api_key=TOKEN');
  (global.fetch as jest.Mock).mockResolvedValue(new Response('part', { status: 206, headers: {
    'content-type': 'video/mp4', 'content-range': 'bytes 0-3/10', 'accept-ranges': 'bytes', 'content-length': '4',
  } }));
  const response = await GET(request('', { Range: 'bytes=0-3' }), { params });
  expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Range).toBe('bytes=0-3');
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 0-3/10');
  expect(await response.text()).toBe('part');
});

test('preserves 416 and Content-Range rather than masking upstream as 500', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } }));
  const response = await GET(request(), { params });
  expect(response.status).toBe(416);
  expect(response.headers.get('content-range')).toBe('bytes */10');
});

test('invalid child-resource signature is rejected before a network request', async () => {
  const response = await GET(request('&resource=https%3A%2F%2Fother.example%2F&signature=bad'), { params });
  expect(response.status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('401 clears the correct user client cache and retries once', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response('video', { headers: { 'content-type': 'video/mp4' } }));
  client.getStreamUrl.mockResolvedValue('https://emby.example/stream');
  const response = await GET(request(), { params });
  expect(response.status).toBe(200);
  expect(embyManager.clearUserCache).toHaveBeenCalledWith('alice');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('missing login returns 401 without opening an upstream', async () => {
  (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);
  const response = await GET(request(), { params });
  expect(response.status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
});
