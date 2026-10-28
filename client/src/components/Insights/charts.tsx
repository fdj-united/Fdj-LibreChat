import { useId, useMemo, useState } from 'react';
import { INSIGHTS_UNCATEGORIZED } from 'librechat-data-provider';
import {
  Button,
  Select,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
} from '@librechat/client';
import type {
  TInsightsConfig,
  TInsightsResponse,
  TInsightsBreakdown,
  TInsightsDailyPoint,
} from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Panel from './panel';

type Metric = 'conversations' | 'users' | 'messages' | 'totalTokens';
const metrics = [
  { value: 'conversations', label: 'com_insights_total_conversations' },
  { value: 'users', label: 'com_insights_total_users' },
  { value: 'messages', label: 'com_insights_messages' },
  { value: 'totalTokens', label: 'com_insights_total_tokens' },
] as const;
const colors = [
  'text-status-info',
  'text-status-success',
  'text-status-warning',
  'text-text-secondary',
  'text-status-info-strong',
  'text-text-primary',
];

function DailyChart({ daily, locale }: { daily: TInsightsDailyPoint[]; locale: string }) {
  const localize = useLocalize();
  const titleId = useId();
  const [metric, setMetric] = useState<Metric>('conversations');
  const formatter = new Intl.NumberFormat(locale);
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const maximum = Math.max(1, ...daily.map((day) => day[metric]));
  const points = daily.map((day, index) => ({
    ...day,
    x: daily.length === 1 ? 320 : 40 + (index / (daily.length - 1)) * 560,
    y: 165 - (day[metric] / maximum) * 135,
  }));
  const metricLabel = localize(metrics.find((item) => item.value === metric)!.label);
  const ticks = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])];

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold">
          {localize('com_insights_daily_usage')}
        </h2>
        <Select value={metric} onValueChange={(value) => setMetric(value as Metric)}>
          <SelectTrigger className="w-44" aria-label={localize('com_insights_metric')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {metrics.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {localize(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {points.length === 0 ? (
        <p className="py-8 text-text-secondary">{localize('com_insights_no_data')}</p>
      ) : (
        <>
          <svg viewBox="0 0 640 200" role="img" aria-label={metricLabel} className="w-full">
            <line x1="40" y1="165" x2="600" y2="165" className="stroke-border-medium" />
            <line x1="40" y1="30" x2="600" y2="30" className="stroke-border-light" />
            <text x="36" y="25" className="fill-text-secondary" fontSize="11">
              {formatter.format(maximum)}
            </text>
            <text x="36" y="180" className="fill-text-secondary" fontSize="11">
              0
            </text>
            <polyline
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-status-info"
            />
            {points.map((point) => (
              <circle
                key={point.date}
                cx={point.x}
                cy={point.y}
                r="4"
                tabIndex={0}
                aria-label={`${point.date}: ${formatter.format(point[metric])}`}
                className="fill-current text-status-info"
              >
                <title>{`${point.date}: ${formatter.format(point[metric])}`}</title>
              </circle>
            ))}
            {ticks.map((index) => (
              <text
                key={index}
                x={points[index].x}
                y="195"
                textAnchor="middle"
                fontSize="11"
                className="fill-text-secondary"
              >
                {dateFormatter.format(new Date(daily[index].date))}
              </text>
            ))}
          </svg>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-text-secondary">
              {localize('com_insights_view_chart_data')}
            </summary>
            <table className="mt-2 w-full text-left tabular-nums">
              <thead>
                <tr>
                  <th>{localize('com_insights_date')}</th>
                  <th>{metricLabel}</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{formatter.format(day[metric])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Panel>
  );
}

function BreakdownChart({
  title,
  description,
  rows,
  config,
  locale,
}: {
  title: string;
  description?: string;
  rows: TInsightsBreakdown[];
  config: TInsightsConfig['charts'];
  locale: string;
}) {
  const localize = useLocalize();
  const titleId = useId();
  const [view, setView] = useState(config.defaultBreakdownView);
  const formatter = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const { items, total } = useMemo(() => {
    const sorted = [...rows].sort(
      (a, b) => b.conversations - a.conversations || a.id.localeCompare(b.id),
    );
    const leading = sorted.slice(0, config.topN);
    const remaining = sorted.slice(config.topN).reduce((sum, row) => sum + row.conversations, 0);
    const items = leading.map((row) => ({ ...row, combined: false }));
    if (remaining > 0) {
      items.push({
        id: '__insights_remaining__',
        label: '',
        conversations: remaining,
        combined: true,
      });
    }
    return { items, total: rows.reduce((sum, row) => sum + row.conversations, 0) };
  }, [rows, config.topN]);
  const label = (row: (typeof items)[number]) => {
    if (row.combined) return localize('com_insights_other_combined');
    if (row.id === INSIGHTS_UNCATEGORIZED) return localize('com_insights_uncategorized');
    return row.label;
  };
  const circumference = 2 * Math.PI * 70;
  let offset = 0;

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <div className="flex gap-1" role="group" aria-label={localize('com_insights_chart_view')}>
          {(['bar', 'doughnut'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={view === mode ? 'outline' : 'ghost'}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {localize(mode === 'bar' ? 'com_insights_graph' : 'com_insights_pie')}
            </Button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-text-secondary">
        {localize('com_insights_breakdown_definition')}
      </p>
      {description && <p className="mb-3 text-xs text-text-secondary">{description}</p>}
      {total === 0 ? (
        <p className="py-8 text-text-secondary">{localize('com_insights_no_data')}</p>
      ) : (
        <div className="flex flex-col items-stretch justify-center gap-5 sm:flex-row sm:items-center">
          {view === 'doughnut' && (
            <svg
              viewBox="0 0 200 200"
              className="w-56 shrink-0 self-center"
              role="img"
              aria-labelledby={titleId}
            >
              {items.map((row, index) => {
                const size = (row.conversations / total) * circumference;
                const start = offset;
                offset += size;
                return (
                  <circle
                    key={row.id}
                    cx="100"
                    cy="100"
                    r="70"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="30"
                    strokeDasharray={`${size} ${circumference - size}`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 100 100)"
                    className={colors[index % colors.length]}
                  >
                    <title>{`${label(row)}: ${formatter.format(row.conversations)} (${percent.format(row.conversations / total)})`}</title>
                  </circle>
                );
              })}
              <text x="100" y="100" textAnchor="middle" className="fill-text-primary" fontSize="20">
                {formatter.format(total)}
              </text>
            </svg>
          )}
          <ol className="min-w-0 flex-1 space-y-3 text-sm" aria-label={title}>
            {items.map((row, index) => (
              <li key={row.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-3 shrink-0 rounded-sm bg-current',
                        colors[index % colors.length],
                      )}
                    />
                    <span className="break-words">{label(row)}</span>
                  </span>
                  <span className="tabular-nums text-text-secondary">
                    {formatter.format(row.conversations)} (
                    {percent.format(row.conversations / total)})
                  </span>
                </div>
                {view === 'bar' && (
                  <div className="mt-1 h-3 overflow-hidden rounded-sm bg-surface-tertiary">
                    <div
                      className={cn('h-full bg-current', colors[index % colors.length])}
                      style={{ width: `${(row.conversations / total) * 100}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

export default function Charts({
  data,
  config,
  locale,
}: {
  data: TInsightsResponse;
  config: TInsightsConfig['charts'];
  locale: string;
}) {
  const localize = useLocalize();
  return (
    <>
      {config.dailyUsage && <DailyChart daily={data.daily} locale={locale} />}
      {(config.usageByAgent || config.usageByCategory) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {config.usageByAgent && (
            <BreakdownChart
              title={localize('com_insights_usage_by_agent')}
              rows={data.breakdowns?.agents ?? []}
              config={config}
              locale={locale}
            />
          )}
          {config.usageByCategory && (
            <BreakdownChart
              title={localize('com_insights_usage_by_category')}
              description={localize('com_insights_current_category_definition')}
              rows={data.breakdowns?.categories ?? []}
              config={config}
              locale={locale}
            />
          )}
        </div>
      )}
    </>
  );
}
