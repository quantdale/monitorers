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
  hiddenCardIds?: Settings['hiddenCardIds'],
): void {
  const initialized = useRef(false);

  useEffect(() => {
    if (!loaded || !metrics) return;
    const defaultIds = computeDefaultCardIds(metrics);
    const patch: Partial<Settings> = {};
    if (cardOrder === null) {
      if (!initialized.current) {
        initialized.current = true;
        patch.cardOrder = defaultIds;
      }
    } else {
      initialized.current = true;
      const migrated = migrateLegacyGpuCardOrder(cardOrder, metrics.gpus);
      const changed = migrated.length !== cardOrder.length || migrated.some((id, index) => id !== cardOrder[index]);
      const merged = mergeNewCardIds(changed ? migrated : cardOrder, defaultIds);
      if (merged !== null || changed) patch.cardOrder = merged ?? migrated;
    }
    if (hiddenCardIds) {
      const migrated = migrateLegacyGpuCardOrder(hiddenCardIds, metrics.gpus);
      if (migrated.length !== hiddenCardIds.length || migrated.some((id, index) => id !== hiddenCardIds[index])) {
        patch.hiddenCardIds = migrated;
      }
    }
    if (Object.keys(patch).length > 0) void save(patch);
  }, [loaded, metrics, cardOrder, save, hiddenCardIds]);
}
