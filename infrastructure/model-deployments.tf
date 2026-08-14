# Serverless model deployments — the multi-vendor catalog the router actually routes to.
#
# Without these, `terraform apply` produces a Foundry account, a project, and nothing to call.
# The router would start, pass every test, and refuse every request for want of a deployment.
#
# One deployment per approved serverless catalog entry, across three vendors. That spread is the
# demo's central claim in resource form: the same request can land on OpenAI, Anthropic, or xAI,
# and only policy decides which. A single-vendor estate cannot demonstrate that, however well the
# router is written.
#
# format and model_version are not decoration. They are region-specific facts, and a wrong value
# fails the deployment rather than degrading it. scripts/preflight-azure.sh verifies every entry
# against `az cognitiveservices model list` before an apply, because discovering a bad version
# during a rebuild is expensive and discovering it during the demo is fatal.
#
# Capacity is deliberately minimal. This estate is sized to prove a routing decision, not to
# serve load, and TPM quota is the scarcest thing in a demo subscription.

resource "azapi_resource" "model_deployment" {
  for_each = {
    for k, v in local.serverless_models : k => v if v.approved
  }

  type      = "Microsoft.CognitiveServices/accounts/deployments@2025-06-01"
  name      = each.value.model_name
  parent_id = azapi_resource.foundry.id

  body = {
    sku = {
      name     = "GlobalStandard"
      capacity = var.model_deployment_capacity
    }
    properties = {
      model = {
        format  = each.value.format
        name    = each.value.model_name
        version = each.value.model_version
      }
    }
  }

  response_export_values = ["*"]

  # These create in parallel, which is usually fine and occasionally is not: concurrent creates
  # against one account contend on the same quota ledger and can fail with a conflict that reads
  # like a quota shortfall, sending you to look in the wrong place. If that happens, re-apply --
  # it is not idempotency-unsafe -- or drop parallelism rather than hunting quota.
  depends_on = [azapi_resource.foundry_project]

  lifecycle {
    precondition {
      condition     = each.value.format != null && each.value.model_version != null
      error_message = "Serverless catalog entry '${each.key}' needs format and model_version. Run scripts/preflight-azure.sh to get the values this region actually offers."
    }
  }
}

output "model_deployments" {
  description = "Serverless model deployments, by catalog key. The router resolves tiers to these names."
  value       = { for k, v in azapi_resource.model_deployment : k => v.name }
}
