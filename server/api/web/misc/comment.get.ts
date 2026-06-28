/**
 * 获取文章评论
 */

import { getWechatCredential } from '~/server/kv/wechat-credentials';
import { proxyMpRequest } from '~/server/utils/proxy-request';

interface GetCommentQuery {
  __biz: string;
  comment_id: string;
  key?: string;
  uin?: string;
  pass_ticket?: string;
}

export default defineEventHandler(async event => {
  const { __biz, comment_id, uin, key, pass_ticket } = getQuery<GetCommentQuery>(event);
  const credential =
    uin && key && pass_ticket
      ? {
          uin,
          key,
          pass_ticket,
        }
      : await getWechatCredential(__biz);

  if (!credential) {
    return {
      base_resp: {
        ret: -40102,
        err_msg: 'WECHAT_CREDENTIAL_REQUIRED',
      },
    };
  }

  const params: Record<string, string | number> = {
    action: 'getcomment',
    __biz: __biz,
    comment_id: comment_id,
    uin: credential.uin,
    key: credential.key,
    pass_ticket: credential.pass_ticket,
    limit: 1000,
    f: 'json',
  };

  const resp: Response = await proxyMpRequest({
    event: event,
    method: 'GET',
    endpoint: 'https://mp.weixin.qq.com/mp/appmsg_comment',
    query: params,
    parseJson: false,
  });
  return new Response(resp.body, {
    headers: {
      'content-type': 'application/json',
    },
  });
});
