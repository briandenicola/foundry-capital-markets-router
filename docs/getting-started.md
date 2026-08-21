# Getting started

Everything in this document works **without an Azure subscription**. That is deliberate: the
subscription this demo targets has been unavailable for much of the build, and the repository was
arranged so that the work did not stop. About four fifths of it can be developed, tested, and
verified offline.

The parts that genuinely require Azure are listed at the end, along with what stays unproven until
then. Naming them is cheaper than discovering them on stage.

## Prerequisites

| Tool | Version used | Needed for |
|---|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) | 10.0.100 | Services, decision core, all .NET tests |
| [Node.js](https://nodejs.org) | 22.12.0 | UI, diagram generator |
| [Task](https://taskfile.dev) | 3.32.0 | Every command below |
| Docker | any recent | Cosmos emulator only — optional |
| [Terraform](https://terraform.io) | 1.x | `terraform fmt`/`validate` only — optional |

No Azure CLI login is required for anything on this page.

## First run

```bash
git clone https://github.com/briandenicola/foundry-capital-markets-router
cd foundry-capital-markets-router
task --list          # every task, grouped by area
task test            # 282 .NET tests across five projects, plus 21 UI tests
task lint            # all repository lint and policy checks
```

Both should be green on a clean checkout. If `task lint` fails on a clean checkout, that is a bug —
please open an issue rather than working around it.

## What each area gives you

### The decision core

`Fcmr.Router.Decisions` is a dependency-free assembly holding the policy gate and the
cost-and-complexity selection. It has no Azure dependency of any kind, by design, so it can be
exhaustively unit-tested and is coverage-gated at 70%.

```bash
task test:unit       # with coverage collection
task test:coverage   # enforce the 70% threshold
```

This is where the demo's central claim lives — that governance policy, not the application, decides
which vendor executes a request. If you want to understand the system, start here and read
[`docs/architecture.md`](architecture.md) alongside it.

### The API surface

```bash
task test:contract   # 65 tests against the published contracts
```

Contract tests run against `specs/001-router-core/contracts/` and fail when a service diverges from
what the contract promises. They pass today for endpoints that exist; two contracted endpoints
(`GET /v1/decisions/{correlationId}` and `GET /v1/scoreboard`) are **not implemented yet** and are
tracked as T-020 and T-016.

### The UI

```bash
cd src/webui
npm ci
npm run dev          # Vite dev server
npm test             # 21 Vitest tests
```

The UI's API types are generated from the C# decision library, and `task lint:api-types` fails if
they drift. Regenerate rather than hand-edit them.

Several screens are scaffolded rather than built. The
[README status table](../README.md#status--what-is-built-today) is the authority on which.

### Persistence

The Cosmos DB Linux emulator gives you the real SDK, the real wire protocol, partition-key routing,
serializer settings, and queries — with no subscription.

```bash
task cosmos:up       # start the emulator, create the fcmr database and containers
task cosmos:test     # 13 persistence tests
task cosmos:down
```

The emulator authenticates with a key and supports nothing else, so this is the **one place in the
repository where a key exists at all**. Two things keep that from undermining Principle VIII:

1. The key is generated on your machine on first run into `.local/`, which is gitignored. It is
   never a well-known constant and differs between developers, so there is nothing here anyone
   could copy out and try against something real.
2. `CosmosClientFactory` refuses the key path outside the `Development` environment and fails at
   startup if asked. The real account sets `local_authentication_enabled = false`, so a key
   presented to it is rejected regardless.

**What the emulator does not prove:** managed identity, private endpoints, and RBAC — none of which
it implements. Those stay unverified until the subscription returns.

### Infrastructure

Terraform can be formatted, validated, and security-scanned with no credentials and no state:

```bash
task lint:terraform  # fmt + validate across both stacks
checkov -d . --framework terraform
```

`terraform plan` and `apply` need a subscription. Everything up to plan does not.

### The governance gates

The five policy scripts are the most demo-relevant artefact in the repository and run instantly
offline:

```bash
task lint:policy                      # no public data-plane endpoints
task lint:least-privilege-scope       # no role assignment above a single resource
task lint:no-development-environment  # no auth-bypass environment in deployment
task lint:no-simulated-reasoning      # no path can replay recorded reasoning
task lint:cosmos-containers           # emulator and Terraform agree on the audit schema
```

[`docs/governance-controls.md`](governance-controls.md) explains what each one fails on and records
the evidence that each was verified to fail as well as pass.

### The diagrams

```bash
node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams
node scripts/diagrams/generate-diagrams.mjs --out docs/diagrams --check   # CI drift check
```

Diagrams are generated from code, not drawn. Both the `.excalidraw` source and the `.svg` render
are committed, and CI fails if either drifts from its generator. Edit
[`scripts/diagrams/diagrams.mjs`](../scripts/diagrams/diagrams.mjs) — never the output.

See [`docs/diagrams/README.md`](diagrams/README.md) for the conventions, including the 16px
legibility floor the validator enforces.

## What requires Azure

| Capability | Task | Unproven until then |
|---|---|---|
| Platform stack | `task cloud:up` | VNet, private endpoints, Foundry account |
| Workload stack | `task app:deploy` | Container Apps, image build via ACR |
| Live model routing | — | Every call through a real deployment |
| Managed identity | — | The entire identity story; the emulator uses a key |
| Private-endpoint denial | `task cloud:prove-private` | The compliance narrative beat |
| End-to-end tests | `task test:e2e` | Playwright against a deployed environment (T-035, unstarted) |
| Quota and catalog | `task cloud:preflight` | Model availability per region |

Run `task cloud:preflight` first when a subscription becomes available. It verifies the model
catalog, providers, and quota **before** creating anything, which is materially cheaper than
discovering a regional model gap after a full platform apply.

## Notes and gotchas

- **`dotnet format` must be run with no path argument.** Passing one silently changes its behaviour.
- **The solution file is `Fcmr.slnx`**, not `.sln`.
- **Package versions are central.** Add dependencies to `Directory.Packages.props`; never inline a
  `PackageReference` version. A stray `--` inside an XML comment there surfaces as confusing
  `NU1015` errors.
- **Every request carries a `correlationId`** end to end, and every audit record is keyed by it.
  Preserve it through any code you add.
- **There is no root `package.json`.** Node tooling lives in `scripts/` and `src/webui/`.

## Where to go next

| If you want to | Read |
|---|---|
| Understand the design | [architecture.md](architecture.md) |
| Understand the controls | [governance-controls.md](governance-controls.md) |
| Understand the agents | [agent-architecture.md](agent-architecture.md) |
| Know what can go wrong | [threat-model.md](threat-model.md) |
| Run the demo | [demo-runbook.md](demo-runbook.md) |
| Know why something is the way it is | [adr/](adr/) |
| Know what is actually built | [README status table](../README.md#status--what-is-built-today) |
