# Contributing

## Before you write code

1. Read `.specify/memory/constitution.md`. It is the tiebreaker when a specification conflicts
   with an implementation preference.
2. Read the relevant spec under `specs/`. If the change is not covered by a spec, write or
   extend the spec first.
3. If the change is architecturally significant, or deviates from the constitution, record an
   ADR in `docs/adr/` **before** the code merges.

## Workflow

```bash
task lint          # format, analyzers, terraform fmt, policy gate
task test          # unit, contract, integration
task test:e2e      # Playwright, requires a deployed environment
```

The CI quality gate runs the same checks. Run them locally first; a red pipeline on a shared
branch costs everyone time during a compressed delivery window.

## Definition of done

A change is done when every item passes:

- Lint and typecheck clean across C#, TypeScript, and Terraform.
- Router decision logic coverage at or above 70%. This is a threshold, not a report.
- CodeQL clean of new high and critical alerts.
- gitleaks clean.
- Checkov clean of high-severity findings.
- No-public-endpoint policy job green.
- Specs and ADRs updated to match reality.

## Commit and branch conventions

- Branches: `NNN-short-slug` matching the spec directory where applicable.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- One logical change per pull request. During the 9/5 freeze, only fixes and rehearsal changes
  are accepted.

## Things that will get a pull request rejected

- Weakening a NON-NEGOTIABLE principle without an ADR and explicit sign-off.
- Introducing a secret of any kind.
- Adding a public data-plane endpoint.
- Calling a model deployment from anywhere other than `router-service`.
- Committing non-synthetic data.
- Auto-executing an action on approval timeout.
