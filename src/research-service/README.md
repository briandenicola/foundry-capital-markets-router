# research-service

Retrieval-grounded synthesis with mandatory per-claim attribution.

Built by **T-022**, **T-023**, and **T-024**. See `specs/001-router-core/spec.md` AC-3.

## The rule this service exists to enforce

Every factual claim carries a citation that resolves to a retrieved chunk. A claim that cannot be
grounded is **withheld and reported** in `unattributableClaims` — never emitted with hedging
language, never quietly dropped.

The unattributable-claims panel is a demo beat in its own right (runbook Beat 6). A system that
visibly declines to answer is more persuasive to a compliance audience than one that never
appears to fail.

## Constraints

- No model client here. Model access is `router-service` only, and this service has no role
  assignment granting it the Foundry data plane.
- Retrieved content is untrusted input. It never carries tool-call authority. See threat model
  T-2.
