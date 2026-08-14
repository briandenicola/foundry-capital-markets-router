---
updated_at: 2026-08-14T16:26:21Z
focus_area: Feature 001 router core — T-011, T-015, T-017
active_issues: []
---

# What We're Focused On

Three tasks toward the 2026-09-05 feature freeze:

- **T-011** — `router-service` skeleton: health, correlation-ID middleware, App Insights. (Rusty)
- **T-015** — `POST /v1/route` against `contracts/router-api.md`, with contract tests. Wires HTTP
  to the already-proven `RoutingPlanner.Plan()`; does not reimplement it. Persistence behind a
  port so T-014's Cosmos adapter can land later. (Rusty, tests by Basher)
- **T-017** — Approval domain model, state machine, evidence-packet hashing. Pure domain,
  independent of the HTTP work, runs in parallel. (Livingston)

Saul reviews all three and owns none.

Status: team hired 2026-08-14. No implementation started.
