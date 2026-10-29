import { getRollingDateRange, getTodayDateRange } from './dateRange';

describe('Insights date ranges', () => {
  it('starts Today at local midnight instead of subtracting 24 hours', () => {
    const now = new Date(2026, 9, 29, 15, 30);
    const range = getTodayDateRange(now);
    expect(range.startDate).toEqual(new Date(2026, 9, 29));
    expect(range.endDate).toEqual(now);
    expect(now.getHours()).toBe(15);
  });
  it('builds shortcut bounds from the same rolling duration as the query', () => {
    const endDate = new Date(2026, 7, 31, 15, 30);

    const range = getRollingDateRange(endDate, 30);

    expect(range.endDate.getTime() - range.startDate.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(range.endDate).toEqual(endDate);
  });
});
