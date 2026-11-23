<!-- Title format: <type>(<module>): <summary>   e.g. feat(auth): add oauth session store -->

## What and why

<!-- What changed, and why. Not a diff recap. -->

## Module(s) touched

<!-- One module per PR where possible. If you touched a contract in transition/, say which and who consumes it. -->

## Evidence

<!-- What you ran and what it showed. Paste the result, e.g. `npm run check` output. Write "not verified" for anything you did not run. -->

## Checklist

- [ ] `npm run check` passes locally
- [ ] Only my module's folder (plus `transition/<my module>/`) changed, or the cross-module change is explained above
- [ ] Contract changes are documented in `transition/`
- [ ] No secrets, tokens, or real account data
- [ ] Linked the issue (`Closes #N` or `Refs #N`)
