# Software Phases (logical)

## Principle

Build messy in **playground**. Keep clean in **core**. Never mix without an **extract** step.

## Phases

| Phase | Purpose |
|-------|---------|
| playground | Experiments, vibe coding, spikes — chaos allowed |
| core | Reusable working logic only — minimal abstraction |
| extract | Transient mode to promote playground signal into core |

## Materialization (extract)

Three checks before core subtask:

1. Useful again?
2. Explainable simply?
3. Works end-to-end?

## Feature flags

- `softwarePhases` — master toggle
- `phaseGitSignals` — read-only git log suggestions
- `phaseBalanceAlerts` — imbalance / extract-due reminders
