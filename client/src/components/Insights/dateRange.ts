const millisecondsPerDay = 24 * 60 * 60 * 1000;

export function getTodayDateRange(endDate: Date) {
  const startDate = new Date(endDate);
  startDate.setHours(0, 0, 0, 0);
  return { startDate, endDate: new Date(endDate) };
}

export function getRollingDateRange(endDate: Date, days: number) {
  const rangeEnd = new Date(endDate);
  const rangeStart = new Date(endDate.getTime() - days * millisecondsPerDay);
  return { startDate: rangeStart, endDate: rangeEnd };
}
