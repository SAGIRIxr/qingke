import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderTimes, upcomingLeads, UPCOMING_LEADS, validateState, createState } from '../www/engine.js';
import { nextOccurrenceIds } from '../www/course-live.js';
import { courseRefreshDelay } from '../www/live-clock.js';

const t = (h, m = 0, day = 12) => new Date(2026, 9, day, h, m).getTime();
const lesson = (id, start, end, day = 12) => ({ id, date: `2026-10-${day}`, startMs: start, endMs: end });

test('前面有课提前 35 分钟，前面没课提前 90 分钟但不早于上一节下课、不跨天', () => {
  const items = [
    lesson('first', t(8), t(9, 40)),        // 当天第一节：起床时提示
    lesson('next', t(10), t(11, 40)),       // 课间 20 分钟：接着上
    lesson('after-lunch', t(14), t(15, 40)),// 午休后：提前 90 分钟
    lesson('evening', t(19), t(20, 40)),    // 晚饭间隔 80 分钟：不早于 17:40 下课
    lesson('dinner-break', t(17, 0), t(17, 40)),
    lesson('dawn', t(1, 0, 13), t(1, 45, 13), 13),
  ];
  const remind = reminderTimes(items);
  assert.equal(remind.get('first'), t(6, 30));
  assert.equal(remind.get('next'), t(9, 25));
  assert.equal(remind.get('after-lunch'), t(12, 30));
  assert.equal(remind.get('dinner-break'), t(15, 40), '上一节 15:40 下课，90 分钟前被截到下课时间');
  assert.equal(remind.get('evening'), t(17, 40));
  assert.equal(remind.get('dawn'), t(0, 0, 13), '不提前到前一天');
});

test('提前量可自定义，旧数据不写入新字段也能读取默认值', () => {
  const remind = reminderTimes([lesson('a', t(8), t(9)), lesson('b', t(9, 10), t(10))], { afterClass: 15, firstClass: 40 });
  assert.equal(remind.get('a'), t(7, 20));
  assert.equal(remind.get('b'), t(8, 55));
  const state = createState();
  assert.deepEqual(upcomingLeads(validateState(state).preferences.notifications), UPCOMING_LEADS);
  assert.ok(!('leadFirst' in validateState(state).preferences.notifications));
  state.preferences.notifications.leadFirst = 300;
  assert.throws(() => validateState(state), /前面没课时/);
});

test('即将上课标记与刷新时间按各自的提示时间计算', () => {
  const items = [lesson('first', t(8), t(9, 40)), lesson('next', t(10), t(11, 40))];
  const remind = reminderTimes(items);
  items.forEach(item => { item.remindAt = remind.get(item.id); });
  assert.deepEqual([...nextOccurrenceIds(items, t(6, 29))], []);
  assert.deepEqual([...nextOccurrenceIds(items, t(6, 30))], ['first']);
  assert.deepEqual([...nextOccurrenceIds(items, t(9, 25))], ['next'], '上课中也标出 35 分钟内的下一节');
  assert.equal(courseRefreshDelay(items, t(6, 30) - 20000), 20000, '在提示开始的那一刻刷新');
});
