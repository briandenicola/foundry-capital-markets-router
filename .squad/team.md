# Squad Team

> foundry-capital-markets-router

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Rusty | Service & HTTP Engineer | `.squad/agents/rusty/charter.md` | 🔧 Active |
| Livingston | Approval Domain Engineer | `.squad/agents/livingston/charter.md` | 🔒 Active |
| Basher | Contract Test & Quality Gate Engineer | `.squad/agents/basher/charter.md` | 🧪 Active |
| Saul | Governance Reviewer | `.squad/agents/saul/charter.md` | 🏗️ Active |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | 🔄 Monitor |

## Task Ownership

| Task | Owner | Reviewer | Test support |
|------|-------|----------|--------------|
| T-011 — router-service skeleton, health, correlation-ID middleware, App Insights | Rusty | Saul | Basher |
| T-015 — POST /v1/route against `contracts/router-api.md`, with contract tests | Rusty | Saul | Basher |
| T-017 — Approval domain model, state machine, evidence-packet hashing | Livingston | Saul | Basher |

Saul owns none of the three by design. The reviewer gate is only worth something if the reviewer
did not write the code.

## Project Context

- **Project:** foundry-capital-markets-router — the "Governed AI Exchange" demo
- **Owner:** briandenicola
- **Audience:** AI decision makers and trade leadership in a bank's capital markets division;
  secondarily the compliance and risk stakeholder holding veto power
- **Central claim:** applications never select models, and governance policy decides which vendor
  executes each request
- **Dates:** feature freeze 2026-09-05 · demo 2026-09-10
- **Stack:** C#, .NET 10, ASP.NET Core minimal APIs; xUnit + FluentAssertions; Vite/React/TS;
  Terraform (two stacks); Azure Container Apps, AI Foundry, APIM, Cosmos DB, AI Search,
  Application Insights. Taskfile.dev is the only entry point.
- **Created:** 2026-08-14

## Standing Constraints

Every member reads `.specify/memory/constitution.md` and `.github/copilot-instructions.md` before
working. The constitution is the tiebreaker whenever a spec, a convention, or a preference points
a different way.

1. No consequential action executes without recorded human approval. Expiry is not approval.
2. No public data-plane endpoints.
3. Unattributable claims are withheld and reported, never guessed.
4. All model access goes through `router-service`.
5. Managed identity only — no connection strings, keys, SAS tokens, or shared secrets.
6. Synthetic data only.
7. Segregation of duties — proposer ≠ approver.
8. ADR-007 — no fallback may simulate agent reasoning. Permitted when it changes *where real
   evidence is read from*; forbidden when it changes *whether the evidence is real*. A repository
   port with an in-memory adapter is legitimate and encouraged; fabricated model output is a
   defect.

## Environment Notes

- `~/.nuget/packages` has root-owned entries. Prefix `dotnet test` with
  `NUGET_PACKAGES=/tmp/nugetprobe` until `sudo chown -R brian:brian ~/.nuget/packages` is run.
- Solution file is `Fcmr.slnx`; new projects must be added to it.
- Central package management via `Directory.Packages.props` — never inline a version.
