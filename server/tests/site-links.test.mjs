import test from 'node:test';
import assert from 'node:assert/strict';
import {parseShareFragment, shareAppLinks, shareMessage} from '../site/share-link.js';
import {releaseLinks} from '../site/site-config.js';

const code = '0123456789ABCDEFGHJK';
const fragment = `#code=${code}&server=https%3A%2F%2Fshare.example`;

test('fragment parsing normalizes an explicit HTTPS origin without reading a share', () => {
  assert.deepEqual(parseShareFragment(fragment), {code, server:'https://share.example', host:'share.example'});
  assert.deepEqual(parseShareFragment(`#server=https%3A%2F%2FSHARE.example%3A443%2F&code=${code.toLowerCase()}`), {code, server:'https://share.example', host:'share.example'});
  assert.equal(parseShareFragment(`#code=${code}&server=https%3A%2F%2Fshare.example%3A8443`).host, 'share.example:8443');
});

test('invalid, repeated and unknown fields are rejected before app links are built', () => {
  for (const value of ['', '#', fragment+'&code='+code, fragment+'&token=private', '#code='+code,
    fragment.replace(code, 'I'.repeat(20)), fragment.replace('https', 'http'),
    '#code='+code+'&server='+encodeURIComponent('https://user:pass@share.example/'),
    '#code='+code+'&server='+encodeURIComponent('https://share.example/path'),
    '#code='+code+'&server='+encodeURIComponent('https://share.example/?redirect=x'),
    '#code='+code+'&server='+encodeURIComponent('https://share.example/#Intent;package=evil;end'),
    '#code='+code+'&server='+encodeURIComponent('https://share.example/\\evil'),
    '#code='+code+'&server='+encodeURIComponent(' https://share.example/'),
  ]) assert.throws(() => parseShareFragment(value), value);
  assert.throws(() => shareAppLinks({code, server:'https://share.example/#Intent;end'}));
});

test('intent package, scheme and fallback are fixed; share values stay URL encoded', () => {
  const result = shareAppLinks(parseShareFragment(fragment));
  assert.equal(result.scheme, 'qingke://share?code='+code+'&server=https%3A%2F%2Fshare.example');
  assert.equal(result.landing, 'https://qk.sagiri.org/s'+fragment);
  assert.equal(result.fallback, 'https://qk.sagiri.org/s?fallback=1'+fragment);
  assert.ok(result.intent.startsWith('intent://share?code='+code+'&server=https%3A%2F%2Fshare.example#Intent;scheme=qingke;package=cn.qingke.app;'));
  assert.ok(result.intent.endsWith('S.browser_fallback_url='+encodeURIComponent(result.fallback)+';end'));
  assert.equal((result.intent.match(/#Intent/g)||[]).length, 1);
});

test('copying a share produces a recognisable app link and no owner credentials', () => {
  const message = shareMessage(parseShareFragment(fragment));
  assert.equal(message.split('\n')[1], '口令：01234-56789-ABCDE-FGHJK');
  assert.ok(message.includes(`打开并导入：https://qk.sagiri.org/s${fragment}`));
  assert.ok(message.endsWith('App下载：https://qk.sagiri.org/'));
  assert.ok(!message.includes('deleteToken'));
  assert.equal(message.split('\n')[1].slice('口令：'.length).replaceAll('-', ''), code);
});

test('downloads target only the configured release and fixed optional proxy', () => {
  const links = releaseLinks();
  assert.match(links.official, /^https:\/\/github\.com\/SAGIRIxr\/qingke\/releases\/download\/v[\d.]+\/qingke-[\d.]+-release\.apk$/);
  assert.equal(links.proxy, 'https://gh-proxy.com/'+links.official);
  assert.ok(links.release.startsWith('https://github.com/SAGIRIxr/qingke/releases/tag/'));
});
