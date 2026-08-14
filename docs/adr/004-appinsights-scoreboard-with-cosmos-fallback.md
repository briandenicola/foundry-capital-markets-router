# 004. Read the scoreboard from Application Insights, with a Cosmos change-feed fallback

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

AC-5 requires cost, latency, tier, rationale, and quality to appear on the scoreboard within five
seconds of request completion.

Application Insights is the natural source: the telemetry is already emitted, the aggregation
queries are straightforward, and no additional read path is needed. The SE preference is to try it
first.

Two risks are known and unresolved. Application Insights applies sampling by default, and its
ingestion latency is not guaranteed to fit a five-second budget under load. Either would break the
demo's most important screen.

## Decision

Use Application Insights as the primary scoreboard source with sampling disabled for router and
approval telemetry. Build the Cosmos change-feed fallback behind configuration at the same time,
not later. Validate the latency assumption in T-014, before the build freeze.

Cosmos remains the system of record for decisions, approvals, and audit regardless. Sampled
telemetry cannot underwrite an audit claim.

## Consequences

### What this buys us

- The preferred path is tried first, on its merits.
- The risk is retired before the freeze rather than discovered during rehearsal.
- If the assumption fails, the response is a configuration change on the day rather than a
  redesign in the final week.

### What this costs us

- Two read paths to build and keep working, one of which may never be used.
- Disabling sampling raises telemetry volume and cost, which is acceptable for an ephemeral demo
  environment but would not be for production.

### What we will have to revisit

If T-014 shows Application Insights comfortably inside the budget, the fallback becomes dead code
after the demo. Delete it deliberately then, or promote it if the demo becomes a product.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Cosmos change feed only | Rejects the SE preference without evidence, and adds a read path before knowing one is needed |
| SignalR push from the router | More infrastructure for a problem that may not exist |
| Defer the decision | Leaves an unretired risk on the most important screen with weeks to spare; unacceptable |

## Constitution impact

Upholds Principle VI. The audit trail remains in Cosmos, which is append-only and unsampled,
independent of whichever source the scoreboard reads.
