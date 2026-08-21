# Threat Model

## Scope and stance

This is a demonstration environment holding exclusively synthetic data. The loss of any data in it
is immaterial.

The asset actually being protected is **the credibility of the controls**. The demo's entire value
is that a compliance audience believes what they are shown. A control that is bypassable, or that
is theatre, is a total loss even though no data is at risk.

Threats are therefore ranked by damage to credibility, not by data sensitivity.

## Trust boundaries

1. **Public internet to the demo UI front door.** The only public inbound surface.
2. **UI to services.** Entra ID authenticated, app-role authorised.
3. **Lane services to router-service.** Managed identity, Router.Invoke role.
4. **Router to APIM to Foundry.** The single model chokepoint.
5. **Services to data planes.** Private endpoints only, managed identity only.
6. **Retrieved content into agent context.** Untrusted input. Never instruction.

## Threats

### T-1 — An agent takes a consequential action without human approval

**Impact: catastrophic.** This is the objection the demo exists to answer. A single instance
destroys the argument.

Mitigations:

- No execution path exists that does not pass through the approval API. Proposals are inert.
- Expiry transitions to Expired and never to Approved. Timeout is not consent.
- Every approval decision writes an audit record before returning.
- Playwright coverage asserts the negative case, not only the happy path.

Residual risk: a future lane could add an execution path that bypasses the gate. Mitigated by
CODEOWNERS review on the approval surface and by the constitution check in the plan template.

### T-2 — Prompt injection through retrieved content

**Impact: high.** A synthetic research document or e-comms record containing instructions could
attempt to induce a tool call or an unattributed claim.

Mitigations:

- Retrieved content is never granted tool-call authority.
- Detected injection attempts are logged to `auditEvents` with type InjectionDetected.
- The approval gate is the backstop: even a fully successful injection cannot execute an action.
- Attribution-or-refusal means injected assertions without a citation are withheld.

Residual risk: an injection could degrade output quality without triggering an action. Acceptable
in a demo; detection is logged and visible.

### T-3 — A public data-plane endpoint appears through drift or convenience

**Impact: catastrophic to credibility.** The private-networking claim is demonstrated live. If it
is false anywhere, the demonstration is a lie the audience may catch.

Mitigations:

- `policy-no-public-endpoints.sh` fails CI on either stack.
- `enable_private_networking` defaults to true and gates networking resources.
- Checkov runs across both stacks with high-severity findings failing the build.
- `task cloud:prove-private` performs the live denial demonstration and is rehearsed.

Residual risk: a resource type not covered by the policy script's patterns. Mitigated by keeping
the script pattern-based and reviewing it whenever a new resource type is introduced.

### T-4 — A secret enters the repository or an image

**Impact: high.** Principle VIII is a stated control; a committed secret contradicts it publicly.

Mitigations:

- gitleaks over full history and diff, zero findings required.
- Managed identity everywhere; no code path consumes a connection string.
- Terraform outputs carrying credential-shaped values are marked sensitive.
- `.env` is gitignored; `.env.example` contains no secret material.

### T-5 — Self-approval defeats segregation of duties

**Impact: high.** Segregation of duties is demonstrated live as a control.

Mitigations:

- Enforced in the approval API, returning 409 SegregationOfDuties. The UI hiding the button is not
  the control.
- Unit and E2E tests assert rejection.
- Both the proposer and decider object IDs are persisted, so the record is auditable after the
  fact.

### T-6 — A service bypasses the router and calls a model directly

**Impact: high.** Cost governance becomes reporting rather than control, and the scoreboard
becomes a sample rather than a total.

Mitigations:

- Network policy denies lane services any route to the Foundry data plane.
- APIM is the only ingress to models, and it requires the router's identity.
- Integration test asserts the direct call fails.

### T-7 — The audit trail is incomplete or mutable

**Impact: high.** AC-8 invites the audience to pick an interaction at random. A gap surfaces live.

Mitigations:

- Every step of the request lifecycle writes a record keyed by `correlationId`, including the
  refusals. A trail that records only what succeeded cannot answer what an auditor asks.
- Writes use `CreateItemAsync` rather than upsert, so a duplicate id surfaces as a 409 instead of
  silently replacing an earlier record.
- Cosmos data-plane grants are scoped to individual containers, not the account
  (`apps/cosmos-roles.tf`), and no role assignment anywhere is scoped above a single resource —
  checked on every build by `scripts/policy-least-privilege-scope.sh`.
- Reconstruction is a single query and is rehearsed against unrehearsed input.

**Open gap — the append-only claim is not yet true.** `auditEvents` is currently granted with the
built-in Cosmos Data Contributor role, which includes replace and delete. An append-only trail the
writing identity can amend is not append-only, so this control does not presently hold. **T-019**
replaces it with a custom role carrying create and read only. Recorded here rather than left for
an audience to find, because the mitigation above would otherwise read as complete.

### T-8 — Non-synthetic data enters the environment

**Impact: high.** Principle VII is absolute and is a stated condition of the demonstration.

Mitigations:

- Generators are committed and seeded; generated volume is gitignored.
- Provenance is demonstrable: any artifact can be regenerated from its seed.
- Contribution rules reject data commits.

## Out of scope

Availability and denial of service; the environment is ephemeral and rebuilt on demand. Supply
chain compromise beyond Dependabot and CodeQL coverage. Physical and datacentre security.
Regulatory certification of any kind.
