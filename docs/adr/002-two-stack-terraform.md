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

Maintain two stacks: `infrastructure/` for the platform and `apps/` for the workloads.

Both stacks use `backend "local" {}`. There is no remote state. A storage account holding state
is one more resource to provision, one more name to configure, and a prompt at `init`, and it
buys nothing when a single operator stands the estate up and tears it down.

The `apps/` stack does not read the platform stack's state. It takes one input, `app_name`, and
derives every platform resource name from it using the same convention `infrastructure/locals.tf`
applies, then finds those resources with `data` lookups in `references.tf`. The two stacks meet in
the orchestration layer -- `terraform -chdir=./infrastructure output -raw app_name`, wired in
`tasks/Taskfile.app.yml` -- not inside Terraform.

## Consequences

### What this buys us

- A routine redeploy cannot produce a destructive plan against the network, which is the change
  most likely to cost hours we do not have before 9/10.
- The `apps/` plan and apply cycle stays fast, which matters when it runs dozens of times a day.
- The blast radius of a mistake is bounded by which stack you are in.

### What this costs us

- Two states to keep aligned, and both are local, so they live on whichever machine ran the apply.
- A cross-stack contract: the naming convention is now the contract. Changing how
  `infrastructure/locals.tf` composes a resource name breaks the workload stack, and the failure
  surfaces at plan time as a "resource not found" rather than at edit time.
- Ordering becomes a rule people must know. Platform applies before workloads, always.

### What we will have to revisit

If more than one person needs to apply against the same estate, local state becomes the
constraint and remote state has to come back. That is a team-size trigger, not a technical one.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Single stack | Every service redeploy plans the network; unacceptable risk profile against a fixed date |
| Workspaces | Solves environment separation, not change-frequency separation |
| Terragrunt | Additional tooling and learning cost for a three-week build |

## Constitution impact

Upholds the delivery constraint of a repeatable, unattended stand-up. Neutral on all seven
principles.
