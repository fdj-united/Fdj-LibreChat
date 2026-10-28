import { expect, test } from '@playwright/test';
import type { TInsightsResponse } from 'librechat-data-provider';
import { withMongo } from '../specs/mock/db';
import { getE2EUser } from '../setup/user';

test('configured Insights enforces privacy and displays scoped, consistent charts', async ({
  page,
}, testInfo) => {
  await withMongo(async (db) => {
    const identity = await db.collection('users').findOne({ email: getE2EUser().email });
    if (!identity) throw new Error('Disposable test user was not registered');
    await db.collection('users').updateOne({ _id: identity._id }, { $set: { role: 'ADMIN' } });
    const user = identity._id.toString();
    const createdAt = new Date(Date.now() - 3600000);
    await db.collection('agents').insertMany([
      { id: 'agent-chart-alpha', name: 'Chart Alpha', category: 'hr' },
      { id: 'agent-chart-beta', name: 'Chart Beta', category: 'HR' },
      { id: 'agent-chart-gamma', name: 'Chart Gamma', category: 'Tech' },
    ]);
    const agents = [
      'agent-chart-alpha',
      'agent-chart-alpha',
      'agent-chart-beta',
      'agent-chart-gamma',
    ];
    await db.collection('conversations').insertMany(
      agents.map((agent, index) => ({
        conversationId: `insights-chart-${index}`,
        agent_id: agent,
        initial_agent_id: agent,
        user,
        endpoint: 'agents',
        createdAt,
        updatedAt: createdAt,
        isTemporary: false,
      })),
    );
    await db.collection('messages').insertMany(
      agents.flatMap((agent, index) => [
        {
          messageId: `insights-user-${index}`,
          conversationId: `insights-chart-${index}`,
          user,
          isCreatedByUser: true,
          createdAt,
          isTemporary: false,
          text: 'PRIVATE_INSIGHTS_PREVIEW',
          tokenCount: 10,
        },
        {
          messageId: `insights-answer-${index}`,
          conversationId: `insights-chart-${index}`,
          user,
          isCreatedByUser: false,
          createdAt,
          isTemporary: false,
          model: agent,
          text: 'Synthetic answer',
          tokenCount: 20,
        },
      ]),
    );
  });
  const loaded = page.waitForResponse(
    (response) => response.url().includes('/api/insights?') && response.status() === 200,
  );
  await page.goto('/insights');
  const result: TInsightsResponse = await (await loaded).json();
  expect(result.summary.totalConversations).toBe(4);
  expect((result.breakdowns?.agents ?? []).reduce((sum, row) => sum + row.conversations, 0)).toBe(
    4,
  );
  expect(result.breakdowns?.categories).toEqual([
    { id: 'HR', label: 'HR', conversations: 3 },
    { id: 'Tech', label: 'Tech', conversations: 1 },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INSIGHTS_PREVIEW');
  for (const conversation of result.latest.conversations) {
    expect(conversation).not.toHaveProperty('firstMessage');
  }
  await expect(page.getByRole('heading', { name: 'Daily usage', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'First message', exact: true })).toHaveCount(
    0,
  );
  const agentChart = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Usage by agent', exact: true }) });
  await agentChart.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(agentChart.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await agentChart.getByRole('button', { name: 'Pie', exact: true }).click();
  await page.getByRole('main').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('insights-desktop.png'), fullPage: true });
  await page.getByText('All categories', { exact: true }).click();
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes('/api/insights?') &&
      response.url().includes('categories=HR') &&
      response.status() === 200,
  );
  await page.getByRole('option', { name: 'HR', exact: true }).click();
  expect((await (await filtered).json()).summary.totalConversations).toBe(3);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox').filter({ hasText: 'HR' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Usage by category', exact: true })).toBeVisible();
  await page.getByRole('main').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('insights-mobile.png'), fullPage: true });
  await agentChart.screenshot({ path: testInfo.outputPath('insights-mobile-agent-chart.png') });
});
