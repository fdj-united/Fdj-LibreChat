# Insights for agent owners

`ENABLE_INSIGHTS=true` enables Insights. Existing tenant and agent permissions
still determine which records the viewer can access.

For an owner dashboard, add this section to `librechat.yaml`. With Helm/GitOps,
put it inside `librechat.configYamlContent` in `dev.tools`:

```yaml
insights:
  privacy:
    includeFirstMessage: false
  maxRangeDays: 90
  metrics:
    engagement: true
  filters:
    categories: true
  charts:
    dailyUsage: true
  categoryAliases:
    hr: HR
```

New capabilities remain opt-in: engagement defaults to false and the custom date
limit stays at 30 days. `maxRangeDays` accepts 1–365; measure query costs before
raising it on a large deployment. The browser and backend use the same configured
limit. Oversized direct API custom-range requests retain the existing behavior:
the backend bounds the range to the configured number of calendar days ending at
the requested end date.

Insights loads on opening the page or changing its filters. Refresh explicitly
reloads the current selection; no periodic job, polling interval, new service or
chat-generation hook is introduced. The default remains seven days. Today means
midnight to now in the viewer's timezone; 24h remains a rolling 24-hour interval.

## Adoption and engagement

Adoption retains existing metrics: newly created conversations and distinct
conversation owners with user or assistant messages in the selected period.
Daily user counts must not be added to calculate period-wide unique users.

Engagement retains recorded messages and tokens. When enabled, one additional
MongoDB aggregation provides all new metrics:

- Active conversations: distinct conversations receiving a user-authored message
  during the period, including chats created before that period.
- Questions per conversation: user-authored messages in the period divided by
  active conversations in that same period. A message counts as a question
  without analysing its text; assistant and tool outputs are excluded.
- Single-question rate: active conversations with exactly one user-authored
  message in the period divided by all active conversations. This describes the
  selected window, not lifetime conversation depth, answer quality or resolution.
- User activity distribution: users bucketed by distinct active conversations
  into 1, 2–5, 6–10, 11–20 and 21+. Bar heights are user counts; labels divide each
  count by all question-asking users in the same scope and period. Users are
  deduplicated across the selected agents.

Zero denominators display zero. Temporary conversations, child threads and
messages whose owner does not match the conversation are excluded. Existing
initial-agent attribution and legacy-agent fallback are preserved. Conversation
table search does not change dashboard totals.

Every chart and KPI has an information button explaining its definition. It
supports pointer hover, keyboard focus, click/tap and Escape. Charts remain
half-width on desktop and stack on mobile; the usage plot has a fixed height.

The agent/category pie panels and their aggregation have been removed. Legacy
`charts.usageByAgent`, `usageByCategory`, `defaultBreakdownView` and `topN` settings
remain accepted for deployment compatibility but no longer produce breakdowns.

## Privacy and scope

With `includeFirstMessage: false`, the first-message query is skipped and
`firstMessage` is omitted from the response and table. Query parameters cannot
enable it. Normal chat history and conversation access are unaffected.

Category aliases are exact, case-sensitive, one-step mappings. Category filtering
intersects authorized agents and the explicit agent selection. Missing or blank
categories use the Uncategorised bucket. No LLM calls, prompt classification,
new telemetry, new/returning-user classification or tool-outcome inference is used.

## Verification

Focused tests use disposable MongoDB to check metric denominators, bucket
boundaries, permissions, privacy, timezone-aware Today and custom ranges longer
than 30 days. The local browser test uses synthetic users and messages; it checks
real API responses, information controls, Refresh, date selection and mobile
layout, and captures screenshots before publication:

```sh
E2E_CHROMIUM_CHANNEL=chrome E2E_MODEL_FIXTURES=replay E2E_REPLICAS=1 \
  npx playwright test -c e2e/playwright.config.insights.ts
```

Screenshots are under `e2e/insights/.test-results`. These local fixtures do not
establish shared DEV database performance or replace authenticated DEV checks.
