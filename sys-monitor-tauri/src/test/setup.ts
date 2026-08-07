// Mark the environment as a React act() environment so React Testing Library
// and other test utilities emit the act() warning instead of silently ignoring
// state updates outside act().
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
