// Pure link handling. This module never performs a network or storage operation.
import {SHARE_PAGE} from './site-config.js';

export function parseShareFragment(fragment) {
  if (typeof fragment !== 'string' || fragment.length > 1000 || !fragment.startsWith('#')) throw Error('分享链接不完整');
  const params = new URLSearchParams(fragment.slice(1));
  const keys = [...params.keys()];
  if (keys.length !== 2 || params.getAll('code').length !== 1 || params.getAll('server').length !== 1
      || keys.some(key => key !== 'code' && key !== 'server')) throw Error('分享链接的参数不正确');
  const code = params.get('code').toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{20}$/.test(code)) throw Error('口令应为 20 位字母和数字');
  const raw = params.get('server');
  if (!raw || raw.length > 500 || /[\s\\?#]/.test(raw)) throw Error('分享服务地址无效');
  let url;
  try { url = new URL(raw); } catch { throw Error('分享服务地址无效'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0')
    throw Error('分享服务须使用不带路径的 HTTPS 地址');
  // Show the canonical/punycode domain, without allowing a supplied display name.
  return {code, server: url.origin, host: url.host};
}

export function shareAppLinks(share) {
  // Revalidate values at this boundary too, so an untrusted caller cannot inject
  // an Intent extra, package, scheme, redirect or fallback target.
  const params = new URLSearchParams({code: share.code, server: share.server});
  const parsed = parseShareFragment('#' + params);
  const query = new URLSearchParams({code: parsed.code, server: parsed.server}).toString();
  const fallback = `${SHARE_PAGE}?fallback=1#${query}`;
  return {
    landing: `${SHARE_PAGE}#${query}`,
    scheme: `qingke://share?${query}`,
    intent: `intent://share?${query}#Intent;scheme=qingke;package=cn.qingke.app;S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
    fallback,
  };
}

export function shareMessage(share) {
  const parsed = parseShareFragment('#' + new URLSearchParams({code: share.code, server: share.server}));
  return `清课课程表分享\n口令：${parsed.code.match(/.{5}/g).join('-')}\n打开并导入：${shareAppLinks(parsed).landing}\nApp下载：https://qk.sagiri.org/`;
}
