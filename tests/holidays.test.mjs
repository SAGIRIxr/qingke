import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLIDAY_YEARS, builtinHoliday } from '../www/holidays.js';

const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

test('每年的节假日数据日期有效、属于本年且互不重叠', () => {
  assert.equal(new Set(HOLIDAY_YEARS.map(item => item.year)).size, HOLIDAY_YEARS.length);
  for (const { year, source, holidays, workdays } of HOLIDAY_YEARS) {
    assert.ok(source, `${year} 缺少通知文号`);
    const days = new Set();
    for (const [start, end, name] of holidays) {
      assert.ok(valid(start) && valid(end) && start <= end && name, `${year} ${name}`);
      assert.ok(start.startsWith(`${year}-`) && end.startsWith(`${year}-`), `${name} 不属于 ${year}`);
      for (let day = start; day <= end; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
        assert.ok(!days.has(day), `${day} 重复`); days.add(day);
      }
    }
    for (const [day, name] of workdays) {
      assert.ok(valid(day) && day.startsWith(`${year}-`) && name && !days.has(day), `${day} 调休上班日无效`);
      // Make-up working days are weekends by definition.
      assert.ok([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()), `${day} 不是周末`);
    }
  }
});

test('按日期返回假日或调休上班标记，未发布年份不猜测', () => {
  assert.deepEqual(builtinHoliday('2026-10-03'), { name: '国庆', workday: false });
  assert.deepEqual(builtinHoliday('2026-10-10'), { name: '国庆补班', workday: true });
  assert.equal(builtinHoliday('2026-10-12'), null);
  assert.equal(builtinHoliday('2030-10-01'), null);
});
