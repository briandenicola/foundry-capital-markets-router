# Foundry Capital Markets Router

A private, policy-governed AI exchange for a bank's capital markets division — demonstrated live
across research, trade surveillance, and order routing on Azure AI Foundry.

> **Models are temporary. Governance is strategic.**

Applications here do not choose models. They submit a business request — an intent, a cost ceiling,
a data classification — and the exchange decides what executes it, from a multi-vendor catalog that
governance controls. Change the policy, and the same unchanged request executes somewhere else.

## What this proves

Four objections block agentic AI adoption in capital markets. This demo removes all four:

| Objection | What is demonstrated |
|---|---|
| "We will be locked into whichever vendor we pick." | A vendor is disabled in policy, live, and an identical request from an unchanged application replans onto a different vendor. No redeploy, no prompt change. |
| "It is not private enough for us." | Every Azure data plane reachable only over private endpoints. A public-access attempt is shown failing, live. Restricted-classification data routes only to open-weight models on dedicated compute inside the VNet. |
| "The spend is unbounded and unexplainable." | Every model call routed by cost and task complexity, with a live scoreboard showing cost, latency, tier, and rationale against a premium-tier baseline. |
| "We cannot let an agent act on its own." | Every consequential action halts for human approval with a full evidence packet, enforced segregation of duties, and a reconstructable audit trail. |

## The model catalog

| Vendor | Serving | Max data classification |
|---|---|---|
| Azure OpenAI | Serverless | Confidential |
| Anthropic | Serverless | Internal |
| xAI | Serverless | Internal |
| Open-weight | Foundry managed compute (**preview**) | Restricted |

Governance owns this table, not the application. See
[ADR 006](docs/adr/006-multi-vendor-model-catalog.md) — note the preview-feature risks around GPU
quota and provisioning time before you plan a demo date.

## Architecture at a glance

```text
                      Entra ID  ·  RBAC  ·  app roles
                                  |
  webui (Vite/React) ── router-service ──> APIM AI Gateway ──> Azure AI Foundry
                             |    ^           (metering,          (hosted agents,
                             |    |            cost ceilings,      multi-vendor catalog,
                             |  PolicyGate     content safety)     managed compute)
                             |  (approved vendors, data
                             |   classification, region, cost)
                             +──> research-service      ──> Azure AI Search
                             +──> surveillance-service  ──> Cosmos DB
                             +──> orderrouting-service  ──> simulated OMS

  All of the above on Azure Container Apps inside a VNet.
  All data planes on private endpoints. Managed identity only. No secrets.
```

`router-service` is the sole path to model access. Direct model endpoint calls from any other
service are blocked at the network layer, not merely discouraged by convention.

Policy is evaluated **before** cost and complexity selection: governance decides what is
permissible, then the router decides what is appropriate among the permissible.

**Unresolved forks are tracked in [docs/decisions-needed.md](docs/decisions-needed.md).** Read it
before building on this scaffold.

## Repository layout

```text
.github/            CI quality gate, CodeQL, Copilot and spec-kit assets
.specify/           Spec-kit memory and templates; the constitution lives here
specs/              Feature specifications, contracts, data models, task plans
docs/               Architecture, threat model, ADRs, demo runbook
infrastructure/     Terraform: platform stack (network, CAE, Foundry, data planes)
apps/               Terraform: workload stack (container apps, identities, roles)
src/                C# services and the Vite UI
tests/              Unit, contract, integration, and Playwright E2E tests
tasks/              Taskfile includes
scripts/            Bootstrap, policy gates, guards
```

Terraform is split into two stacks deliberately. `infrastructure/` is the longer-lived platform;
`apps/` is reapplied frequently during development. See `docs/adr/002-two-stack-terraform.md`.

## Quick start

```bash
cp .env.example .env      # set subscription, tenant, region
task --list               # review available tasks
task cloud:up             # stand up the private Azure platform
task app:deploy           # build images and deploy the container apps
task test                 # run the full test suite
task cloud:down           # tear everything down
```

`task cloud:up` must complete unattended in under 45 minutes from zero. That is a hard
constraint, not an aspiration — see the constitution's delivery constraints.

## Non-negotiables

Read `.specify/memory/constitution.md` before contributing. Seven principles govern this
repository; three are marked NON-NEGOTIABLE and no pull request may weaken them:

1. Human-in-the-loop on every consequential action.
2. Private by construction — no public data-plane access.
3. Attribution or refusal — unattributable claims are withheld, never guessed.

## Data

Synthetic only. Every artifact is produced by a committed, seeded generator. There is no real
market data, no real counterparty, and no production extract anywhere in this repository or in
any environment it deploys.

## Demo

Delivered 2026-09-10. Build freezes 2026-09-05. See `docs/demo-runbook.md` for the narrative,
timings, and failure-recovery drills.
