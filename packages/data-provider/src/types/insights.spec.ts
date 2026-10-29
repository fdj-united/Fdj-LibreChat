import { getInsightsConfig, getInsightsCategory, INSIGHTS_UNCATEGORIZED } from './insights';

describe('Insights configuration', () => {
  it('preserves existing content and keeps new charts and filters opt-in', () => {
    const config = getInsightsConfig();
    expect(config.privacy.includeFirstMessage).toBe(true);
    expect(config.filters.categories).toBe(false);
    expect(config.metrics.engagement).toBe(false);
    expect(config.maxRangeDays).toBe(30);
    expect(config.charts).toEqual({
      dailyUsage: false,
      usageByAgent: false,
      usageByCategory: false,
      defaultBreakdownView: 'doughnut',
      topN: 5,
    });
  });

  it('fills nested defaults while accepting explicit privacy and display controls', () => {
    const config = getInsightsConfig({
      privacy: { includeFirstMessage: false },
      charts: { usageByCategory: true, defaultBreakdownView: 'bar' },
    });
    expect(config.privacy.includeFirstMessage).toBe(false);
    expect(config.charts.usageByCategory).toBe(true);
    expect(config.charts.usageByAgent).toBe(false);
    expect(config.charts.defaultBreakdownView).toBe('bar');
  });

  it.each([0, -1, 21, 1.5])('rejects invalid topN %s', (topN) => {
    expect(() => getInsightsConfig({ charts: { topN } })).toThrow();
  });

  it('uses explicit aliases without conflating other categories or inherited keys', () => {
    expect(getInsightsCategory(' hr ', { hr: 'HR' })).toBe('HR');
    expect(getInsightsCategory('HR')).toBe('HR');
    expect(getInsightsCategory('constructor')).toBe('constructor');
    expect(getInsightsCategory('')).toBe(INSIGHTS_UNCATEGORIZED);
  });

  it('accepts an explicit owner dashboard and longer bounded date window', () => {
    const config = getInsightsConfig({ metrics: { engagement: true }, maxRangeDays: 90 });
    expect(config.metrics.engagement).toBe(true);
    expect(config.maxRangeDays).toBe(90);
  });

  it.each([0, -1, 366, 1.5])('rejects invalid maxRangeDays %s', (maxRangeDays) => {
    expect(() => getInsightsConfig({ maxRangeDays })).toThrow();
  });
});
