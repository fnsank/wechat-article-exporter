/**
 * 从文章 HTML 中提取 comment_id。纯正则实现，不依赖任何客户端存储 —— 单独
 * 拆到 shared 层是为了让服务端 /api/public/v1/download 能引用而不把 Dexie
 * / IndexedDB 依赖间接拖进 Worker bundle（会导致构建期 rendering chunks
 * 阶段 OOM）。
 *
 * 文本分享与普通图文的页面结构不同，需要兼容多种写法。
 */
export function extractCommentId(html: string): string | null {
  const patterns = [
    // 普通图文: var comment_id = 'xxx' || '0';
    /var comment_id = '(?<comment_id>\d+)' \|\| '0';/,
    // 文本分享等: d.comment_id = xml ? getXmlValue('comment_id.DATA') : 'xxx';
    /comment_id:\s*JsDecode\('(?<comment_id>\d+)'\)/,
    // 有些模板里以 JsDecode 形式写在配置里
    /d\.comment_id\s*=\s*xml \? getXmlValue\('comment_id\.DATA'\) : '(?<comment_id>\d+)';/,
    // 兜底: window.segment_comment_id = 'xxx';
    /window\.comment_id\s*=\s*'(?<comment_id>\d+)'/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      if ('groups' in match && match.groups && match.groups.comment_id) {
        return match.groups.comment_id;
      }
      if (match[1]) {
        return match[1];
      }
    }
  }

  return null;
}
