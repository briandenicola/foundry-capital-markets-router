# Architecture Decision Records

An ADR records a decision that is expensive to reverse, together with the context that made it
reasonable at the time.

## Rules

- One decision per record. If you are writing "and also", write a second ADR.
- Record the decision **before** the code that depends on it merges.
- Any deviation from `.specify/memory/constitution.md` requires an ADR. There is no informal path.
- Superseded records stay. Mark them Superseded and link forward. Deleting history removes the
  context that justified the original choice.

## Naming

`NNN-short-slug.md`, zero-padded, sequential. Use `0000-adr-template.md` as the starting point.

## Index

| ADR | Title | Status |
|---|---|---|
| 001 | Container Apps over AKS | Accepted |
| 002 | Two Terraform stacks | Accepted |
| 003 | Deterministic quality signal over LLM-as-judge | Accepted |
| 004 | Application Insights scoreboard with Cosmos fallback | Accepted |
| 005 | Hosted Foundry agents over prompt agents | Accepted |
| 006 | Multi-vendor model catalog, incl. open-weight on managed compute | Accepted |
| 007 | No fallback may simulate agent reasoning | Accepted |
| 008 | The approval aggregate authorises; it does not execute | Accepted |
| 009 | Route responses state whether a model ran; dataClassification is required | Accepted |
