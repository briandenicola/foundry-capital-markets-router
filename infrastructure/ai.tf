# Azure AI Foundry. Hosted agents run here; the router is the only caller.
# See ADR 005 and Principle V.

resource "azurerm_ai_foundry" "this" {
  name                = "${local.resource_name}-foundry"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  storage_account_id  = azurerm_storage_account.foundry.id
  key_vault_id        = azurerm_key_vault.this.id

  public_network_access = "Disabled"

  identity {
    type = "SystemAssigned"
  }

  dynamic "managed_network" {
    for_each = var.enable_private_networking ? [1] : []
    content {
      isolation_mode = "AllowOnlyApprovedOutbound"
    }
  }

  tags = local.tags
}

resource "azurerm_ai_foundry_project" "this" {
  name               = "${local.resource_name}-proj"
  location           = azurerm_ai_foundry.this.location
  ai_services_hub_id = azurerm_ai_foundry.this.id

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

resource "azurerm_storage_account" "foundry" {
  name                = replace("${local.resource_name}fdy", "-", "")
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location

  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = false
  shared_access_key_enabled       = false

  tags = local.tags
}
