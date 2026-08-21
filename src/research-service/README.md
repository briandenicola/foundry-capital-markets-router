# research-service

Retrieval-grounded synthesis with mandatory per-claim attribution.

Built by **T-022**, **T-023**, and **T-024**. See `specs/001-router-core/spec.md` AC-3.

## Status

The **decision logic is built and tested**; the service host is not.

| Piece | State |
|---|---|
| Attribution gate, refusal, coverage metric | Built — `src/Fcmr.Research.Domain`, 45 tests, 94% covered |
| Prompt-injection detection (T-024) | Built — six categories, quarantine policy |
| AI Search index and ingestion (T-022) | Not built — needs a subscription |
| Service host and HTTP surface (T-023) | Not built |
| Hosted Foundry agent (T-027d) | Not built |

The deterministic core lives in `Fcmr.Research.Domain` for the same reason
`Fcmr.Router.Decisions` does: attribution is the claim this demo cannot afford to get wrong, so the
logic deciding whether a claim is publishable must be testable with no index, no model, and no
network. It is coverage-gated at 70% alongside the router.

## The rule this service exists to enforce

Every factual claim carries a citation that resolves to a retrieved chunk. A claim that cannot be
grounded is **withheld and reported** in `unattributableClaims` — never emitted with hedging
language, never quietly dropped.

The unattributable-claims panel is a demo beat in its own right (runbook Beat 6). A system that
visibly declines to answer is more persuasive to a compliance audience than one that never
appears to fail.

## What the gate proves, and what it does not

It proves **traceability**: every published claim cites at least one chunk genuinely retrieved for
that request and not quarantined. This catches the fabricated citation, which is the dominant
grounding failure — a model asked for citations will readily invent plausible-looking identifiers.

It does **not** prove the cited chunk supports the claim. Semantic support is a judgement, not a
resolution, and no deterministic gate establishes it. A claim citing a real chunk that says
something else entirely passes.

The honest phrasing is "every claim is traceable to retrieved evidence", not "every claim is true".
Closing the gap needs claim-level entailment checking, which is a model call, therefore a routed
one, therefore not free — and it is not built.

## Prompt-injection defence (T-024)

`InjectionDetector` scans retrieved content for six categories: instruction override, role
reassignment, system-prompt spoofing, tool invocation, approval bypass, and exfiltration.

It is **not** the control that stops retrieved content from calling tools. That control is
architectural — there is no code path by which retrieved text becomes a tool invocation. Pattern
matching over adversarial text is unwinnable in general, so the structural guarantee carries the
weight and the detector supplies visibility and a second layer.

Quarantine carries a real trade-off, documented on `ResearchPolicy.QuarantineInjectedChunks`: it
lets an attacker who can write into a legitimate source *suppress* claims. The default accepts
that, because a withheld claim is visible and recoverable while a contaminated one is neither.

## Constraints

- No model client here. Model access is `router-service` only, and this service has no role
  assignment granting it the Foundry data plane.
- Retrieved content is untrusted input. It never carries tool-call authority. See threat model
  T-2.
