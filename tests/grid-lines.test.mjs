import test from 'node:test';
import assert from 'node:assert/strict';
import { majorBoundaries, gridLines } from '../www/planner-ui.js';
import { createState, setPeriodCount } from '../www/engine.js';

const periods = createState().semesters[0].profiles[0].periods;

test('默认作息按大节分块：上午下午按长课间，晚上课间相同则两节一组', () => {
  assert.deepEqual([...majorBoundaries(periods)].sort((a, b) => a - b), [2, 4, 6, 8, 10]);
});

test('全是两节连上的课只画大节横线；单节课或跨大节的课补画自己的上下边', () => {
  const pairs = [{ startPeriod: 1, endPeriod: 2 }, { startPeriod: 5, endPeriod: 6 }];
  assert.deepEqual(gridLines(periods, 12, pairs), [2, 4, 6, 8, 10]);
  assert.deepEqual(gridLines(periods, 12, [...pairs, { startPeriod: 3, endPeriod: 3 }]), [2, 3, 4, 6, 8, 10]);
  assert.deepEqual(gridLines(setPeriodCount(periods, 13), 13, [{ startPeriod: 11, endPeriod: 13 }]), [2, 4, 6, 8, 10, 12], '第 13 节同样分隔');
  const uniform = Array.from({ length: 6 }, (_, i) => ({ start: `${String(8 + i).padStart(2, '0')}:00`, end: `${String(8 + i).padStart(2, '0')}:45`, group: 'morning' }));
  assert.deepEqual([...majorBoundaries(uniform)], [2, 4]);
});

test('每天节数可直接设置：增加接在最后一节后，减少从最后删起，不能越过午夜', () => {
  const thirteen = setPeriodCount(periods, 13);
  assert.equal(thirteen.length, 13);
  assert.deepEqual(thirteen[12], { start: '22:40', end: '23:25', group: 'evening' });
  assert.deepEqual(setPeriodCount(periods, 8), periods.slice(0, 8));
  assert.throws(() => setPeriodCount(periods, 15), /超过当天 24:00/);
});
