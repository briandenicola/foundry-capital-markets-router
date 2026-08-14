# 005. Prefer hosted Foundry agents over prompt-only agents

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

Each lane needs multi-step behaviour: retrieval and synthesis for research, batch triage and
evidence assembly for surveillance, and proposal construction for order routing.

This can be built as prompt orchestration in our own services, or as hosted agents in Azure AI
Foundry with tools exposed over MCP.

The audience includes technical evaluators who will ask what is Azure and what is bespoke. Every
piece of bespoke orchestration is something we own, must explain, and must defend as production
viable.

## Decision

Implement lane behaviour as hosted Foundry agents with a Foundry Tools and MCP tool surface. A
prompt-only agent requires an ADR justifying why a hosted agent was insufficient.

## Consequences

### What this buys us

- The orchestration is a platform capability rather than our code, which is a materially stronger
  answer to "how would this look in production".
- Tool definitions live in one place and are reusable across lanes.
- Less bespoke state machinery to build inside a three-week window.

### What this costs us

- We inherit the hosted agent's execution model, including its limits on control flow and
  debugging. When it does something unexpected, our visibility is bounded by what the platform
  exposes.
- Preview SDK surface area moves. Packages are exact-pinned and upgraded by hand, and Dependabot
  is configured to leave them alone.
- Some lane logic will not fit the hosted model cleanly and will need the ADR exception path.

### What we will have to revisit

If a lane accumulates enough exceptions that most of its logic is bespoke anyway, stop pretending
and move the whole lane, with an ADR.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Prompt orchestration in our own services | More bespoke code to build, explain, and defend, in a compressed window |
| A third-party agent framework | Adds a dependency that is not part of the Azure story the demo is making |

## Constitution impact

Upholds Principle V: hosted agents still call models through the router, because the lane
services have no route to the Foundry data plane. The chokepoint is preserved.
