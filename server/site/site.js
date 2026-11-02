// qk.sagiri.org — shared by the home page (/) and the share landing page (/s).
// No storage, no network: links come from site-config.js, share data from the URL fragment.
// Motion only toggles classes or animates transform/opacity; looping effects pause off screen.
import {RELEASE, releaseLinks} from './site-config.js';
import {parseShareFragment, shareAppLinks, shareMessage} from './share-link.js';

const links = releaseLinks();
for (const link of document.querySelectorAll('[data-download]')) link.href = links[link.dataset.download];
for (const node of document.querySelectorAll('[data-release-version]')) node.textContent = `v${RELEASE.version}`;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = value => String(value).padStart(2, '0');

// Reveal on scroll. Anything already on screen is marked before hiding is enabled,
// so the first paint never flashes.
const reveals = [...document.querySelectorAll('[data-reveal]')];
if (!reduced && 'IntersectionObserver' in window && reveals.length) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); }
  }, {rootMargin: '0px 0px -10% 0px'});
  for (const node of reveals) {
    if (node.getBoundingClientRect().top < innerHeight * 0.95) node.classList.add('in');
    else observer.observe(node);
  }
  document.documentElement.classList.add('motion');
}

// Header state without a scroll listener: a 1px sentinel at the top of the page.
const header = document.querySelector('[data-header]');
const sentinel = document.querySelector('[data-top-sentinel]');
if (header && sentinel && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => header.classList.toggle('scrolled', !entry.isIntersecting)).observe(sentinel);
}

// Dark sections flip the header colours while they sit under it.
const darks = [...document.querySelectorAll('[data-nav-dark]')];
if (header && darks.length && 'IntersectionObserver' in window) {
  const under = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) under.add(entry.target);
      else under.delete(entry.target);
    }
    header.classList.toggle('on-dark', under.size > 0);
  }, {rootMargin: '0px 0px -96% 0px'});
  for (const node of darks) observer.observe(node);
}

// The phone mock counts down to the end of its fictional lesson (11:18 → 11:40).
const phoneTime = document.querySelectorAll('[data-phone-time]');
const countdowns = document.querySelectorAll('[data-countdown]');
const bars = document.querySelectorAll('.live .bar > i');
if (phoneTime.length || countdowns.length) {
  const start = 600 * 60, end = 700 * 60, shown = 678 * 60, began = Date.now();
  const tick = () => {
    const now = shown + Math.floor((Date.now() - began) / 1000) % (end - shown);
    const left = end - now;
    for (const node of phoneTime) node.textContent = `${pad(Math.floor(now / 3600))}:${pad(Math.floor(now / 60) % 60)}`;
    for (const node of countdowns) node.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
    for (const node of bars) node.style.setProperty('--p', ((now - start) / (end - start)).toFixed(4));
  };
  tick();
  // Pause while the tab is hidden; one cheap text update per second otherwise.
  let timer = null;
  const run = () => { clearInterval(timer); timer = document.hidden || reduced ? null : setInterval(tick, 1000); };
  document.addEventListener('visibilitychange', run);
  run();
}

/* ================= Home page demos ================= */
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ease = 'cubic-bezier(.16,1,.3,1)';
const animate = (node, frames, options) => reduced ? null : node.animate(frames, {duration: 420, easing: ease, ...options});

function setPressed(group, active) {
  for (const button of group) {
    const on = button === active;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
}

// Generic switches (role="switch").
for (const sw of $$('button[role="switch"]')) {
  sw.addEventListener('click', () => setSwitch(sw, sw.getAttribute('aria-checked') !== 'true'));
}
function setSwitch(sw, on, silent = false) {
  sw.setAttribute('aria-checked', String(on));
  sw.classList.toggle('on', on);
  if (!silent) sw.dispatchEvent(new CustomEvent('change', {detail: on}));
}

// Infinite background motion only runs while its section is on screen.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.classList.toggle('paused', !entry.isIntersecting);
  });
  for (const node of $$('[data-anim]')) io.observe(node);
}

/* ---------- Hero phone ---------- */
const COURSES = {
  math: {name: '高等数学', time: '周一 第 1–2 节 · 08:00–09:40', room: '明理楼 201', weeks: '1–16 周', exam: '考试', tag: '已结束'},
  hist: {name: '中国近代史', time: '周一 第 7–8 节 · 16:00–17:40', room: '明理楼 105', weeks: '1–16 周', exam: '考查', tag: '已结束'},
  eng: {name: '大学英语', time: '周二 第 3–4 节 · 10:00–11:40', room: '博学楼 302', weeks: '单周', exam: '考试', tag: '已结束'},
  alg: {name: '线性代数', time: '周三 第 1–2 节 · 08:00–09:40', room: '理科楼 2418', weeks: '1–12 周', exam: '考试', tag: '今天 · 已结束'},
  code: {name: '程序设计', time: '周三 第 3–4 节 · 10:00–11:40', room: '实验楼 206', weeks: '1–16 周', exam: '考试', tag: '上课中'},
  pe: {name: '体育', time: '周四 第 5–6 节 · 14:00–15:40', room: '田径场', weeks: '1–16 周', exam: '考查', tag: '明天'},
  read: {name: '通识课程', time: '周五 第 1–2 节 · 08:00–09:40', room: '知行楼 101', weeks: '3–14 周', exam: '考查', tag: '周五'},
  lab: {name: '程序实验', time: '周五 第 5–6 节 · 14:00–15:40', room: '实验楼 206', weeks: '双周', exam: '考查', tag: '周五'},
};
const phone = $('[data-phone]');
if (phone) {
  const grid = $('[data-grid]', phone);
  const sheet = $('[data-sheet]', phone);
  const viewButtons = $$('[data-view]', phone);
  let opener = null;

  for (const button of viewButtons) button.addEventListener('click', () => {
    if (button.classList.contains('on')) return;
    const apply = () => { grid.classList.toggle('three', button.dataset.view === 'three'); setPressed(viewButtons, button); };
    // View Transitions morph each course card to its new cell; otherwise switch instantly.
    if (document.startViewTransition && !reduced) document.startViewTransition(apply); else apply();
  });

  function openSheet(card) {
    const course = COURSES[card.dataset.course];
    for (const field of $$('[data-f]', sheet)) field.textContent = course[field.dataset.f];
    sheet.classList.toggle('is-live', course.tag === '上课中');
    opener = card;
    phone.classList.add('sheet-open');
    phone.parentElement.classList.add('sheet-shown');
    sheet.focus({preventScroll: true});
  }
  function closeSheet() {
    if (!phone.classList.contains('sheet-open')) return;
    phone.classList.remove('sheet-open');
    phone.parentElement.classList.remove('sheet-shown');
    opener?.focus({preventScroll: true});
  }
  for (const card of $$('[data-course]', phone)) card.addEventListener('click', () => openSheet(card));
  $('[data-close]', phone).addEventListener('click', closeSheet);
  $('[data-scrim]', phone).addEventListener('click', closeSheet);
  phone.addEventListener('keydown', event => { if (event.key === 'Escape') closeSheet(); });

  // A gentle 3D tilt that follows the pointer (mouse only).
  if (finePointer && !reduced) {
    const hero = $('.hero');
    let frame = 0, tx = 0, ty = 0;
    hero.addEventListener('pointermove', event => {
      const box = phone.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / (box.width * 1.6)));
      ty = Math.max(-1, Math.min(1, (event.clientY - (box.top + box.height / 2)) / (box.height * 1.2)));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; phone.style.transform = `perspective(1400px) rotateY(${tx * 7}deg) rotateX(${-ty * 5}deg)`; });
    });
    hero.addEventListener('pointerleave', () => { cancelAnimationFrame(frame); frame = 0; phone.style.transform = ''; });
  }
}

/* ---------- Spotlight that follows the pointer inside cards ---------- */
if (finePointer && !reduced) {
  for (const group of $$('[data-bento]')) {
    const cards = [...group.children];
    for (const card of cards) {
      const spot = document.createElement('i');
      spot.className = 'spot';
      spot.setAttribute('aria-hidden', 'true');
      card.prepend(spot);
    }
    let frame = 0, pending = null;
    group.addEventListener('pointermove', event => {
      const card = event.target.closest('[data-bento] > *');
      if (!card) return;
      pending = {card, x: event.clientX, y: event.clientY};
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        const box = pending.card.getBoundingClientRect();
        pending.card.querySelector('.spot').style.transform = `translate(${pending.x - box.left}px, ${pending.y - box.top}px)`;
      });
    });
  }
}

/* ---------- Import ---------- */
const importer = $('[data-import]');
if (importer) {
  const sources = $$('[data-src]', importer);
  const thumb = $('.seg-thumb', importer);
  const label = $('[data-src-label]', importer);
  const status = $('[data-import-status]', importer);
  const confirm = $('[data-confirm]', importer);
  const rows = $$('[data-diff] li', importer);
  const placeThumb = button => { thumb.style.width = `${button.offsetWidth}px`; thumb.style.transform = `translateX(${button.offsetLeft - 3}px)`; };
  const reset = () => { importer.classList.remove('done'); status.textContent = '2 项变化 · 1 项保护'; confirm.textContent = '确认导入'; };
  requestAnimationFrame(() => placeThumb($('.on', importer)));
  addEventListener('resize', () => placeThumb($('[data-src].on', importer)));
  for (const button of sources) button.addEventListener('click', () => {
    setPressed(sources, button);
    placeThumb(button);
    label.textContent = `${button.dataset.src} · 第一学期`;
    reset();
    rows.forEach((row, i) => animate(row, [{opacity: 0, transform: 'translateY(10px)'}, {opacity: 1, transform: 'none'}], {delay: i * 60}));
  });
  confirm.addEventListener('click', () => {
    if (importer.classList.contains('done')) { reset(); return; }
    importer.classList.add('done');
    status.textContent = '已保存到课表';
    confirm.textContent = '再演示一次';
    rows.forEach((row, i) => animate($('.ok', row), [{opacity: 0, transform: 'scale(.4)'}, {opacity: 1, transform: 'none'}], {delay: 80 + i * 90, fill: 'backwards'}));
  });
}

/* ---------- Zero counter ---------- */
const counter = $('[data-count]');
if (counter && !reduced && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    const start = performance.now(), from = 99, duration = 900;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      counter.textContent = String(Math.round(from * (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, {threshold: .6});
  io.observe(counter);
}

/* ---------- Reminders ---------- */
const remind = $('[data-remind]');
if (remind) {
  const sw = $('[data-remind-switch]', remind);
  const chips = $$('[data-lead]', remind);
  const notice = $('[data-remind-notice]', remind);
  const leadText = $('[data-lead-text]', remind), leadTime = $('[data-lead-time]', remind);
  sw.addEventListener('change', event => {
    remind.classList.toggle('off', !event.detail);
    for (const chip of chips) chip.disabled = !event.detail;
  });
  for (const chip of chips) chip.addEventListener('click', () => {
    setPressed(chips, chip);
    const lead = Number(chip.dataset.lead);
    leadText.textContent = `${lead} 分钟后上课`;
    leadTime.textContent = `9:${String(60 - lead).padStart(2, '0')}`;
    animate(notice, [{transform: 'translateY(-8px) scale(.98)', opacity: .4}, {transform: 'none', opacity: 1}], {duration: 520});
  });
}

/* ---------- Calendar ---------- */
const month = $('[data-month]');
if (month) {
  const STATES = [['', '', '上课'], ['stop', '停课', '停课'], ['make', '补课', '补课']];
  const days = $$('[data-day]', month);
  const sum = $('[data-month-sum]');
  const describe = () => {
    const stop = $$('.stop', month).length, make = $$('.make', month).length;
    sum.textContent = stop || make ? `停课 ${stop} 天 · 补课 ${make} 天` : '这一周照常上课';
    for (const day of days) {
      const state = STATES.find(([cls]) => cls ? day.classList.contains(cls) : !day.classList.contains('stop') && !day.classList.contains('make'));
      day.setAttribute('aria-label', `10月${day.dataset.day}日，${state[2]}，点按切换`);
    }
  };
  for (const day of days) day.addEventListener('click', () => {
    const current = day.classList.contains('stop') ? 1 : day.classList.contains('make') ? 2 : 0;
    const [cls, text] = STATES[(current + 1) % 3];
    day.classList.remove('stop', 'make');
    if (cls) day.classList.add(cls);
    day.querySelector('i').textContent = text;
    animate(day, [{transform: 'scale(.86)'}, {transform: 'scale(1.06)'}, {transform: 'none'}], {duration: 380});
    describe();
  });
  describe();
}

/* ---------- Share code scramble ---------- */
const code = $('[data-code]');
const regen = $('[data-regen]');
if (code && regen) {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const parts = $$('span', code);
  const random = () => ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0] % 32];
  regen.addEventListener('click', () => {
    const target = Array.from({length: 20}, random).join('');
    const start = performance.now(), duration = reduced ? 0 : 640;
    const step = now => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const settled = Math.floor(t * 20);
      const text = Array.from({length: 20}, (_, i) => i < settled ? target[i] : random()).join('');
      parts.forEach((part, i) => { part.textContent = text.slice(i * 5, i * 5 + 5); });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ---------- Offline ---------- */
const offline = $('[data-offline]');
if (offline) {
  const airplane = $('[data-airplane]', offline), wifi = $('[data-wifi]', offline);
  const ok = $('[data-ok]', offline), okText = $('[data-ok-text]', offline);
  const update = () => {
    const online = wifi.getAttribute('aria-checked') === 'true';
    okText.textContent = online ? '已联网 · 课表依然读自本机' : '无网络 · 课表照常打开';
    ok.classList.toggle('online', online);
    animate(ok, [{transform: 'scale(.97)', opacity: .5}, {transform: 'none', opacity: 1}], {duration: 360});
  };
  airplane.addEventListener('change', event => { if (event.detail) setSwitch(wifi, false, true); update(); });
  wifi.addEventListener('change', event => { if (event.detail) setSwitch(airplane, false, true); update(); });
}

/* ================= Share landing page ================= */
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
