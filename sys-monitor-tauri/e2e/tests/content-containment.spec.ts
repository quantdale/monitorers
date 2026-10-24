import { test, expect } from '@playwright/test';
import type { ViewMode } from '../../src/utils';

// Mount the actual production presentation components with bounded input
// fixtures: the default sine harness has short GPU names and tiny rates, and
// jsdom cannot prove geometry. No shipped mock/API surface is added.
for (const mode of ['default', 'tile', 'list'] satisfies ViewMode[]) {
  test(`long models and high rates fit ${mode} cards`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto('/');
    await page.evaluate(async (viewMode) => {
      const reactPath = '/node_modules/.vite/deps/react.js';
      const domPath = '/node_modules/.vite/deps/react-dom_client.js';
      const cardsPath = '/src/cards/renderCardContent.tsx';
      const { default: React } = await import(/* @vite-ignore */ reactPath);
      const { default: ReactDOM } = await import(/* @vite-ignore */ domPath);
      const { renderCardContent } = await import(/* @vite-ignore */ cardsPath);
      const fixture = document.createElement('div');
      fixture.id = 'content-fixture';
      Object.assign(fixture.style, { position: 'absolute', top: '0', left: '0', zIndex: '1000', width: viewMode === 'tile' ? '300px' : '360px', background: '#0A0C10' });
      document.body.appendChild(fixture);
      const metrics = {
        timestamps: [1000, 2000], cpu: [1, 99], latestCpu: 99,
        cpu_name: 'AMD Ryzen Threadripper PRO 9995WX 96-Cores with VeryLongUnbrokenHardwareIdentifier1234567890',
        cpu_temp_c: 65, mem: [10, 20], mem_used_gb: 128, mem_total_gb: 1024,
        net_recv: [1, 999900000], net_sent: [1, 12340000],
        disks: [{ key: 'C:', values: [1, 99], read_mb_s: 123456.7, write_mb_s: 123456.7, avg_response_ms: 12345 }],
        gpus: [], collectorError: null, collectorState: null,
      };
      ReactDOM.createRoot(fixture).render(React.createElement(React.Fragment, null,
        ...['cpu', 'disk_C:', 'network'].map((id) => renderCardContent({
          id, metrics, viewMode, hasNvidiaData: false,
          diskNames: new Map([['C:', 'SamsungVeryLongUnbrokenDiskModelIdentifier12345678901234567890']]),
        })),
      ));
    }, mode);
    const fixture = page.locator('#content-fixture');
    await expect(fixture.getByTestId('metric-card-network')).toBeVisible();
    await expect.poll(() => fixture.locator('[data-testid^="metric-card-"]').evaluateAll((cards) =>
      cards.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute('data-testid')),
    )).toEqual([]);
    if (mode === 'list') {
      // A clipped inner panel can hide both the long title and live figure
      // while the outer card still reports zero overflow. Measure real text.
      const title = fixture.getByTestId('metric-title-cpu');
      const chart = fixture.getByTestId('metric-chart-cpu');
      const textRight = await title.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().right;
      });
      const chartBox = await chart.boundingBox();
      expect(textRight).toBeLessThanOrEqual(chartBox!.x);
    }
    await page.screenshot({ path: testInfo.outputPath(`long-content-${mode}.png`) });
  });
}
