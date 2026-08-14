# Microsoft Foundry.
#
# This is a Microsoft.CognitiveServices account with kind = "AIServices" and project management
# enabled -- NOT an Azure ML / AI Hub workspace. The distinction matters: the AI Hub model
# (azurerm_ai_foundry) is a different service with a different resource tree, requires a storage
# account and key vault, and does not support managedComputeDeployments.
#
# Deployed via azapi because the required API versions are preview and are not yet modelled by the
# azurerm provider. See docs/adr/006-multi-vendor-model-catalog.md.
#
# See ADR 005 and Principle V.

resource "azapi_resource" "foundry" {
  type      = "Microsoft.CognitiveServices/accounts@2025-06-01"
  name      = "${local.resource_name}-foundry"
  parent_id = azurerm_resource_group.this.id
  location  = azurerm_resource_group.this.location
  tags      = local.tags

  body = {
    kind = "AIServices"
    sku = {
      name = "S0"
    }
    identity = {
      type = "SystemAssigned"
    }

    properties = {
      # Principle II. The reference architecture leaves this Enabled; we do not.
      # scripts/policy-no-public-endpoints.sh fails the build if this is flipped.
      publicNetworkAccess = "Disabled"

      # Entra only. No account keys anywhere in this system (Principle VIII).
      disableLocalAuth = true

      allowProjectManagement = true
      customSubDomainName    = "${local.resource_name}-foundry"
    }
  }

  response_export_values = [
    "identity.principalId",
    "properties.endpoint",
  ]
}

resource "azapi_resource" "foundry_project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2026-05-15-preview"
  name      = "${local.resource_name}-proj"
  parent_id = azapi_resource.foundry.id
  location  = azurerm_resource_group.this.location

  # Preview API; azapi has no schema for it yet.
  schema_validation_enabled = false

  body = {
    sku = {
      name = "S0"
    }
    identity = {
      type = "SystemAssigned"
    }
    properties = {
      displayName = "${local.resource_name}-proj"
      description = "Capital markets governed AI exchange"
    }
  }

  response_export_values = [
    "identity.principalId",
    "properties.internalId",
  ]
}
