# Governance controls

Every principle in the constitution that can be checked mechanically is checked mechanically, on
every push and every pull request. This document lists those controls, states precisely what each
one fails on, and — for the five that encode a constitutional principle directly — records the
evidence that each was verified to **fail** and not merely to pass.

The distinction matters more than it sounds. A control that has only ever been observed passing is
indistinguishable from a control that cannot fail. Both are green. The second is worse than
nothing, because it converts an unexamined risk into a documented assurance.

## Why this is enforced rather than asserted

The demo's audience is a compliance and trade-leadership audience. Its whole claim is that agentic
AI can run inside a governed, policy-bound footprint — so the controls have to be real, and they
have to survive contact with the ordinary pressure of getting a demo working.

That pressure is specific and predictable. The quickest way to fix a 403 is to widen a role scope
one level. The quickest way to fix a connectivity problem is to flip
`public_network_access_enabled` to `true`. The quickest way to make a broken agent demo work at
09:00 on the day is to replay a recorded transcript. Each of these is a one-line change, each
looks locally reasonable, and none of them announces itself in a diff review.

So each is a build failure instead.

## The controls

Thirteen jobs run in [`quality-gate.yml`](../.github/workflows/quality-gate.yml), plus CodeQL in
[`codeql.yml`](../.github/workflows/codeql.yml). Five encode a
constitutional principle and are described individually below. The rest are conventional
engineering hygiene and are summarised at the end.

| Control | Principle | Fails on |
|---|---|---|
| [no public endpoints](#no-public-endpoints) | II — Private By Construction | Any Terraform declaring a public data-plane endpoint |
| [least-privilege scope](#least-privilege-scope) | VIII — Identity Without Secrets | Any role assignment scoped above a single resource |
| [no Development environment](#no-development-environment) | II — via the auth bypass it enables | Any deployment artefact selecting ASP.NET Core `Development` |
| [no simulated reasoning](#no-simulated-reasoning) | III — Attribution Or Refusal | Any code path able to render recorded output as live reasoning |
| [cosmos containers match](#cosmos-containers-match) | VI — Evidenced And Auditable | Emulator provisioner and Terraform disagreeing on the audit schema |

Each runs locally through `task lint`, and individually as `./scripts/policy-*.sh`.

---

### No public endpoints

**Script:** [`scripts/policy-no-public-endpoints.sh`](../scripts/policy-no-public-endpoints.sh)
**Principle II is NON-NEGOTIABLE.**

Greps both Terraform stacks for six patterns:

| Pattern | Why it is separate |
|---|---|
| `public_network_access_enabled = true` | The common `azurerm` form |
| `public_access_enabled = true` | Used by a different subset of resource types |
| `anonymous_pull_enabled = true` | Registry-specific; unauthenticated image pull |
| `network_acls { default_action = "Allow" }` | Firewall that permits by default, matched across lines |
| `publicNetworkAccess = "Enabled"` | **`azapi` camelCase** |
| `disableLocalAuth = false` | **`azapi`**; key-based auth alongside managed identity |

The last two exist because the AI Foundry account is declared through `azapi` rather than
`azurerm`, and expresses the same setting as a camelCase string inside a JSON body. Every
`azurerm`-shaped pattern misses it completely. The model chokepoint — the single most important
resource to keep private — was the one resource the original control could not see.

**Verified to fail on:**

| Injected change | Result |
|---|---|
| `azurerm_storage_account` with `public_network_access_enabled = true` | exit 1 |
| `infrastructure/ai.tf` → `publicNetworkAccess = "Enabled"` | exit 1 |
| `infrastructure/ai.tf` → `disableLocalAuth = false` | exit 1 |

---

### Least-privilege scope

**Script:** [`scripts/policy-least-privilege-scope.sh`](../scripts/policy-least-privilege-scope.sh)

Fails any `azurerm_role_assignment` whose `scope` resolves to a subscription, resource group, or
management group rather than a single named resource.

A grant that names one registry is a statement about what a service may do. The same grant at
resource-group scope silently covers every resource that group ever acquires, **including ones
that do not exist yet**. Nothing about the deployment looks different. The difference surfaces only
in an audit, which is the worst time to discover it.

The script **fails closed**: a role assignment whose scope expression it does not recognise is
treated as a failure, not a pass. Adding a new assignment therefore requires either a narrow scope
or an explicit, argued exception written into the script.

**Verified to fail on:** a role assignment scoped to `data.azurerm_resource_group.this.id` → exit 1,
naming the offending file and line.

Currently passing with all four role assignments scoped to a single resource.

---

### No Development environment

**Script:** [`scripts/policy-no-development-environment.sh`](../scripts/policy-no-development-environment.sh)

`router-service` honours `Router:Authorization:Enabled=false` only when the host reports the
ASP.NET Core `Development` environment. That single switch disables `UseAuthentication`,
`UseAuthorization`, and the `Router.Invoke` endpoint filter together. On a developer's machine that
is a legitimate convenience. Anywhere else it is a complete authentication bypass — and it is
reached by setting one environment variable.

The affordance was originally justified by analogy to `enable_private_networking`. That analogy
holds only if it is enforced the way `enable_private_networking` is enforced — by a job that fails
the build — rather than merely asserted in a code comment. This is that job.

It scans deployment artefacts only: `apps/`, `infrastructure/`, `.github/workflows/`, and container
definitions under `src/`. It deliberately does **not** scan
`src/router-service/appsettings.Development.json`, because that file is the affordance being
permitted; banning it there would ban the thing the exception exists to allow.

This is one of two controls. The other is a startup guard in `Security/RouterAuthorization.cs` that
refuses to start unauthenticated on a host that is demonstrably not a workstation. The script gives
the PR-time signal; the guard closes the portal and CLI paths that never see a PR.

**Verified to fail on:** `ASPNETCORE_ENVIRONMENT = "Development"` added to `apps/container-apps.tf`
→ exit 1.

---

### No simulated reasoning

**Script:** [`scripts/policy-no-simulated-reasoning.sh`](../scripts/policy-no-simulated-reasoning.sh)
**Rationale:** [ADR-007](adr/007-no-simulated-agent-reasoning.md)

The demo's one irreplaceable claim is live agent reasoning inside a governed environment. A
replayed transcript rendered in the product UI falsifies exactly that claim, and no on-screen label
repairs it — the screenshot circulates without the label.

ADR-007 draws the line precisely: a fallback is permitted when it changes **where real evidence is
read from**, and forbidden when it changes **whether the evidence is real**. ADR-004's telemetry
read-path fallback is therefore fine. A canned completion is not.

Two scans, over `src/router-service`, the three lane services, and `src/webui/src`:

1. **Identifiers** that denote standing in for inference — `fakeAgent`, `MockModel`,
   `replayTranscript`, `CannedResponse`, `SimulatedInference`, and about a dozen more. The word
   `fallback` alone is deliberately *not* banned; a rule that cries wolf gets disabled.
2. **`simulat*` appearing near** `agent`, `reason`, `inference`, `model`, `completion`, or
   `prompt`. The simulated OMS (T-034) is permitted and required, but it covers *market execution*
   only. This catches the exception migrating into the reasoning path.

Test projects are excluded. A unit test *must* be able to fake a model client; doing so there is
correct rather than suspect.

**Verified to fail on:**

| Injected change | Result |
|---|---|
| `// var fakeAgent = 1;` in the UI source | exit 1 |
| `// we simulate the model completion here` | exit 1 |

Note that both injected lines were **comments**, and both were caught. That is intentional: the
mechanism usually arrives as scaffolding before it arrives as behaviour.

---

### Cosmos containers match

**Script:** [`scripts/policy-cosmos-containers-match.sh`](../scripts/policy-cosmos-containers-match.sh)

`tools/Fcmr.CosmosProvision` creates containers locally because Terraform cannot reach the
emulator. That duplication is unavoidable, and duplicated truth drifts.

The specific failure it prevents: a container added to `infrastructure/cosmos.tf` and forgotten in
the provisioner would let the persistence suite pass green against a database shape **that does not
exist in Azure**. The failure would first appear on the deployed environment, during the demo,
against the audit trail — the one component whose credibility the whole exercise rests on.

Name and partition key path must match exactly. The script also fails if it extracts an empty list
from either source, because a guard that silently compares two empty lists is worthless.

**Verified to fail on:**

| Injected change | Result |
|---|---|
| `auditEvents` partition key changed to `/wrongKey` | exit 1, printing both lists |
| A container added to Terraform only | exit 1 |

Currently passing with all six containers matched.

---

## What these controls do not do

Five of the above are **grep over source text**. They are tripwires, not proofs.

They catch the mechanism being reintroduced by habit — which is the realistic failure mode, and the
one that actually happens under demo pressure. They do not stop a determined author, and they say
nothing about the state of the deployed environment, only about what the repository declares.
Someone with portal access can open a firewall without touching Terraform, and no job here will
notice.

Three further limits worth stating plainly:

- **Nothing verifies the running environment.** `task cloud:prove-private` demonstrates denial of
  public data-plane access live, and is a scripted demo beat rather than a gate.
- **`auditEvents` is not yet append-only.** The identity holds the built-in Cosmos Data Contributor
  role, which includes update and delete. T-019 replaces it with a custom role. Until then the
  append-only claim is a design intent, not an enforced control — see
  [threat model T-7](threat-model.md).
- **Container images are unsigned.** `az acr build` does not sign under either Docker Content Trust
  or the Notary Project, and DCT is being withdrawn by Azure. T-036a is open.

## The remaining jobs

Conventional engineering gates, listed for completeness:

| Job | Fails on |
|---|---|
| `secrets` | gitleaks finding a committed credential |
| `terraform` | `fmt` drift, `validate` errors, or a Checkov finding across both stacks |
| `dotnet` | Build error, `dotnet format` drift, test failure, or router decision coverage below 70% |
| `contract-conformance` | A service diverging from the published API contracts |
| `ui` | ESLint, `tsc`, or Vitest failure |
| `api-types` | The UI's generated API types drifting from the C# decision library |
| `diagrams` | A committed diagram differing from what its generator produces |
| `preview-sdk-pins` | A preview Azure AI SDK not pinned to an exact version |

Checkov currently reports **20 passed, 0 failed, 7 skipped**. Every skip carries an inline
justification naming the principle or constraint that permits it; skips are not accepted silently.

## Reproducing the negative tests

The failure evidence above was produced by injecting each violation, running the gate, asserting a
non-zero exit, and reverting. To repeat it for a single control:

```bash
# Inject a violation
printf '\nresource "azurerm_storage_account" "x" {\n  public_network_access_enabled = true\n}\n' \
  >> infrastructure/scratch.tf

./scripts/policy-no-public-endpoints.sh   # expect: FAIL, exit 1

rm infrastructure/scratch.tf
```

Two cautions learned from doing this. Revert with `git checkout -- . && git clean -fd`, because a
tamper that creates an **untracked** file survives `git checkout` and silently pollutes every
subsequent test. And confirm the injected text actually landed — a `sed` that matches nothing
produces a passing gate that looks exactly like a control that failed to fire.
