import { test, expect } from '@playwright/test';
import { readDashboardCardOrder, waitForFirstMetrics } from './helpers';

test('unique full LUID migration retains hidden choice and saved placement across reload', async ({ page }) => {
  const runId = 'gpu-layout-migration';
  const key = '0x00000001_0x000000CD';
  const cardId = `gpu_${key}`;
  await page.addInitScript(({ runId, key }) => {
    localStorage.setItem(`sysmon_sim_session_${runId}`, JSON.stringify({
      version: 1, disks: [], gpus: [{ key, name: 'GeForce RTX 4050', vendor: 'nvidia' }],
    }));
    const settingsKey = `sysmon_sim_settings_${runId}`;
    if (!localStorage.getItem(settingsKey)) localStorage.setItem(settingsKey, JSON.stringify({
      settingsVersion: 2, cardOrder: ['gpu_0x000000cd', 'cpu', 'memory', 'network'],
      hiddenCardIds: ['gpu_0x000000cd'], sidebarCardOrder: ['sb_gpu_0x000000cd', 'sb_cpu'],
      viewMode: 'tile', windowSecs: 300,
    }));
  }, { runId, key });
  await page.goto(`/?__sim_run=${runId}`);
  await waitForFirstMetrics(page);
  const saved = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`sysmon_sim_settings_${id}`) ?? '{}'), runId);
  await expect.poll(async () => (await saved()).cardOrder[0]).toBe(cardId);
  expect((await saved()).hiddenCardIds).toEqual([cardId]);
  await expect(page.getByTestId(`metric-card-${cardId}`)).toHaveCount(0);

  await page.getByRole('button', { name: /Metrics/ }).click();
  const gpuChoice = page.getByRole('checkbox', { name: /GeForce RTX 4050/ });
  await expect(gpuChoice).not.toBeChecked();
  await gpuChoice.check();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await readDashboardCardOrder(page))[0]).toBe(cardId);
  await expect.poll(async () => (await saved()).hiddenCardIds).toEqual([]);
  await page.reload();
  await waitForFirstMetrics(page);
  expect((await readDashboardCardOrder(page))[0]).toBe(cardId);
  await expect(page.getByRole('combobox', { name: 'History time range' })).toHaveValue('300');
  expect((await saved()).viewMode).toBe('tile');
});
