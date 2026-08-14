# Services

| Directory | Responsibility |
|---|---|
| `Fcmr.Router.Decisions` | Pure routing decision logic. No dependencies. Coverage-gated at 70%. |
| `router-service` | The model access chokepoint. Tier selection, cost ceilings, decision recording. |
| `research-service` | Retrieval-grounded synthesis with attribution or refusal. |
| `surveillance-service` | Bulk alert triage, ranking, evidence assembly, escalation proposals. |
| `orderrouting-service` | Route proposals against the simulated OMS with best-execution boundaries. |
| `webui` | The scoreboard and approval queue. |
| `tools/SyntheticData` | Seeded generators. The only source of data in this system. |

## The one rule that matters here

Only `router-service` calls a model. The lane services have no route to the Foundry data plane,
and no role assignment granting them one. If you find yourself adding a model client to a lane
service, stop — you are about to break Principle V and the network will refuse you anyway.

## Why decision logic is its own assembly

`Fcmr.Router.Decisions` has no I/O, no SDK references, and no configuration. Complexity scoring,
tier selection, and cost ceiling enforcement are pure functions of their inputs.

That makes them exhaustively testable, which is why the 70% coverage gate is pointed at this
assembly specifically rather than at the solution as a whole. It is the logic the demo's second
claim rests on.
