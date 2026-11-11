import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { embyManager } from '@/lib/emby-manager';
import { readEmbyPlaylist, rewriteEmbyPlaylist, verifyEmbyResource } from '@/lib/emby-playback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getEmbyClient(embyKey?: string, username?: string) {
  if (username) return embyManager.getClientForUser(username, embyKey);
  const config = await getConfig();
  if (!config.EmbyConfig?.Sources?.length) throw new Error('Emby 未配置或未启用');
  return embyManager.getClient(embyKey);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; filename: string }> }
) {
  try {
    const { token, filename } = await params;
    const query = request.nextUrl.searchParams;
    const auth = getAuthInfoFromCookie(request);
    const hasSubscription = !!process.env.TVBOX_SUBSCRIBE_TOKEN && token === process.env.TVBOX_SUBSCRIBE_TOKEN;
    if (!hasSubscription && !auth?.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    const itemId = query.get('itemId');
    if (!itemId) return NextResponse.json({ error: '缺少 itemId 参数' }, { status: 400 });
    const embyKey = query.get('embyKey') || undefined;
    const audioValue = query.get('audioStreamIndex');
    const audioStreamIndex = audioValue !== null ? Number(audioValue) : undefined;
    if (audioStreamIndex !== undefined && (!Number.isInteger(audioStreamIndex) || audioStreamIndex < 0)) {
      return NextResponse.json({ error: '无效的音轨索引' }, { status: 400 });
    }
    let client = await getEmbyClient(embyKey, auth?.username);
    const resource = query.get('resource');
    if (resource && !verifyEmbyResource(resource, itemId, query.get('signature') || '', await client.getPlaybackProxySecret())) {
      return NextResponse.json({ error: '无效的播放资源签名' }, { status: 403 });
    }
    let upstream = resource || await client.getStreamUrl(itemId, true, true, audioStreamIndex);
    const fetchStream = () => fetch(upstream, {
      headers: {
        // Signed CDN resources may be on another origin. Never forward the
        // Emby credentials there; preserve the upstream URL's own query auth.
        ...client.getPlaybackHeaders(upstream),
        'Accept-Encoding': 'identity',
        ...(request.headers.get('range') ? { Range: request.headers.get('range')! } : {}),
        ...(request.headers.get('if-range') ? { 'If-Range': request.headers.get('if-range')! } : {}),
      },
      cache: 'no-store',
      signal: request.signal,
    });
    let response = await fetchStream();
    if (response.status === 401 && !resource) {
      await response.body?.cancel();
      if (auth?.username) embyManager.clearUserCache(auth.username);
      else embyManager.clearCache();
      client = await getEmbyClient(embyKey, auth?.username);
      upstream = await client.getStreamUrl(itemId, true, true, audioStreamIndex);
      response = await fetchStream();
    }
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!response.ok) {
      await response.body?.cancel();
      headers.delete('content-length');
      headers.set('content-type', 'application/json');
      return new NextResponse(JSON.stringify({ error: `Emby 视频请求失败 (${response.status})` }), {
        status: response.status, headers,
      });
    }
    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url || upstream;
    if (/mpegurl/i.test(contentType) || /\.m3u8$/i.test(new URL(finalUrl).pathname)) {
      const text = await readEmbyPlaylist(response);
      if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Emby 返回了无效的 HLS 播放列表');
      const playlist = rewriteEmbyPlaylist(text, finalUrl, {
        token, filename, itemId, embyKey, audioStreamIndex,
      }, await client.getPlaybackProxySecret());
      headers.set('content-type', 'application/vnd.apple.mpegurl');
      headers.delete('content-length');
      headers.delete('content-range');
      headers.delete('accept-ranges');
      return new NextResponse(playlist, { headers });
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('[Emby Play] 播放请求失败:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Emby 播放请求失败，请检查服务连接和转码状态' }, { status: 502 });
  }
}
