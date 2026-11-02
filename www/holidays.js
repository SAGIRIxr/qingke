// Mainland China public holidays, one entry per year from the State Council notice
// (usually published in November/December for the following year).
// Yearly maintenance: copy the notice's dates into a new entry, run `npm test`, release.
// Labels only: they never cancel or move classes; schools announce their own arrangements.
export const HOLIDAY_YEARS = [
  {
    year: 2026,
    source: '国办发明电〔2025〕7号',
    holidays: [
      ['2026-01-01', '2026-01-03', '元旦'],
      ['2026-02-15', '2026-02-23', '春节'],
      ['2026-04-04', '2026-04-06', '清明'],
      ['2026-05-01', '2026-05-05', '劳动节'],
      ['2026-06-19', '2026-06-21', '端午'],
      ['2026-09-25', '2026-09-27', '中秋'],
      ['2026-10-01', '2026-10-07', '国庆'],
    ],
    // Weekend days that are official working days to make up for a holiday.
    workdays: [
      ['2026-01-04', '元旦'],
      ['2026-02-14', '春节'], ['2026-02-28', '春节'],
      ['2026-05-09', '劳动节'],
      ['2026-09-20', '国庆'], ['2026-10-10', '国庆'],
    ],
  },
];

/** `{name, workday}` for a YYYY-MM-DD date, or null when the date is ordinary or its year is not published. */
export function builtinHoliday(date, years = HOLIDAY_YEARS) {
  const entry = years.find(item => String(item.year) === String(date).slice(0, 4));
  if (!entry) return null;
  const holiday = entry.holidays.find(([start, end]) => date >= start && date <= end);
  if (holiday) return { name: holiday[2], workday: false };
  const workday = entry.workdays.find(([day]) => day === date);
  return workday ? { name: `${workday[1]}补班`, workday: true } : null;
}

export const holidayYearsText = (years = HOLIDAY_YEARS) => years.map(item => item.year).join('、');
