# Open-weight models on Foundry managed compute. PREVIEW.
#
# This is the highest-risk resource in the platform stack. Managed compute provisions dedicated
# GPU capacity, which means it depends on regional GPU quota, takes far longer to come up than
# a serverless deployment, and is the most likely single cause of a rebuild missing the
# 45-minute budget.
#
# Check quota before you plan:
#   az quota show --scope /subscriptions/<sub>/providers/Microsoft.Compute/locations/<region> \
#     --resource-name standardNCADSA100v4Family
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

resource "azurerm_machine_learning_compute_cluster" "openweight" {
  for_each = local.managed_compute_models

  name                          = substr("mc-${each.key}", 0, 24)
  location                      = azurerm_resource_group.this.location
  machine_learning_workspace_id = azurerm_ai_foundry.this.id
  vm_priority                   = "Dedicated"
  vm_size                       = var.managed_compute_sku

  # No public IP. Managed compute joins the private subnet like everything else; Principle II
  # applies to GPU capacity exactly as it applies to a database.
  node_public_ip_enabled = false
  subnet_resource_id     = var.enable_private_networking ? azurerm_subnet.private_endpoints[0].id : null

  scale_settings {
    min_node_count                       = 0
    max_node_count                       = var.managed_compute_instance_count
    scale_down_nodes_after_idle_duration = "PT30M"
  }

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

output "managed_compute_clusters" {
  description = "Managed compute clusters backing open-weight models."
  value       = { for k, v in azurerm_machine_learning_compute_cluster.openweight : k => v.id }
}

output "serverless_models" {
  description = "Models served by Azure-hosted serverless endpoints."
  value       = local.serverless_models
}
