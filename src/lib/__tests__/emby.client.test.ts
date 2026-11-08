import { EmbyClient } from '@/lib/emby.client';

const baseConfig = {
  ServerURL: 'https://emby.example.com',
  ApiKey: 'test-api-key',
  UserId: 'user-id',
};

describe('EmbyClient.getStreamUrl', () => {
  it('does not hide HLS behind a .mp4 proxy URL when transcodeMp4 is enabled', async () => {
    const client = new EmbyClient({
      ...baseConfig,
      proxyPlay: true,
      transcodeMp4: true,
    });

    const url = await client.getStreamUrl('item-123');

    expect(url).toContain('https://emby.example.com/emby/Videos/item-123/master.m3u8');
    expect(url).toContain('api_key=test-api-key');
    expect(url).not.toContain('/api/emby/play/proxy/video.mp4');
  });

  it('still uses the backend proxy for direct mp4 playback', async () => {
    const client = new EmbyClient({
      ...baseConfig,
      proxyPlay: true,
      transcodeMp4: false,
    });

    const url = await client.getStreamUrl('item-123');

    expect(url).toBe('/api/emby/play/proxy/video?itemId=item-123');
  });

  it('keeps direct static playback when proxyPlay is disabled', async () => {
    const client = new EmbyClient({
      ...baseConfig,
      proxyPlay: false,
      transcodeMp4: false,
    });

    const url = await client.getStreamUrl('item-123');

    expect(url).toContain('https://emby.example.com/emby/Videos/item-123/stream');
    expect(url).toContain('static=true');
    expect(url).toContain('api_key=test-api-key');
  });
});
