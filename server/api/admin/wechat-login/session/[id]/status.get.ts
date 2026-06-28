import { requireAdminKey } from '~/server/utils/auth';
import { proxyMpRequest } from '~/server/utils/proxy-request';
import { getWechatLoginSessionOrThrow, normalizeScanStatus } from '~/server/utils/wechat-login';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const { id } = event.context.params!;
  const session = await getWechatLoginSessionOrThrow(id);

  const resp = await proxyMpRequest({
    event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/cgi-bin/scanloginqrcode',
    query: {
      action: 'ask',
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    cookie: session.cookie,
    parseJson: true,
  });

  return {
    code: 0,
    data: {
      status: normalizeScanStatus(resp),
      raw: resp,
    },
  };
});
