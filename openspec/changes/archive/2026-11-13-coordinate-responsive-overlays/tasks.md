## 1. Define and reproduce

- [x] 1.1 Reproduce overlapping portaled Metrics and modal Hardware on resize; research the foreground hierarchy and lock the current design system.
- [x] 1.2 Add a red-capable resize/focus/selection regression.

## 2. Repair overlay ownership

- [x] 2.1 Suspend the Metrics portal and focus boundary synchronously while Hardware is modal; clear latent open state without stealing drawer focus.
- [x] 2.2 Verify narrow/wide/reopen/Escape/Tab cycles and preserved visibility selections; inspect the rendered result.

## 3. Qualify and deliver

- [x] 3.1 Run frontend/TS/lint/build, full E2E/mock and native qualification on the combined candidate.
- [x] 3.2 Review the diff, record results and commit/push the qualified branch.
