## 1. Presentation

- [x] 1.1 Overlay the hardware sidebar below 640px and keep the push rail at and above 640px
- [x] 1.2 Dismiss the overlay by scrim, Close, and Escape, and return focus to the toggle
- [x] 1.3 Wrap long sidebar model names inside the rail

## 2. Verification

- [x] 2.1 Unit-test the breakpoint
- [x] 2.2 E2E: 400px overlay does not shrink or overflow cards; Escape and scrim close it; 900px still pushes
- [x] 2.3 Frontend typecheck, lint, and the affected unit tests pass
