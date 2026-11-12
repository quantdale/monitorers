/** Artifact IO has a separate budget from process/context teardown.
 * Large complete traces must be retained, but a wedged exporter still fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockHarnessDriver } from './MockHarnessDriver';

function traceDriver(stop: (options: { path?: string }) => Promise<void>) {
  const driver = new MockHarnessDriver();
  // Prime only the post-launch resource under test; no browser or OS IO.
  (driver as unknown as { context: { tracing: { stop: typeof stop } } }).context = { tracing: { stop } };
  return driver;
}

describe('mock trace export lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('retains a complete export taking longer than context shutdown permits', async () => {
    const stop = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 16_000)));
    const driver = traceDriver(stop);
    const result = driver.stopTrace('complete-trace.zip').then(() => 'complete', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await result).toBe('complete');
    expect(stop).toHaveBeenCalledExactlyOnceWith({ path: 'complete-trace.zip' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still rejects a wedged exporter at the separate bounded IO deadline', async () => {
    const driver = traceDriver(() => new Promise<void>(() => {}));
    const result = driver.stopTrace('trace.zip').then(() => 'complete', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe('tracing.stop timed out after 60000ms');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not suppress export errors', async () => {
    const driver = traceDriver(async () => { throw new Error('disk full'); });
    await expect(driver.stopTrace('trace.zip')).rejects.toThrow('disk full');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not extend the independent context shutdown deadline', async () => {
    const driver = new MockHarnessDriver();
    (driver as unknown as { context: { close: () => Promise<void> } }).context = {
      close: () => new Promise<void>(() => {}),
    };
    const result = expect(driver.close()).rejects.toThrow('context.close timed out after 15000ms');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(driver.page).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is harmless before launch', async () => {
    await expect(new MockHarnessDriver().stopTrace('trace.zip')).resolves.toBeUndefined();
  });
});
