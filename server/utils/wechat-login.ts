import dayjs from 'dayjs';
import { createError, type H3Event } from 'h3';
import {
  clearWechatLoginSession,
  getWechatLoginSession,
  setCurrentWechatSession,
  setWechatLoginSession,
} from '~/server/kv/wechat-session';
import { cookieStore, getCookieFromResponse } from '~/server/utils/CookieStore';
import { proxyMpRequest } from '~/server/utils/proxy-request';
import type { LoginAccount } from '~/types/types';

function parseHomeAccountInfo(html: string): Pick<LoginAccount, 'nickname' | 'avatar'> {
  const nicknameMatchResult = html.match(/wx\.cgiData\.nick_name\s*?=\s*?"(?<nick_name>[^"]+)"/);
  const headImgMatchResult = html.match(/wx\.cgiData\.head_img\s*?=\s*?"(?<head_img>[^"]+)"/);

  return {
    nickname: nicknameMatchResult?.groups?.nick_name || '',
    avatar: headImgMatchResult?.groups?.head_img || '',
  };
}

export async function createWechatLoginSession(event: H3Event) {
  const now = new Date();
  const id = crypto.randomUUID().replace(/-/g, '');
  const sid = `${now.getTime()}${Math.floor(Math.random() * 100)}`;

  const response: Response = await proxyMpRequest({
    event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/bizlogin',
    query: {
      action: 'startlogin',
    },
    body: {
      userlang: 'zh_CN',
      redirect_url: '',
      login_type: 3,
      sessionid: sid,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    action: 'start_login',
  });

  const body = await response.clone().json();
  if (!body?.base_resp || body.base_resp.ret !== 0) {
    throw createError({
      statusCode: 502,
      statusMessage: body?.base_resp?.err_msg || 'Failed to start WeChat login',
    });
  }

  const uuid = getCookieFromResponse('uuid', response);
  if (!uuid) {
    throw createError({
      statusCode: 502,
      statusMessage: 'WeChat login session did not return uuid',
    });
  }

  await setWechatLoginSession({
    id,
    sid,
    cookie: `uuid=${encodeURIComponent(uuid)}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  return {
    id,
    expiresAt: dayjs(now).add(10, 'minutes').toISOString(),
  };
}

export async function getWechatLoginSessionOrThrow(id: string) {
  const session = await getWechatLoginSession(id);
  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: 'WeChat login session not found or expired',
    });
  }
  return session;
}

export function normalizeScanStatus(resp: any): string {
  if (!resp?.base_resp || resp.base_resp.ret !== 0) {
    return 'failed';
  }

  switch (resp.status) {
    case 0:
      return 'waiting';
    case 1:
      return 'confirmed';
    case 2:
    case 3:
      return 'expired';
    case 4:
    case 6:
      return resp.acct_size >= 1 ? 'scanned' : 'no_account';
    case 5:
      return 'unbound_email';
    default:
      return 'unknown';
  }
}

export async function completeWechatLoginSession(
  event: H3Event,
  id: string
): Promise<LoginAccount & { authKey: string }> {
  const loginSession = await getWechatLoginSessionOrThrow(id);

  const response: Response = await proxyMpRequest({
    event,
    method: 'POST',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/bizlogin',
    query: {
      action: 'login',
    },
    body: {
      userlang: 'zh_CN',
      redirect_url: '',
      cookie_forbidden: 0,
      cookie_cleaned: 0,
      plugin_used: 0,
      login_type: 3,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    cookie: loginSession.cookie,
    action: 'login',
  });

  const authKey = getCookieFromResponse('auth-key', response);
  if (!authKey) {
    throw createError({
      statusCode: 502,
      statusMessage: 'WeChat login did not return auth key',
    });
  }

  const token = await cookieStore.getToken(authKey);
  const cookie = await cookieStore.getCookie(authKey);
  if (!token || !cookie) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Stored WeChat login session is incomplete',
    });
  }

  const html: string = await proxyMpRequest({
    event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/home',
    query: {
      t: 'home/index',
      token,
      lang: 'zh_CN',
    },
    cookie,
  }).then(resp => resp.text());

  const account = parseHomeAccountInfo(html);
  if (!account.nickname) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to read WeChat account info',
    });
  }

  const now = new Date();
  const expiresAt = (await cookieStore.getExpiresAt(authKey)) || dayjs(now).add(4, 'days').toISOString();
  await setCurrentWechatSession({
    authKey,
    nickname: account.nickname,
    avatar: account.avatar,
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  await clearWechatLoginSession(id);

  return {
    authKey,
    nickname: account.nickname,
    avatar: account.avatar,
    expires: expiresAt,
  };
}
