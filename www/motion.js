const installed = new WeakMap();
const EASE = 'cubic-bezier(.18,.8,.24,1)';

/** Install once on #app. Delegation survives timetable re-renders. */
export function installTimetableMotion({root, onNavigate}) {
  if (!root || typeof onNavigate !== 'function') throw new TypeError('课表动画需要 root 和 onNavigate');
  installed.get(root)?.();
  const view = root.ownerDocument?.defaultView || window;
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const active = new Map();
  let gesture = null, frame = 0, suppressUntil = 0, animationEpoch = 0, blocked = null;
  const now = () => view.performance.now();
  const motionOff = () => !!reduced?.matches;
  const shell = () => root.querySelector('.table-shell');
  const restore = (node, saved) => {
    node.style.transform = saved.transform;
    node.style.opacity = saved.opacity;
    node.style.transition = saved.transition;
    node.style.willChange = saved.willChange;
  };
  const snapshot = node => ({transform: node.style.transform, opacity: node.style.opacity,
    transition: node.style.transition, willChange: node.style.willChange});
  function stop(node) {
    const entry = active.get(node);
    if (!entry) return;
    active.delete(node);
    entry.animation.cancel();
    restore(node, entry.saved);
  }
  function animate(node, frames, duration, saved = snapshot(node)) {
    if (!node) return;
    stop(node);
    if (motionOff() || typeof node.animate !== 'function') { restore(node, saved); return; }
    restore(node, saved);
    node.style.willChange = 'transform, opacity';
    const animation = node.animate(frames, {duration, easing: EASE, fill: 'none'});
    const entry = {animation, saved};
    active.set(node, entry);
    const finish = () => {
      if (active.get(node) !== entry) return;
      active.delete(node);
      restore(node, saved);
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }
  function cancelFrame() { if (frame) { view.cancelAnimationFrame(frame); frame = 0; } }
  function settle(value, animateBack = true) {
    cancelFrame();
    if (!value) return;
    if (animateBack && value.axis === 'x') animate(value.node,
      [{transform: `translate3d(${value.visualX}px,0,0)`, opacity: value.opacity},
        {transform: value.saved.transform || 'none', opacity: value.saved.opacity || 1}], 220, value.saved);
    else restore(value.node, value.saved);
  }
  function reset(animateBack = true) {
    const previous = gesture;
    gesture = null;
    if (previous?.axis === 'x') suppressUntil = now() + 420;
    settle(previous, animateBack);
  }
  function animatePage(direction = 0) {
    reset(false);
    animationEpoch++;
    const node = shell();
    if (!node) return;
    if (blocked?.node !== node) blocked = null;
    stop(node);
    const saved = snapshot(node);
    const offset = Math.sign(direction) * Math.min(48, node.getBoundingClientRect().width * .13);
    animate(node, [{transform: `translate3d(${offset}px,0,0)`, opacity: .84},
      {transform: saved.transform || 'none', opacity: saved.opacity || 1}], 220, saved);
  }
  function animateTab() {
    reset(false);
    for (const node of active.keys()) stop(node);
    const page = root.querySelector('.page');
    if (!page) return;
    const saved = snapshot(page);
    animate(page, [{transform: 'translate3d(0,7px,0)', opacity: .78},
      {transform: saved.transform || 'none', opacity: saved.opacity || 1}], 180, saved);
  }
  function touchStart(event) {
    if (event.touches.length !== 1) { reset(); return; }
    const node = event.target?.closest?.('.table-shell');
    if (!node || !root.contains(node) || event.target.closest('input,textarea,select,[contenteditable="true"],[data-no-swipe]')) return;
    const touch = event.touches[0];
    // Leave the operating system's edge-back gesture available.
    if (touch.clientX < 18 || touch.clientX > view.innerWidth - 18) return;
    reset(false);
    stop(node);
    gesture = {node, identifier: touch.identifier, startX: touch.clientX, startY: touch.clientY,
      x: touch.clientX, y: touch.clientY, started: now(), axis: null, visualX: 0, opacity: 1,
      width: Math.max(1, node.getBoundingClientRect().width), saved: snapshot(node)};
  }
  function touchMove(event) {
    const value = gesture;
    if (!value) return;
    if (event.touches.length !== 1 || !value.node.isConnected) { reset(); return; }
    const touch = Array.from(event.touches).find(item => item.identifier === value.identifier);
    if (!touch) { reset(); return; }
    value.x = touch.clientX; value.y = touch.clientY;
    const dx = value.x - value.startX, dy = value.y - value.startY;
    if (!value.axis) {
      if (Math.abs(dy) > 9 && Math.abs(dy) >= Math.abs(dx) * .82) value.axis = 'y';
      else if (Math.abs(dx) > 11 && Math.abs(dx) > Math.abs(dy) * 1.25) value.axis = 'x';
    }
    if (value.axis !== 'x') return;
    if (event.cancelable) event.preventDefault();
    const direction = dx < 0 ? 1 : -1;
    const atBoundary = blocked?.node === value.node && blocked.direction === direction;
    const limit = value.width * (atBoundary ? .1 : .42);
    value.visualX = motionOff() ? 0 : Math.sign(dx) * limit * (1 - Math.exp(-Math.abs(dx) / limit));
    value.opacity = motionOff() ? 1 : 1 - Math.min(Math.abs(value.visualX) / value.width, 1) * .12;
    if (!frame) frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (gesture !== value || !value.node.isConnected) return;
      value.node.style.transition = 'none';
      value.node.style.willChange = 'transform, opacity';
      value.node.style.transform = `translate3d(${value.visualX}px,0,0)`;
      value.node.style.opacity = String(value.opacity);
    });
  }
  function touchEnd(event) {
    const value = gesture;
    if (!value) return;
    const touch = Array.from(event.changedTouches || []).find(item => item.identifier === value.identifier);
    if (!touch) return;
    gesture = null;
    cancelFrame();
    if (value.axis !== 'x' || !value.node.isConnected) { settle(value, false); return; }
    suppressUntil = now() + 420;
    const dx = touch.clientX - value.startX, duration = Math.max(1, now() - value.started);
    const committed = Math.abs(dx) >= Math.min(100, value.width * .23) || (Math.abs(dx) >= 30 && Math.abs(dx) / duration > .42);
    if (!committed) { settle(value); return; }
    const delta = dx < 0 ? 1 : -1, epoch = animationEpoch;
    let accepted;
    try { accepted = onNavigate(delta) !== false; }
    catch (error) { settle(value); throw error; }
    if (!accepted) { blocked = {node: value.node, direction: delta}; settle(value); return; }
    blocked = null;
    restore(value.node, value.saved);
    if (animationEpoch === epoch) animatePage(delta);
  }
  const touchCancel = () => reset();
  const preferenceChanged = () => { if (motionOff()) { reset(false); for (const node of active.keys()) stop(node); } };
  root.addEventListener('touchstart', touchStart, {passive: true});
  root.addEventListener('touchmove', touchMove, {passive: false});
  root.addEventListener('touchend', touchEnd, {passive: true});
  root.addEventListener('touchcancel', touchCancel, {passive: true});
  reduced?.addEventListener?.('change', preferenceChanged);
  installed.set(root, () => {
    reset(false);
    for (const node of active.keys()) stop(node);
    root.removeEventListener('touchstart', touchStart);
    root.removeEventListener('touchmove', touchMove);
    root.removeEventListener('touchend', touchEnd);
    root.removeEventListener('touchcancel', touchCancel);
    reduced?.removeEventListener?.('change', preferenceChanged);
  });
  return {animatePage, animateTab, suppressClick: () => now() < suppressUntil};
}
