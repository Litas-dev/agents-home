import { test, expect } from '@playwright/test';

test.describe('Team Health Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
  });

  test('TC01: Panel renders agent count correctly', async ({ page }) => {
    const panel = page.locator('[data-testid="team-health-panel"]');
    await expect(panel).toBeVisible();
    const count = panel.locator('[data-testid="agent-count"]');
    await expect(count).toHaveText(/\d+/);
  });

  test('TC02: Each agent shows status — idle, working, on_hold', async ({ page }) => {
    const agents = page.locator('[data-testid="agent-row"]');
    const count = await agents.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const status = agents.nth(i).locator('[data-testid="agent-status"]');
      await expect(status).toHaveText(/^(idle|working|on_hold)$/i);
    }
  });

  test('TC03: Each agent displays its current model', async ({ page }) => {
    const agents = page.locator('[data-testid="agent-row"]');
    const count = await agents.count();
    for (let i = 0; i < count; i++) {
      const model = agents.nth(i).locator('[data-testid="agent-model"]');
      await expect(model).not.toBeEmpty();
    }
  });

  test('TC04: Rate-limit warning visible when 5min 429 exists', async ({ page }) => {
    await page.route('**/api/team-health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          teamSize: 0,
          agents: [],
          statusCounts: { idle: 0, working: 0, on_hold: 0 },
          rateLimitWarning: true,
          rateLimitLastTriggered: new Date().toISOString(),
          generatedAt: new Date().toISOString(),
        }),
      });
    });
    await page.reload();
    const warning = page.locator('[data-testid="rate-limit-warning"]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/429|rate limit/i);
  });

  test('TC05: No warning when no recent 429', async ({ page }) => {
    await page.route('**/api/team-health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          teamSize: 0,
          agents: [],
          statusCounts: { idle: 0, working: 0, on_hold: 0 },
          rateLimitWarning: false,
          rateLimitLastTriggered: null,
          generatedAt: new Date().toISOString(),
        }),
      });
    });
    await page.reload();
    await expect(page.locator('[data-testid="rate-limit-warning"]')).toBeHidden();
  });

  test('TC06: Panel handles empty team gracefully', async ({ page }) => {
    await page.route('**/api/team-health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          teamSize: 0,
          agents: [],
          statusCounts: { idle: 0, working: 0, on_hold: 0 },
          rateLimitWarning: false,
          rateLimitLastTriggered: null,
          generatedAt: new Date().toISOString(),
        }),
      });
    });
    await page.reload();
    await expect(page.locator('[data-testid="agent-count"]')).toHaveText('0');
    await expect(page.locator('[data-testid="empty-team-msg"]')).toBeVisible();
  });

  test('TC07: API error shows fallback UI', async ({ page }) => {
    await page.route('**/api/team-health', async (route) => {
      await route.fulfill({ status: 500 });
    });
    await page.reload();
    await expect(page.locator('[data-testid="team-health-error"]')).toBeVisible();
  });
});
