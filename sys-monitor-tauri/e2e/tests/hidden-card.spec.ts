import { test, expect } from '@playwright/test';
import { waitForFirstMetrics, readCardIds } from './helpers';

// The Metrics dropdown (MetricCardSelector) must hide/show cards and keep the
// visible-count label accurate.
test.describe('hide/show cards', () => {
  test('hides a card via the metrics dropdown and updates the count', async ({ page }) => {
    await page.goto('/');
    await waitForFirstMetrics(page);

    const trigger = page.getByRole('button', { name: /Metrics \(\d+\/\d+\)/ });
    await expect(trigger).toBeVisible();
    const before = await readCardIds(page);

    await trigger.click();
    await expect(page.getByRole('checkbox').first()).toBeVisible();

    const countBefore = await trigger.innerText();
    expect(countBefore).toContain(`(${before.length}/${before.length})`);

    // Unchecking the first checkbox hides the first card.
    await page.getByRole('checkbox').first().click();
    await expect(trigger).toContainText(`(${before.length - 1}/${before.length})`);

    // Escape closes the dropdown.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox').first()).toBeHidden();

    const after = await readCardIds(page);
    expect(after.length).toBe(before.length - 1);
    expect(after.sort()).toEqual(before.slice(1).sort());

    // Re-checking it restores the card.
    await trigger.click();
    await page.getByRole('checkbox').first().click();
    await expect(trigger).toContainText(`(${before.length}/${before.length})`);
    const restored = await readCardIds(page);
    expect(restored.length).toBe(before.length);
  });
});
