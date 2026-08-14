# Incremental Tasks — Feature 002

Numbered `T-2xx` to stay distinct from Feature 001's `T-0xx`.

**Slice A only for the 9/10 build.** Slice B is the Phase 2 backlog.

## Slice A — Policy engine (runs alongside Feature 001, day 7 to 17)

Sequenced to land before the UI work in Feature 001's Phase 5 needs it.

### Storage and seed

- **T-201** `policySets` Cosmos container, partitioned on `/businessUnit`, with the change-feed
  subscription wired to `auditEvents`.
- **T-202** Terraform-managed baseline policy set, seeded at deploy time. `CapitalMarkets-US` with
  all four vendors approved and the classification limits from the data model.
- [x] **T-203** Policy set repository with optimistic concurrency on `version`. A write with a stale
  `expectedVersion` fails; it does not merge.

### API

- **T-204** `GET /v1/policy-sets` and `GET /v1/policy-sets/{id}`, `Router.Read`.
- **T-205** `PATCH /v1/policy-sets/{id}`, **`Approver` only**, returning the before-and-after diff.
  Includes the 400, 409, and 422 validation cases from the contract.
- **T-206** `GET /v1/policy-sets/{id}/history` from the change feed.
- **T-207** `PolicySetChanged` audit event carrying before and after. The control's own changes
  must be auditable or the control is not one.

### Router integration

- **T-208** Extend `POST /v1/route` with `dataClassification` (**required — omission is a 400, not
  a default**) and optional `policySetId`.
- [x] **T-209** Wire `PolicyGate` into the routing path **ahead of** `TierSelector`. Assert the order
  by test; do not leave it to code reading.
- [x] **T-210** Add `RefusedByPolicy` as a 200 outcome distinct from `Denied`. Callers must not treat a
  refusal as a retryable error.
- [~] **T-211** Persist `policySetId`, `policySetVersion`, `dataClassification`, `selectedVendor`, and
  `policyExclusions` on the decision record. Version is pinned at decision time so a later edit
  cannot rewrite history.
- **T-212** Policy cache with a **5-second maximum staleness**, matching the contract. Beat 5 fails
  if this is slower; a per-request read would also work and is the safer fallback.

### Multi-vendor execution

- **T-213** Vendor-aware model invocation in the router: Azure OpenAI, Anthropic, and xAI
  serverless deployments behind one internal interface.
- **T-214** Open-weight invocation against the managed compute endpoint, gated on
  `enable_managed_compute`. Degrades to "Restricted unavailable" rather than failing the service
  when the toggle is off.

### UI

- **T-215** Policy sets screen (Feature 001 **T-042**) wired to this API: per-vendor approval
  toggles, classification limits, current version, and last-changed-by.
- **T-216** Surface `policyExclusions` in the decision detail view (T-029b), each with its reason
  rendered as prose.
- **T-217** Data classification control on the request console (T-028e), including the Restricted
  path.

### Proof

- [x] **T-218** Property test: for any policy set and any request, the selected vendor is in
  `approvedVendors` and its `maxClassification` is at least the request classification. This is the
  invariant the feature rests on — assert it exhaustively, not by example.
- [x] **T-219** Removing each vendor in turn from the four-vendor catalog yields four valid plans; an
  empty eligible set yields `RefusedByPolicy` naming every exclusion.
- **T-220** **Rehearse Beat 5 end to end and time it.** Policy change to observable behaviour
  change under 10 seconds, with byte-identical request payloads across both runs, shown in the UI.

## Slice B — Intent and decomposition (Phase 2 backlog, not in the 9/10 build)

- **T-251** Intent classification against a fixed cheap deployment declared as infrastructure and
  explicitly **not routed**. Routing the component that decides routing is circular.
- **T-252** Task decomposition producing an `executionPlans` record.
- **T-253** Per-task routing, so one request may execute across several vendors.
- **T-254** Execution plan visible in the UI before completion — the audience sees reasoning, not
  just a result.
- **T-255** `PartiallyFailed` handling: a task with no eligible model fails that task explicitly
  rather than failing the request silently.

## Dependencies on Feature 001

| This feature | Needs |
|---|---|
| T-208…T-212 | T-015 (`POST /v1/route`) |
| T-211 | T-014 (decision persistence) |
| T-215 | T-028b (role guards), T-042 (policy screen shell) |
| T-216 | T-029b (decision detail) |
| T-207 | T-019 (append-only audit events) |

Slice A cannot start before T-015 and T-019 land, which places it at Feature 001 day 7 at the
earliest. That is the real constraint on this slice, not its own size.
