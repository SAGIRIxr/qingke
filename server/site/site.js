import {RELEASE, releaseLinks} from './site-config.js';
import {parseShareFragment, shareAppLinks, shareMessage} from './share-link.js';

const links = releaseLinks();
for (const link of document.querySelectorAll('[data-download]')) link.href = links[link.dataset.download];
for (const node of document.querySelectorAll('[data-release-version]')) node.textContent = `v${RELEASE.version}`;

if (document.querySelector('#share-code')) {
  const codeInput = document.querySelector('#share-code');
  const error = document.querySelector('#share-error');
  const open = document.querySelector('#open-app');
  const copy = document.querySelector('#copy-code');
  const status = document.querySelector('#copy-status');
  const fallback = document.querySelector('#open-fallback');
  let share = null, timer = null;
  const cancelFallback = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const showFallback = () => { timer = null; if (!document.hidden) fallback.hidden = false; };
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  function readLink() {
    cancelFallback();
    share = null; open.disabled = copy.disabled = true;
    document.querySelector('#share-values').hidden = true;
    error.hidden = true; status.textContent = ''; codeInput.value = ''; document.querySelector('#share-host').textContent = '';
    fallback.hidden = new URLSearchParams(location.search).get('fallback') !== '1';
    try {
      share = parseShareFragment(location.hash);
      codeInput.value = share.code;
      document.querySelector('#share-host').textContent = share.host;
      document.querySelector('#share-values').hidden = false;
      open.disabled = copy.disabled = false;
      document.querySelector('#wechat-note').hidden = !isWeChat;
    } catch (problem) {
      error.textContent = `${problem.message}。请向分享者索取完整链接，或在清课中手动输入口令。`;
      error.hidden = false;
    }
  }
  open.addEventListener('click', () => {
    if (!share) return;
    if (isWeChat) { document.querySelector('#wechat-note').hidden = false; showFallback(); return; }
    const destinations = shareAppLinks(share);
    cancelFallback(); fallback.hidden = true;
    // A timer only reveals choices. It never decides whether the app is installed
    // and never navigates to a download. Backgrounding cancels this hint.
    timer = setTimeout(showFallback, 1800);
    location.assign(/Android/i.test(navigator.userAgent) ? destinations.intent : destinations.scheme);
  });
  copy.addEventListener('click', async () => {
    if (!share) return;
    try {
      if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(shareMessage(share));
      status.textContent = '分享消息已复制。打开清课后，可确认导入这份课表。';
    } catch {
      codeInput.focus(); codeInput.select();
      status.textContent = '口令已选中，请长按或使用复制命令。';
    }
  });
  window.addEventListener('hashchange', readLink);
  window.addEventListener('pagehide', cancelFallback);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelFallback(); });
  readLink();
}
