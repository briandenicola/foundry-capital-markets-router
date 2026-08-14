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

1. **Quota.** GPU SKUs are quota-gated per region and the default quota is frequently zero. Verify
   before planning anything:
   ```bash
   az quota show \
     --scope /subscriptions/<sub>/providers/Microsoft.Compute/locations/eastus2 \
     --resource-name standardNCADSA100v4Family
   ```
2. **Provisioning time.** Cluster creation plus model deployment is measured in tens of minutes,
   not the couple of minutes a serverless deployment takes. This does not fit inside the
   45-minute rebuild budget the rest of the platform stack is designed around.
3. **Cost.** A100-backed capacity is expensive and bills while allocated. `scale_down_nodes_after_idle_duration`
   is set to 30 minutes and `min_node_count` to 0 to limit the damage, but a warm demo means paid
   idle time. Budget for it deliberately.
4. **Terraform coverage is unverified.** The configuration in `infrastructure/managed-compute.tf`
   uses `azurerm_machine_learning_compute_cluster` against the Foundry workspace. This has **not**
   been validated against the provider version pinned here. If it does not converge, fall back to
   `az ml` in a script and treat the cluster as out-of-band infrastructure. Do not discover this
   on demo day.

### Mitigation

`enable_managed_compute` gates the whole path. Set it to `false` and the demo still runs across
three serverless vendors, losing only the Restricted-data beat. **Provision managed compute days
ahead of the demo and leave it up.** Treat it as long-lived infrastructure, not as something the
rebuild path creates.

## Verification status (checked 2026-08-14, eastus2)

Model names in `infrastructure/variables.tf` were checked against
`az cognitiveservices model list -l eastus2`:

| Catalog entry | Status |
|---|---|
| `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.6-sol` | Available |
| `claude-sonnet-4-5` | Available |
| `grok-4` | **Not available** — corrected to `grok-4.3` |

**GPU quota in eastus2 is zero.** Confirmed by `az vm list-usage`:

| Family | Used | Limit |
|---|---|---|
| Standard NCADS_A100_v4 | 0 | **0** |
| Standard NCadsH100v5 | 0 | **0** |
| Standard NCADSA10v4 | 0 | **0** |

Managed compute therefore **cannot be provisioned today**. A quota increase must be requested and
approved before `enable_managed_compute = true` will plan successfully. Quota requests are not
instant; treat this as the critical path for the Restricted-data beat.

Until quota is granted, run with `enable_managed_compute = false`. Three serverless vendors still
demonstrate the exchange; only the Restricted-data destination is missing.

## Alternatives considered

- **Single vendor, three tiers.** Rejected: it cannot carry the anti-lock-in argument, which is
  the whole point.
- **Multi-vendor, serverless only.** Rejected: no credible answer for Restricted data, and that
  question will be asked.
- **Open-weight via a third-party host.** Rejected: reintroduces exactly the third-party data
  path the Restricted classification exists to prevent.
