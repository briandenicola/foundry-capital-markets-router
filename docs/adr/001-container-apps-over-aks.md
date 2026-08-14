# 001. Use Azure Container Apps rather than AKS

- **Status**: Accepted
- **Date**: 2026-08-14

## Context

The reference implementation this project draws from runs on AKS with Kustomize and Flux. That
stack is well understood here and would be a defensible default.

This project has a fixed demo date of 2026-09-10 and a build freeze on 2026-09-05. It must stand
up from zero, unattended, in under 45 minutes, repeatedly, because the environment will be torn
down and rebuilt many times during rehearsal.

The demo makes three claims: the footprint is private, the spend is governed, and the agent cannot
act alone. None of them is a claim about the orchestration layer.

## Decision

Run all workloads on Azure Container Apps within the VNet. Do not introduce Kubernetes.

## Consequences

### What this buys us

- A shorter path from zero to running: no cluster provisioning, no node pool warm-up, no GitOps
  reconciliation loop to wait on during a timed rebuild.
- Fewer moving parts to fail during a live demo, and fewer to explain when the audience asks what
  a component is for.
- VNet integration and private ingress come from the platform rather than from cluster
  configuration we would have to defend.

### What this costs us

- We lose the fine-grained scheduling, sidecar patterns, and ecosystem tooling that AKS offers.
  Nothing in this demo needs them, but a production successor might.
- We diverge from the house AKS pattern, so the deployment tasks and manifests are not reusable
  from the existing reference repository.
- Container Apps constrains networking options relative to a cluster. If a future requirement
  needs a capability only AKS provides, this is a migration rather than a tweak.

### What we will have to revisit

If this demo becomes the basis of a production build, revisit the compute choice against the
client's existing platform standard. A bank with an established AKS platform will likely want the
workload there, and that migration should be planned rather than discovered.

## Alternatives considered

| Alternative | Why not |
|---|---|
| AKS with Kustomize and Flux, as in the reference repo | Provisioning and reconciliation time jeopardise the 45-minute rebuild budget, and the cluster adds surface that serves none of the three claims |
| Azure Functions | Poor fit for long-running agent orchestration and for the streaming scoreboard |
| App Service | Weaker VNet and private-endpoint story for a multi-service topology |

## Constitution impact

Upholds Principle II by using platform-native VNet integration and private ingress. Supports the
delivery constraint of an unattended 45-minute stand-up.
