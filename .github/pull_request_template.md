## What this changes

<!-- One or two sentences. What behaviour is different after this? -->

## Why

<!-- The problem, or the reason the previous approach was insufficient. -->

## Checklist

- [ ] `npm run verify` passes (format, lint, typecheck, all suites, build)
- [ ] `npm run test:e2e` passes
- [ ] New behaviour has a test that fails without this change
- [ ] Any security-relevant change has a test asserting the control
- [ ] No claim added to the README or interface that is not true
- [ ] Comments explain _why_, not what
- [ ] Commits authored with my own Git identity

## Security

<!-- Delete if not applicable. -->

- [ ] Any new retrieval path applies the access filter **in SQL**, not afterwards
- [ ] Any new input is validated before use
- [ ] No secret is logged, returned by an API, or committed

## Screenshots

<!-- For interface changes. Include mobile if layout changed. -->
