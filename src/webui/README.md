# webui

The scoreboard and the approval queue. The single public surface in the system.

Built by **T-028** through **T-034**.

## Views

| View | Task | Demo beat |
|---|---|---|
| Live scoreboard — cost, latency, tier, rationale, quality | T-029 | 3 |
| Comparison — aggregate cost against the premium baseline | T-030 | 3, primary |
| Surveillance triage queue | T-031 | 4, primary |
| Approval queue with evidence packets | T-032 | 5 |
| Research with citations and unattributable claims | T-033 | 6, secondary |

## Two things this UI must not do

1. **Do not treat hiding a button as a control.** Segregation of duties and role gating are
   enforced by the API. The UI reflects them; it does not implement them. The demo explicitly
   shows the API refusing a call.
2. **Do not omit the simulated-OMS label.** Anywhere an execution appears, the label appears.

## Freshness budget

AC-5 requires cost, latency, tier, rationale, and quality within five seconds of request
completion. The source is Application Insights, with a Cosmos change-feed fallback selectable by
configuration. See ADR 004.
