# ADR-010: Three dependencies are held below their latest major

- Status: Accepted
- Date: 2026-08-17
- Deciders: @briandenicola

## Context

Twenty Dependabot pull requests were reviewed and merged in one pass. Seventeen were taken as
proposed. Three were not, for three unrelated reasons, and all three will be re-proposed weekly
unless the reasons are written down.

Nothing here is a general position on staying current. Everything else was upgraded, including
several majors — React 19.2, Vite 8, Vitest 4, jsdom 30, msal-browser 5, msal-react 5,
react-router 7, ESLint 10, and TypeScript 6.

## Decision

### FluentAssertions stays on 7.x

FluentAssertions 8.0 relicensed. From its own nuspec:

> This version is free for open-source projects and non-commercial use, but commercial use
> requires a paid license.

7.2.2 is the last Apache-2.0 release. This repository is commercial work, and a test-assertion
convenience is not worth a licence obligation — least of all in a demo whose subject is
governance, shown to an audience whose job is noticing exactly this.

### TypeScript stays on 6.x

TypeScript 7 is npm's `latest`. The newest `typescript-eslint` (8.67.0) still declares
`peer typescript >=4.8.4 <6.1.0`, so adopting 7 fails `npm install` outright — the lint toolchain
cannot load. This is a compatibility fact, not a preference, and it reverses the moment
typescript-eslint ships support.

Moving to 6 was not free: it introduced `TS2882` on the side-effect CSS import in `main.tsx`,
fixed by adding `vite/client` to the `types` array in `tsconfig.json`, which the explicit array
had been shadowing.

### azurerm stays on 4.x through the demo

azurerm 5.0 is a breaking change. `azurerm_private_dns_zone_virtual_network_link` replaced
`resource_group_name` + `private_dns_zone_name` with `private_dns_zone_id`, which fails
`terraform validate` on `infrastructure/network.tf`.

That break was found, fixed, and both stacks validated clean on 5.1.0 — so the objection is not
that it cannot be done. The objection is that `terraform validate` only proves the schema.
Changed defaults and behavioural differences in a major provider bump surface at `apply`, and the
first apply of this estate is the one that matters. The provider major has no bearing on what the
demo shows, so the upgrade carries risk against no benefit until the estate is standing.

## Consequences

- Three `ignore` rules in `.github/dependabot.yml`, each carrying its reason, so the weekly noise
  stops and the reason travels with the rule.
- Both `providers.tf` files state the azurerm hold at the pin, because that is where someone
  will be standing when they wonder why.
- The azurerm hold is the only one with an expiry: revisit once the estate has been applied and
  the demo has been delivered. The other two expire on external events — a licence change, and
  typescript-eslint supporting TypeScript 7.
- PRs #1, #3 (azurerm) closed unmerged. The `private_dns_zone_id` fix was **not** kept, because
  it is invalid on 4.x; it is recorded here instead and is a two-line change when wanted.
