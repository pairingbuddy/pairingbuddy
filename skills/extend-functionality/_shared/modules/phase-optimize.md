# OPTIMIZE Phase

## Status: Deferred

The OPTIMIZE phase is intentionally deferred in the current atomic architecture.

## Current Approach

Optimization is handled during the REFACTOR phase:
- Test pyramid violations are caught by `identify-test-issues`
- Performance issues are caught by `identify-test-issues`
- Both are fixed by `refactor-test` skill

## Future Enhancement

When dedicated optimization is needed:
- Create atomic optimization skills (e.g., `identify-performance-issues`, `optimize-test-execution`)
- Add OPTIMIZE phase after COVERAGE phase
- Follow same atomic pattern (analyze → transform → verify → return)

## Verification
- [ ] Optimization currently handled in REFACTOR phase
