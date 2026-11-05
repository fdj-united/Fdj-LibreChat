import { expect, test } from '@playwright/test';
import type { TInsightsResponse } from 'librechat-data-provider';
import { withMongo } from '../specs/mock/db';
import { getE2EUser } from '../setup/user';

test('owner dashboard enforces privacy and displays compact scoped engagement', async ({
  page,
}, testInfo) => {
  const counts = [1, 1, 1, 2, 3, 5, 6, 7, 9, 11, 13, 16, 21, 23, 25];
  const total = counts.reduce((sum, value) => sum + value, 0);
  await withMongo(async (db) => {
    const identity = await db.collection('users').findOne({ email: getE2EUser().email });
    if (!identity) throw new Error('Disposable test user was not registered');
    await db.collection('users').updateOne({ _id: identity._id }, { $set: { role: 'ADMIN' } });
    await db.collection('agents').insertMany([
      { id: 'agent-chart-alpha', name: 'People Assistant', category: 'hr' },
      { id: 'agent-chart-beta', name: 'Policy Assistant', category: 'HR' },
      { id: 'agent-chart-gamma', name: 'Technical Assistant', category: 'Tech' },
    ]);
    const inserted = await db.collection('users').insertMany(
      counts.map((_, index) => ({
        name: `Example user ${index + 1}`,
        email: `example${index + 1}@example.test`,
        role: 'USER',
      })),
    );
    const conversations = [];
    const messages = [];
    let chat = 0;
    for (const [index, count] of counts.entries()) {
      const user = inserted.insertedIds[index].toString();
      for (let i = 0; i < count; i++, chat++) {
        const createdAt = new Date(Date.now() - ((chat % 7) * 24 + 1) * 3600000);
        const conversationId = `owner-preview-${chat}`;
        const agent = ['agent-chart-alpha', 'agent-chart-beta', 'agent-chart-gamma'][chat % 3];
        conversations.push({
          conversationId,
          agent_id: agent,
          initial_agent_id: agent,
          user,
          endpoint: 'agents',
          createdAt,
          updatedAt: createdAt,
          isTemporary: false,
        });
        for (let q = 0; q < (chat % 3 === 0 ? 1 : 2); q++) {
          messages.push({
            messageId: `${conversationId}-q-${q}`,
            conversationId,
            user,
            isCreatedByUser: true,
            createdAt,
            isTemporary: false,
            text: 'PRIVATE_INSIGHTS_PREVIEW',
            tokenCount: 15,
          });
          messages.push({
            messageId: `${conversationId}-a-${q}`,
            conversationId,
            user,
            isCreatedByUser: false,
            createdAt,
            isTemporary: false,
            model: agent,
            text: 'Synthetic answer',
            tokenCount: 30,
          });
        }
      }
    }
    const historicalDate = new Date(Date.now() - 45 * 86400000);
    conversations.push({
      conversationId: 'historical-preview',
      agent_id: 'agent-chart-alpha',
      initial_agent_id: 'agent-chart-alpha',
      user: identity._id.toString(),
      endpoint: 'agents',
      createdAt: historicalDate,
      updatedAt: historicalDate,
      isTemporary: false,
    });
    messages.push({
      messageId: 'historical-question',
      conversationId: 'historical-preview',
      user: identity._id.toString(),
      isCreatedByUser: true,
      createdAt: historicalDate,
      isTemporary: false,
      text: 'PRIVATE_INSIGHTS_PREVIEW',
      tokenCount: 15,
    });
    await db.collection('conversations').insertMany(conversations);
    await db.collection('messages').insertMany(messages);
  });
  const loaded = page.waitForResponse(
    (response) => response.url().includes('/api/insights?') && response.status() === 200,
  );
  await page.setViewportSize({ width: 1440, height: 1150 });
  await page.goto('/insights');
  const response = await loaded;
  const result: TInsightsResponse = await response.json();
  expect(result.summary.totalConversations).toBe(total);
  expect(result.engagement?.activeConversations).toBe(total);
  expect(result.engagement?.activeUsers).toBe(15);
  expect(result.engagement?.activityDistribution.map((row) => row.users)).toEqual([3, 3, 3, 3, 3]);
  expect(result).not.toHaveProperty('breakdowns');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INSIGHTS_PREVIEW');
  for (const conversation of result.latest.conversations)
    expect(conversation).not.toHaveProperty('firstMessage');
  await expect(page.getByRole('heading', { name: 'Adoption', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Engagement', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Usage by agent', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Usage by category', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('columnheader', { name: 'First message', exact: true })).toHaveCount(
    0,
  );
  const daily = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Daily usage', exact: true }) });
  const dailyBox = await daily.boundingBox();
  expect(dailyBox!.width).toBeLessThan(720);
  expect((await daily.getByRole('img').boundingBox())!.height).toBeLessThan(200);
  await page.screenshot({
    path: testInfo.outputPath('owner-dashboard-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'About Single-question rate', exact: true }).click();
  await expect(page.getByText('Share of active conversations', { exact: false })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('owner-dashboard-information.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');

  await page
    .locator('header button')
    .filter({ has: page.locator('svg.lucide-calendar-days') })
    .click();
  await page
    .getByLabel('Start date', { exact: true })
    .fill(new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10));
  await page.getByLabel('End date', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  const historical = page.waitForResponse(
    (r) => r.url().includes('range=custom') && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await (await historical).json()).summary.totalConversations).toBe(total + 1);
  await testInfo.attach('api-timing-context.json', {
    body: JSON.stringify({
      fixtureConversations: total + 1,
      sevenDayRequestMs: response.request().timing().responseEnd,
      note: 'Small synthetic local fixture; not a shared DEV performance benchmark.',
    }),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: testInfo.outputPath('owner-dashboard-custom-range.png'),
    fullPage: true,
    animations: 'disabled',
  });

  const refresh = page.waitForResponse(
    (r) => r.url().includes('/api/insights?') && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await refresh;
  const today = page.waitForResponse((r) => r.url().includes('range=today') && r.status() === 200);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  expect((await (await today).json()).daily).toHaveLength(1);
  const week = page.waitForResponse((r) => r.url().includes('range=7d') && r.status() === 200);
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await week;
  await page.getByText('All categories', { exact: true }).click();
  const filtered = page.waitForResponse(
    (r) => r.url().includes('categories=HR') && r.status() === 200,
  );
  await page.getByRole('option', { name: 'HR', exact: true }).click();
  expect((await (await filtered).json()).engagement.activeConversations).toBeLessThan(total);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox').filter({ hasText: 'HR' })).toBeVisible();
  await daily.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('owner-dashboard-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await daily.screenshot({ path: testInfo.outputPath('owner-dashboard-mobile-usage.png') });
});
