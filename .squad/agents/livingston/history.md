# Project Context

- **Owner:** briandenicola
- **Project:** Foundry Capital Markets Router — the "Governed AI Exchange" demo for AI decision
  makers and trade leadership in a bank's capital markets division. Central claim: applications
  never select models, and governance policy decides which vendor executes each request.
  It is a demo, but the controls are real; their credibility in front of a compliance audience is
  the entire product.
- **Role:** Approval Domain Engineer
- **Owns:** T-017 (approval domain model, state machine, evidence-packet hashing)
- **Stack:** C#, .NET 10, ASP.NET Core minimal APIs; xUnit + FluentAssertions; Vite/React/TS UI;
  Terraform (two stacks); Azure Container Apps, AI Foundry, APIM, Cosmos DB, AI Search,
  Application Insights. Taskfile.dev is the only entry point.
- **Created:** 2026-08-14T16:26:21Z

## Core Context

### Dates

Today 2026-08-14 · feature freeze 2026-09-05 · demo 2026-09-10. After 9/5 it is rehearsal and
hardening only.

### Authoritative reading order

1. `.specify/memory/constitution.md` — the tiebreaker for every decision
2. `.github/copilot-instructions.md` — hard rules and conventions
3. `specs/001-router-core/spec.md`
4. `specs/001-router-core/contracts/router-api.md` and `contracts/approval-api.md`
5. `specs/001-router-core/data-model.md`
6. `specs/001-router-core/tasks.md` — work the plan, do not freelance
7. `docs/adr/` — seven ADRs; 007 constrains design most

### Hard rules (violating one is a defect regardless of how well the code works)

1. No consequential action executes without recorded human approval. Propose, rank, draft,
   evidence — never commit. Expiry is not approval.
2. No public data-plane endpoints. `public_network_access_enabled = true` fails CI.
3. Unattributable claims are withheld and reported, never guessed.
4. All model access goes through `router-service`. No other service calls a model deployment.
5. Managed identity only — no connection strings, keys, SAS tokens, or shared secrets anywhere.
6. Synthetic data only.
7. Segregation of duties — the identity that proposes cannot be the identity that approves.
8. ADR-007 — no fallback may simulate agent reasoning. Permitted when it changes *where real
   evidence is read from*; forbidden when it changes *whether the evidence is real*. A repository
   port with an in-memory adapter is a legitimate abstraction and is encouraged; a path that
   fabricates model output is a defect. Enforced in CI by
   `scripts/policy-no-simulated-reasoning.sh`.

### State of the code at hiring time

- `src/Fcmr.Router.Decisions/` — **built and proven.** Pure, dependency-free, 93.8% line coverage,
  56 tests. Entry point `RoutingPlanner.Plan()`. T-012 and T-013 are complete. Do not reimplement
  any of it; call it.
- `src/router-service/Program.cs` — a 63-line stub. T-011 and T-015 replace it.
- `src/Fcmr.Router.Decisions/PolicySetRepository.cs` — an existing in-memory adapter showing the
  intended port shape for persistence ahead of the Cosmos adapter at T-014.
- The approval domain (T-017) does not exist yet.

### Conventions

- Central package management via `Directory.Packages.props`. Never inline a `PackageReference`
  version.
- Every request carries a `correlationId` end to end; every audit record is keyed by it.
- Router decision logic is coverage-gated at 70%.
- ADRs go in `docs/adr/NNN-slug.md`, recorded *before* the deviating code merges.
- Solution file is `Fcmr.slnx`; new projects must be added to it.
- `task lint` and `task test` are the only supported entry points.

### Environment quirk

`~/.nuget/packages` has root-owned entries, so `dotnet test` needs `NUGET_PACKAGES=/tmp/nugetprobe`
prefixed until briandenicola runs `sudo chown -R brian:brian ~/.nuget/packages`.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
