# Feature 002 — Governed AI Exchange

- Status: Draft
- Depends on: Feature 001 (router core)
- Source: `docs/requirements.md`
- Constitution: Principle IV (Applications Never Select Models) is the principle this feature exists to realise.

## Problem

Feature 001 gives us a router that picks a cheaper model when it can. That is an optimisation, and
optimisations are unremarkable to this audience.

The problem the bank actually has is different. Every application in the estate has a model name
compiled into it. When the best model changes — and it will change several times before this
system is retired — every one of those applications is a change request, a test cycle, and a
release. The model choice, which should be a governance decision revisited quarterly, has been
distributed into hundreds of codebases as an engineering decision that nobody owns.

Meanwhile the people accountable for that choice — risk, compliance, the business unit — have no
mechanism to express it. They can write a standard. They cannot enforce one.

**Feature 002 moves model selection out of applications and into governance.**

## Scope

### In scope

- A **policy engine**: approved vendor catalog, per-vendor data classification limits, region
  restrictions, cost ceilings, scoped per business unit.
- **Intent classification**: deriving what a request is trying to achieve from the request itself.
- **Task decomposition**: expanding one business request into an execution plan of several tasks.
- **Per-task routing**: each task routed independently, so a single request may execute across
  several vendors.
- **Execution plan visibility**: the plan, its per-task vendor assignments, and every policy
  exclusion with its reason, all surfaced in the UI.
- **Policy hot-swap**: changing a policy set changes subsequent execution with no redeploy.

### Out of scope

- Automatic policy authoring or policy recommendation. Policy is written by humans.
- Cross-request learning or adaptive routing. Every request is routed from first principles.
- Model fine-tuning or evaluation harnesses.
- Replacing Feature 001's cost and complexity selection. This feature runs *ahead* of it.

## Jobs To Be Done

### JTBD-1 — Submit work without naming a model

> As an application developer, I submit a business request with intent, cost ceiling, and data
> classification, so that I never have to know which models exist or which is currently preferred.

**Acceptance criteria**

- The request contract contains no model, vendor, or deployment field. A caller *cannot* express a
  preference, because a field that exists will eventually be used.
- The response reports which models executed, so the caller has transparency without control.
- Two requests with identical bodies, submitted under different policy sets, may execute on
  different vendors and both succeed.

### JTBD-2 — Govern the catalog without touching applications

> As a risk officer, I add or remove an approved vendor and see it take effect on the next request,
> so that model governance is a control I hold rather than a change request I file.

**Acceptance criteria**

- Removing a vendor from a policy set excludes it from routing within one request cycle.
- No application deployment, restart, or prompt change is required.
- The exclusion appears in the execution plan with a reason naming the policy set.
- Removing *all* eligible vendors produces an explicit refusal, never a silent fallback to an
  unapproved model. **A governance system that degrades open under pressure is not a control.**

### JTBD-3 — Keep restricted data off third-party infrastructure

> As a data protection officer, I set a maximum data classification per vendor, so that Restricted
> material can only reach models running on infrastructure we control.

**Acceptance criteria**

- Each vendor carries a maximum permitted classification in the policy set.
- A request whose classification exceeds a vendor's maximum excludes that vendor, even when the
  vendor is otherwise approved and would be the cheapest or best choice.
- Restricted requests route only to open-weight models on managed compute inside the VNet.
- The exclusion reason names the classification, not merely "policy".

### JTBD-4 — Decompose work across the vendors best suited to it

> As a research analyst, I ask one question and have its parts handled by whichever models are
> strongest at each part, so I get a better answer than any single model would produce.

**Acceptance criteria**

- One request produces an execution plan of one or more tasks, each with its own intent and
  complexity.
- Each task is routed independently through the policy gate and the router.
- The plan is visible before execution completes; the audience sees the reasoning, not just a
  result.
- Tasks with no eligible model fail that task explicitly rather than failing the whole request
  silently.

### JTBD-5 — Prove the swap on stage

> As the SE presenting this, I disable a vendor mid-demo and resubmit an identical request, so the
> audience sees replanning happen rather than being told it can happen.

**Acceptance criteria**

- Policy change to observable behaviour change takes under 10 seconds.
- The before and after execution plans can be displayed side by side.
- The request payload is byte-identical across both runs, and this is demonstrable in the UI.

## Test ideas

- Property: for any policy set and any request, the selected model's vendor is a member of
  `ApprovedVendors`. This is the invariant the whole feature rests on; assert it exhaustively.
- Property: for any request, the selected vendor's max classification is at least the request's
  classification.
- Removing each vendor in turn from a four-vendor catalog yields four different valid plans.
- Empty eligible set produces refusal, and the refusal names every exclusion reason.
- Region mismatch excludes the entire catalog and names the region.
- Snapshot the execution plan for a fixed request under two policy sets; assert they differ only
  in vendor assignment.

## Open questions

1. Where do policy sets live — Cosmos, App Configuration, or a Terraform-managed file? Cosmos
   gives the fastest hot-swap and an audit trail via change feed; Terraform gives review-gated
   change. The demo wants the former; a bank would want the latter. Possibly both, with Cosmos as
   the runtime cache.
2. Does intent classification use a model, and if so, which one routes *it*? There is an obvious
   recursion here. The pragmatic answer is a fixed cheap deployment outside the exchange, declared
   explicitly as infrastructure rather than pretending it is routed.
3. Is Feature 002 in scope for 9/10, or does the demo show the policy gate (already implemented in
   `PolicyGate`) without full task decomposition? See `docs/decisions-needed.md` item 3.
