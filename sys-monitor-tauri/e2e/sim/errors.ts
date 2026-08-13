import type { FailureClass } from './types';

export type SimulationFailureCode =
  | 'assertion'
  | 'config'
  | 'cdp'
  | 'spawn'
  | 'isolation'
  | 'artifact'
  | 'cleanup'
  | 'unknown';

/** Structured failure used by drivers and the runner before regex fallback. */
export class ClassifiedSimulationError extends Error {
  readonly failureClass: Exclude<FailureClass, 'none'>;
  readonly code: SimulationFailureCode;

  constructor(
    message: string,
    failureClass: Exclude<FailureClass, 'none'>,
    code: SimulationFailureCode,
  ) {
    super(message);
    this.name = 'ClassifiedSimulationError';
    this.failureClass = failureClass;
    this.code = code;
  }
}
