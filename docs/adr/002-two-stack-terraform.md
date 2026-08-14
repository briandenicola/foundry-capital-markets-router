# 002. Split Terraform into a platform stack and a workload stack

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

The infrastructure divides cleanly by change frequency. Networking, private endpoints, DNS zones,
the Container Apps Environment, Cosmos, AI Search, Key Vault, and AI Foundry change rarely and are
slow to apply. Container apps, identities, and role assignments change many times a day during a
three-week build.

A single stack means every service redeploy produces a plan that includes the network.

## Decision

Maintain two stacks: `infrastructure/` for the platform and `apps/` for the workloads. The `apps/`
stack consumes platform values through remote state data sources in `references.tf`.

## Consequences

### What this buys us

- A routine redeploy cannot produce a destructive plan against the network, which is the change
  most likely to cost hours we do not have before 9/10.
- The `apps/` plan and apply cycle stays fast, which matters when it runs dozens of times a day.
- The blast radius of a mistake is bounded by which stack you are in.

### What this costs us

- Two states to bootstrap, initialise, and keep aligned.
- A cross-stack contract: renaming a platform output breaks the workload stack, and the failure
  surfaces at apply time rather than at edit time.
- Ordering becomes a rule people must know. Platform applies before workloads, always.

### What we will have to revisit

If the cross-stack output contract starts churning, consider a shared module or a data-source
lookup by resource name and tag rather than by remote state.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Single stack | Every service redeploy plans the network; unacceptable risk profile against a fixed date |
| Workspaces | Solves environment separation, not change-frequency separation |
| Terragrunt | Additional tooling and learning cost for a three-week build |

## Constitution impact

Upholds the delivery constraint of a repeatable, unattended stand-up. Neutral on all seven
principles.
