# Insights controls and charts

`ENABLE_INSIGHTS=true` enables Insights. Existing tenant and agent permissions
still control which records a viewer can see.

Add this optional section to `librechat.yaml`. For Helm/GitOps, put it inside the
existing `librechat.configYamlContent` block in `dev.tools`.

```yaml
insights:
  privacy:
    includeFirstMessage: false
  filters:
    categories: true
  charts:
    dailyUsage: true
    usageByAgent: true
    usageByCategory: true
    defaultBreakdownView: doughnut
    topN: 5
  categoryAliases:
    hr: HR
    general: General productivity
```

Without this section, First Message retains its existing behavior and the new
charts and category filter remain disabled. `defaultBreakdownView` accepts
`doughnut` or `bar`; `topN` accepts integers from 1 through 20. It limits visible
segments, not the records included in totals. Remaining segments are combined
into Other (combined).

With `includeFirstMessage: false`, the first-message query is skipped and
`firstMessage` is omitted from the Insights response and table. Request parameters
cannot enable it. Normal chat history and conversation access are unaffected.

Category aliases are exact, case-sensitive, one-step mappings. They group existing
categories without changing stored agents or the category catalogue. Missing or
blank categories use the Uncategorised bucket. Category choices come only from
authorized agents; category filtering intersects that set with selected agents.

## Definitions

- Daily usage reuses existing conversations, unique users, messages and tokens.
  Period-wide unique users are not the sum of daily unique users.
- Breakdowns count conversations created in the selected period, attributed to
  the initial agent, falling back to the existing agent field for legacy records.
  Temporary conversations and child threads retain existing exclusion rules.
- Categories reflect the agent's current category; recategorisation can change
  historical grouping. This feature does not collect category-at-start snapshots.
- Each breakdown totals to the conversations KPI for the selected scope. The
  conversation table's text search does not change dashboard totals.
- No LLM calls, prompt classification or new telemetry collection is used.

Both breakdowns share one conversation aggregation. Category counts are derived
from the authorized agent mapping. When both breakdowns are disabled, this extra
aggregation is skipped.

## Verification

The dedicated browser test runs against a disposable local database, seeds
synthetic agent conversations and checks the real response, privacy policy,
category filter and charts. It never calls a model provider.

```sh
E2E_BASE_URL=http://127.0.0.1:3107 E2E_CHROMIUM_CHANNEL=chrome npx playwright test -c e2e/playwright.config.insights.ts
```

It captures desktop and mobile screenshots under `e2e/insights/.test-results`.
