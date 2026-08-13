import { useEffect, useRef } from 'react';
import type { Settings } from './useSettings';
import type { SlicedHistory } from './useMetrics';
import {
  computeDefaultCardIds,
  mergeNewCardIds,
  migrateLegacyGpuCardOrder,
} from '../cardIdentity';

/**
 * Initializes dashboard order once after both settings and the first metrics
 * payload are ready, then reconciles newly discovered hardware as metrics
 * change. Keeping this state machine in a small hook makes the delayed-
 * settings race and hot-plug behavior directly testable.
 */
export function useCardOrderInitialization(
  loaded: boolean,
  metrics: SlicedHistory | null,
  cardOrder: Settings['cardOrder'],
  save: (patch: Partial<Settings>) => Promise<void>,
): void {
  const initialized = useRef(false);

  useEffect(() => {
    if (!loaded || !metrics) return;
    const defaultIds = computeDefaultCardIds(metrics);
    if (cardOrder === null) {
      if (initialized.current) return;
      initialized.current = true;
      void save({ cardOrder: defaultIds });
      return;
    }
    initialized.current = true;
    const migrated = migrateLegacyGpuCardOrder(cardOrder, metrics.gpus);
    const migratedOrCurrent = migrated.length !== cardOrder.length || migrated.some((id, index) => id !== cardOrder[index])
      ? migrated
      : cardOrder;
    const merged = mergeNewCardIds(migratedOrCurrent, defaultIds);
    if (merged !== null) void save({ cardOrder: merged });
  }, [loaded, metrics, cardOrder, save]);
}
