import { requireAdminKey } from '~/server/utils/auth';
import { proxyMpRequest } from '~/server/utils/proxy-request';
import { getWechatLoginSessionOrThrow } from '~/server/utils/wechat-login';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const { id } = event.context.params!;
  const session = await getWechatLoginSessionOrThrow(id);

  const response: Response = await proxyMpRequest({
    event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/scanloginqrcode',
    query: {
      action: 'getqrcode',
      random: new Date().getTime(),
    },
    cookie: session.cookie,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'image/png',
      'Cache-Control': 'no-store',
    },
  });
});
