import { useId, useState } from 'react';
import {
  Select,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
  useMediaQuery,
} from '@librechat/client';
import type {
  TInsightsConfig,
  TInsightsResponse,
  TInsightsEngagement,
} from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import MetricInfo from './info';
import Panel from './panel';

type Metric = 'conversations' | 'users' | 'messages' | 'totalTokens';
const metrics = [
  { value: 'conversations', label: 'com_insights_total_conversations' },
  { value: 'users', label: 'com_insights_total_users' },
  { value: 'messages', label: 'com_insights_messages' },
  { value: 'totalTokens', label: 'com_insights_total_tokens' },
] as const;

function tickAnchor(index: number, last: number) {
  if (index === 0) return 'start';
  return index === last ? 'end' : 'middle';
}

function ChartHeading({ title, description }: { title: string; description: string }) {
  const localize = useLocalize();
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <MetricInfo
        label={localize('com_insights_about_metric', { name: title })}
        text={description}
      />
    </div>
  );
}

function DailyChart({ data, locale }: { data: TInsightsResponse; locale: string }) {
  const localize = useLocalize();
  const narrow = useMediaQuery('(max-width: 640px)');
  const width = narrow ? 320 : 640;
  const [metric, setMetric] = useState<Metric>('conversations');
  const formatter = new Intl.NumberFormat(locale);
  const dates = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const daily = data.daily;
  const maximum = Math.max(1, ...daily.map((day) => day[metric]));
  const points = daily.map((day, index) => ({
    ...day,
    x: daily.length === 1 ? width / 2 : 40 + (index / (daily.length - 1)) * (width - 60),
    y: 145 - (day[metric] / maximum) * 115,
  }));
  const metricLabel = localize(metrics.find((item) => item.value === metric)!.label);
  const ticks = [...new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1])];
  return (
    <Panel>
      <ChartHeading
        title={localize('com_insights_daily_usage')}
        description={localize('com_insights_usage_definition')}
      />
      <div className="mb-3 mt-2 flex items-center justify-between gap-3">
        <span className="text-sm text-text-secondary">
          {localize('com_insights_selected_period')}
        </span>
        <Select value={metric} onValueChange={(value) => setMetric(value as Metric)}>
          <SelectTrigger className="h-8 w-40" aria-label={localize('com_insights_metric')}>
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
        <p className="flex h-44 items-center justify-center text-sm text-text-secondary">
          {localize('com_insights_no_data')}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} 180`}
          role="img"
          aria-label={metricLabel}
          className="h-44 w-full"
          preserveAspectRatio="none"
        >
          {(maximum <= 1 ? [0, 1] : [0, 0.5, 1]).map((fraction) => (
            <g key={fraction}>
              <line
                x1="40"
                y1={145 - fraction * 115}
                x2={width - 20}
                y2={145 - fraction * 115}
                className="stroke-border-light"
              />
              <text
                x="30"
                y={149 - fraction * 115}
                textAnchor="end"
                className="fill-text-secondary"
                fontSize="11"
              >
                {formatter.format(Math.round(maximum * fraction))}
              </text>
            </g>
          ))}
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            className="text-status-info"
          />
          {points.map((point) => (
            <circle
              key={point.date}
              cx={point.x}
              cy={point.y}
              r="2.5"
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
              y="172"
              textAnchor={tickAnchor(index, daily.length - 1)}
              fontSize="11"
              className="fill-text-secondary"
            >
              {dates.format(new Date(daily[index].date))}
            </text>
          ))}
        </svg>
      )}
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
    </Panel>
  );
}

function ActivityChart({ data, locale }: { data: TInsightsEngagement; locale: string }) {
  const localize = useLocalize();
  const narrow = useMediaQuery('(max-width: 640px)');
  const width = narrow ? 320 : 640;
  const step = (width - 80) / 5;
  const barWidth = step * 0.6;
  const id = useId();
  const formatter = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const maximum = Math.max(1, ...data.activityDistribution.map((row) => row.users));
  return (
    <Panel>
      <ChartHeading
        title={localize('com_insights_activity_distribution')}
        description={localize('com_insights_distribution_definition')}
      />
      <p className="mb-3 mt-2 text-sm text-text-secondary">
        {localize('com_insights_conversations_per_user')}
      </p>
      <svg
        viewBox={`0 0 ${width} 180`}
        role="img"
        aria-labelledby={id}
        aria-describedby={`${id}-values`}
        className="h-44 w-full"
        preserveAspectRatio="none"
      >
        <title id={id}>{localize('com_insights_activity_distribution')}</title>
        <desc id={`${id}-values`}>
          {data.activityDistribution
            .map(
              (row) =>
                `${row.bucket}: ${formatter.format(row.users)} (${percent.format(data.activeUsers ? row.users / data.activeUsers : 0)})`,
            )
            .join('; ')}
        </desc>
        {(maximum <= 1 ? [0, 1] : [0, 0.5, 1]).map((fraction) => (
          <g key={fraction}>
            <line
              x1="40"
              y1={145 - fraction * 115}
              x2={width - 20}
              y2={145 - fraction * 115}
              className="stroke-border-light"
            />
            <text
              x="30"
              y={149 - fraction * 115}
              textAnchor="end"
              className="fill-text-secondary"
              fontSize="11"
            >
              {formatter.format(Math.round(maximum * fraction))}
            </text>
          </g>
        ))}
        {data.activityDistribution.map((row, index) => {
          const x = 50 + index * step;
          const height = (row.users / maximum) * 100;
          const share = percent.format(data.activeUsers ? row.users / data.activeUsers : 0);
          return (
            <g key={row.bucket}>
              <rect
                x={x}
                y={145 - height}
                width={barWidth}
                height={height}
                rx="3"
                tabIndex={0}
                aria-label={`${row.bucket}: ${formatter.format(row.users)} (${share})`}
                className="fill-current text-status-info"
              >
                <title>{`${row.bucket}: ${formatter.format(row.users)} (${share})`}</title>
              </rect>
              <text
                x={x + barWidth / 2}
                y={136 - height}
                textAnchor="middle"
                fontSize="12"
                className="fill-text-primary"
              >
                {share}
              </text>
              <text
                x={x + barWidth / 2}
                y="172"
                textAnchor="middle"
                fontSize="11"
                className="fill-text-secondary"
              >
                {row.bucket}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-3 text-sm text-text-secondary">
        {localize('com_insights_distribution_users', { count: data.activeUsers })}
      </p>
    </Panel>
  );
}

export function EngagementMetrics({ data, locale }: { data: TInsightsEngagement; locale: string }) {
  const localize = useLocalize();
  const average = data.activeConversations ? data.questions / data.activeConversations : 0;
  const rate = data.activeConversations
    ? data.singleQuestionConversations / data.activeConversations
    : 0;
  const cards = [
    {
      key: 'questions_per_conversation',
      value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(average),
      definition: 'com_insights_questions_definition' as const,
      detail: localize('com_insights_active_conversation_count', {
        count: data.activeConversations,
      }),
    },
    {
      key: 'single_question_rate',
      value: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
        rate,
      ),
      definition: 'com_insights_single_question_definition' as const,
      detail: localize('com_insights_single_question_count', {
        single: data.singleQuestionConversations,
        total: data.activeConversations,
      }),
    },
  ];
  return (
    <>
      {cards.map((card) => (
        <Panel key={card.key}>
          <ChartHeading
            title={localize(
              card.key === 'questions_per_conversation'
                ? 'com_insights_questions_per_conversation'
                : 'com_insights_single_question_rate',
            )}
            description={localize(card.definition)}
          />
          <p className="mt-3 text-4xl font-semibold tabular-nums">{card.value}</p>
          <p className="mt-3 text-sm text-text-secondary">{card.detail}</p>
        </Panel>
      ))}
    </>
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
  if (!config.dailyUsage && !data.engagement) return null;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {config.dailyUsage && <DailyChart data={data} locale={locale} />}
      {data.engagement && <ActivityChart data={data.engagement} locale={locale} />}
    </div>
  );
}
