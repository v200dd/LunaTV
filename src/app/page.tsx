/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import HomeClient from './HomeClient';
import { CinematicLoadingFallback } from '@/components/CinematicLoadingFallback';

function hasAuthCookieValue(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    const authInfo = JSON.parse(decoded) as {
      password?: string;
      username?: string;
      signature?: string;
      trustedNetwork?: boolean;
    };

    return Boolean(
      authInfo.password ||
        authInfo.username ||
        authInfo.signature ||
        authInfo.trustedNetwork
    );
  } catch {
    return false;
  }
}

// 🔥 Server Component - 获取配置并传递给客户端
export default async function Home() {
  // EdgeOne Pages 页面请求可能绕过 middleware，主页必须自行阻止匿名访问。
  const cookieStore = await cookies();
  const authCookie = cookieStore.get('user_auth') || cookieStore.get('auth');
  if (!authCookie || !hasAuthCookieValue(authCookie.value)) {
    redirect('/login?redirect=%2F');
  }

  // 🔥 在服务端获取配置
  const config = await getConfig();
  const homePageConfig = config.HomePageConfig || {
    showHeroBanner: true,
    showContinueWatching: true,
    showUpcomingReleases: true,
    showHotMovies: true,
    showHotTvShows: true,
    showNewAnime: true,
    showHotVariety: true,
    showHotShortDramas: true,
  };

  // 🔥 不再进行服务端 prefetch，让所有数据在客户端加载
  // 好处：导航快速，立即显示 loading 页面
  // 客户端的 useHomePageQueries 会根据配置条件性地获取数据

  return (
    <Suspense fallback={<CinematicLoadingFallback />}>
      <HomeClient initialConfig={homePageConfig} />
    </Suspense>
  );
}
