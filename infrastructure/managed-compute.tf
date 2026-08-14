# Open-weight models on Microsoft Foundry managed compute. PREVIEW.
#
# managedComputeDeployments provisions dedicated accelerator capacity inside the Foundry account
# and serves a model pulled from the Azure HuggingFace registry. Two things are worth knowing:
#
#   1. acceleratorType is a Foundry accelerator class ("A100_80GB", "H100_80GB"), NOT a
#      Microsoft.Compute VM SKU. Capacity comes from Foundry's GlobalManagedCompute pool, so
#      subscription NC-family vCPU quota is not what governs this.
#   2. Each model needs a matching deploymentTemplate from the same registry. The template is
#      paired to the accelerator; an A100 template will not deploy onto H100 capacity.
#
# Deployments routinely take tens of minutes, hence the 60m timeouts. This does not fit the
# 45-minute rebuild budget -- provision it ahead of the demo and leave it up.
#
# See docs/adr/006-multi-vendor-model-catalog.md.

locals {
  managed_compute_models = var.enable_managed_compute ? {
    for k, v in var.model_catalog : k => v if v.serving == "managed_compute"
  } : {}

  serverless_models = {
    for k, v in var.model_catalog : k => v if v.serving == "serverless"
  }
}

resource "azapi_resource" "managed_compute" {
  for_each = local.managed_compute_models

  type      = "Microsoft.CognitiveServices/accounts/managedComputeDeployments@2026-05-15-preview"
  name      = each.value.model_name
  parent_id = azapi_resource.foundry.id

  schema_validation_enabled = false

  body = {
    sku = {
      name     = "GlobalManagedCompute"
      capacity = each.value.capacity
    }
    properties = {
      acceleratorType    = each.value.accelerator
      deploymentTemplate = each.value.deployment_template
      model              = each.value.model_uri
    }
  }

  response_export_values = ["*"]

  timeouts {
    create = "60m"
    update = "60m"
    delete = "60m"
  }

  depends_on = [azapi_resource.foundry_project]
}

output "managed_compute_deployments" {
  description = "Managed compute deployments backing open-weight models."
  value       = { for k, v in azapi_resource.managed_compute : k => v.id }
}

output "serverless_models" {
  description = "Models served by Azure-hosted serverless endpoints."
  value       = local.serverless_models
}
