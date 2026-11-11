/** @jest-environment node */
import { EmbyClient } from '@/lib/emby.client';

const baseConfig = {
  ServerURL: 'https://emby.example.com',
  ApiKey: 'TEST_TOKEN',
  UserId: 'user-id',
};

describe('EmbyClient.getStreamUrl', () => {
  it('keeps HLS on an authenticated proxy with an m3u8 extension', async () => {
    const client = new EmbyClient({ ...baseConfig, proxyPlay: true, transcodeMp4: true });
    const url = await client.getStreamUrl('item-123', true, false, 2);
    expect(url).toBe('/api/emby/play/proxy/master.m3u8?itemId=item-123&audioStreamIndex=2');
  });

  it('can force a direct upstream HLS URL inside the server proxy', async () => {
    const client = new EmbyClient({ ...baseConfig, proxyPlay: true, transcodeMp4: true });
    const url = await client.getStreamUrl('item-123', true, true, 3);
    expect(url).toContain('/master.m3u8?');
    expect(url).toContain('AudioStreamIndex=3');
    expect(url).toContain('api_key=TEST_TOKEN');
  });

  it('still proxies original static files without pretending they are MP4', async () => {
    const client = new EmbyClient({ ...baseConfig, proxyPlay: true, transcodeMp4: false });
    expect(await client.getStreamUrl('item-123')).toBe('/api/emby/play/proxy/video?itemId=item-123');
  });

  it('keeps direct static playback when proxyPlay is disabled', async () => {
    const client = new EmbyClient({ ...baseConfig, proxyPlay: false, transcodeMp4: false });
    const url = await client.getStreamUrl('item-123');
    expect(url).toContain('/emby/Videos/item-123/stream');
    expect(url).toContain('static=true');
    expect(url).toContain('api_key=TEST_TOKEN');
  });

  it('does not send Emby authorization headers to a different resource origin', () => {
    const client = new EmbyClient(baseConfig);
    expect(client.getPlaybackHeaders('https://cdn.example/segment.ts')).toEqual({});
    expect(client.getPlaybackHeaders('https://emby.example.com/emby/segment.ts')['X-Emby-Token']).toBe('TEST_TOKEN');
  });
});
