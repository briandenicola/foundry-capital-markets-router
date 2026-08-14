# 006 — Multi-vendor model catalog, including open-weight models on managed compute

- Status: Accepted
- Date: 2025-08-29
- Deciders: SE (demo owner)

## Context

The original routing design assumed one vendor and three tiers of the same model family. Reading
`docs/requirements.md` changed this. The demo's actual argument is not "we pick a cheaper model" —
it is **"models are temporary, governance is strategic."** That argument only lands if the catalog
visibly contains models from genuinely different vendors, because interchangeability between
`gpt-5.4-mini` and `gpt-5.4` proves nothing a sceptical audience will credit.

The audience is a bank's capital markets division. Their live concern is not which model is best
this quarter; it is what happens when the best model changes, when a vendor's terms change, or
when a regulator asks why a specific vendor processed specific data. A single-vendor catalog
cannot answer any of those questions.

There is a second, sharper driver. Under a Restricted data classification, several banks will not
permit a third-party hosted API at all. If the catalog has no answer for that case, the demo dies
on the first serious question from the room.

## Decision

The approved catalog spans four vendors:

| Vendor | Serving | Role in the story |
|---|---|---|
| Azure OpenAI | Serverless | The default. Broadest classification tolerance. |
| Anthropic | Serverless | Proves cross-vendor interchange; the vendor disabled on stage. |
| xAI | Serverless | Proves the catalog is not a two-horse race. |
| Open-weight | **Managed compute (preview)** | The answer to Restricted data. |

Open-weight models are served on **Foundry managed compute** — dedicated GPU capacity inside the
project's own network boundary. This is what makes the Restricted-data path credible rather than
aspirational.

Vendor is modelled as an explicit `ModelVendor` value on every candidate, not inferred from a
deployment name. A concept the code cannot name is a concept policy cannot swap.

## Consequences

### What this buys

- The stage moment in `docs/demo-runbook.md` where a vendor is disabled by policy and the request
  replans is now a property of the system rather than a scripted illusion.
- Restricted data has a real destination, so the hardest question in the room has an answer that
  is architecture rather than roadmap.
- `PolicyGate` gains a meaningful job. With one vendor it would have been ceremony.

### What this costs

**Managed compute is a preview capability, and it is the single largest delivery risk in this
repository.** Specifically:

1. **Capacity.** Accelerator classes are finite per region and availability is not exposed by the
   CLI. The only reliable check is an actual deployment. See the verification section below.
2. **Provisioning time.** Deployment is measured in tens of minutes, not the couple of minutes a
   serverless deployment takes. This does not fit inside the 45-minute rebuild budget the rest of
   the platform stack is designed around.
3. **Cost.** Dedicated accelerator capacity bills while allocated, and unlike an AML compute
   cluster there is no scale-to-zero idle window to hide behind. A warm demo is paid time from the
   moment it is provisioned. Budget for it deliberately, and destroy it when the demo season ends.
4. **Preview API surface.** Both the project and the managed compute deployment use
   `2026-05-15-preview` with schema validation disabled. Preview API versions are withdrawn without
   ceremony. If a plan starts failing for no apparent reason, check whether the API version still
   exists before debugging anything else.

### Mitigation

`enable_managed_compute` gates the whole path. Set it to `false` and the demo still runs across
three serverless vendors, losing only the Restricted-data beat. **Provision managed compute days
ahead of the demo and leave it up.** Treat it as long-lived infrastructure, not as something the
rebuild path creates.

## How managed compute is actually provisioned

Microsoft Foundry managed compute is **not** Azure ML / AI Hub managed compute. The two are
routinely confused and the resource trees are unrelated. This ADR records the correct model,
because an earlier revision of this repository got it wrong.

| | AI Hub (wrong) | Microsoft Foundry (correct) |
|---|---|---|
| Account | `azurerm_ai_foundry` (an AML workspace) | `Microsoft.CognitiveServices/accounts`, `kind = "AIServices"`, `allowProjectManagement = true` |
| Requires storage + key vault | Yes | No |
| Compute | `azurerm_machine_learning_compute_cluster` | `Microsoft.CognitiveServices/accounts/managedComputeDeployments` |
| Capacity unit | `vm_size`, e.g. `Standard_NC24ads_A100_v4` | `acceleratorType`, e.g. `A100_80GB`, `H100_80GB` |
| Quota system | Subscription `Microsoft.Compute` NC-family vCPUs | Foundry `GlobalManagedCompute` pool |
| Model source | Your own image or registry | `azureml://registries/azure-huggingface/...` |

Three consequences follow from the right-hand column:

1. **Everything is `azapi`.** The API versions involved (`2026-05-15-preview` for projects and
   managed compute deployments) are not modelled by the azurerm provider. `schema_validation_enabled
   = false` is required on the preview resources.
2. **A model needs a matching deployment template.** `properties.model` and
   `properties.deploymentTemplate` both come from the Azure HuggingFace registry, and the template
   is paired to an accelerator class. An A100 template will not deploy onto H100 capacity.
3. **Deployments are slow.** 60-minute Terraform timeouts are set deliberately, not defensively.

The reference implementation is
`briandenicola/ai-application-architectures/infrastructure/microsoft-foundry-managed-compute`.
This repository follows it, with one deliberate divergence: the reference sets
`publicNetworkAccess = "Enabled"` and `disableLocalAuth = false`. We set the opposite, and
`scripts/policy-no-public-endpoints.sh` now greps for the camelCase azapi spelling so the
chokepoint cannot be reopened silently.

## Verification status (checked 2026-08-14, eastus2)

Model names were checked against `az cognitiveservices model list -l eastus2`:

| Catalog entry | Status |
|---|---|
| `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.6-sol` | Available |
| `claude-sonnet-4-5` | Available |
| `grok-4` | **Not available** — corrected to `grok-4.3` |

**Correction to an earlier claim in this ADR.** A previous revision reported "GPU quota in eastus2
is zero" based on `az vm list-usage`, and concluded a quota request was on the critical path. That
measurement was against the wrong quota system. `GlobalManagedCompute` capacity is allocated from
a Foundry pool, not from the subscription's `Microsoft.Compute` NC-family vCPU limits, so those
zeroes do not describe this deployment. `az cognitiveservices usage list -l eastus2` exposes
`AIServices.GlobalProvisionedManaged` but no accelerator-class counter, so **managed compute
capacity availability could not be confirmed from the CLI and remains unverified.**

Verify it the only way that is conclusive — attempt one deployment, early:

```bash
terraform -chdir=infrastructure apply -target=azapi_resource.managed_compute
```

Do this well before the demo. Capacity for a specific accelerator class in a specific region is
the kind of constraint that surfaces at apply time and nowhere else.

## Alternatives considered

- **Single vendor, three tiers.** Rejected: it cannot carry the anti-lock-in argument, which is
  the whole point.
- **Multi-vendor, serverless only.** Rejected: no credible answer for Restricted data, and that
  question will be asked.
- **Open-weight via a third-party host.** Rejected: reintroduces exactly the third-party data
  path the Restricted classification exists to prevent.
