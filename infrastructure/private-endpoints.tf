# One private endpoint per data plane. Principle II is enforced here and verified by
# scripts/policy-no-public-endpoints.sh.

locals {
  private_endpoints = var.enable_private_networking ? {
    cosmos = {
      resource_id = azurerm_cosmosdb_account.this.id
      subresource = "Sql"
      dns_zone    = "privatelink.documents.azure.com"
    }
    search = {
      resource_id = azurerm_search_service.this.id
      subresource = "searchService"
      dns_zone    = "privatelink.search.windows.net"
    }
    keyvault = {
      resource_id = azurerm_key_vault.this.id
      subresource = "vault"
      dns_zone    = "privatelink.vaultcore.azure.net"
    }
    registry = {
      resource_id = azurerm_container_registry.this.id
      subresource = "registry"
      dns_zone    = "privatelink.azurecr.io"
    }
    foundry = {
      resource_id = azapi_resource.foundry.id
      subresource = "account"
      dns_zone    = "privatelink.services.ai.azure.com"
    }
  } : {}
}

resource "azurerm_private_endpoint" "this" {
  for_each = local.private_endpoints

  name                = "${local.resource_name}-${each.key}-pe"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  subnet_id           = azurerm_subnet.private_endpoints[0].id
  tags                = local.tags

  private_service_connection {
    name                           = "${each.key}-connection"
    private_connection_resource_id = each.value.resource_id
    subresource_names              = [each.value.subresource]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "${each.key}-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.this[each.value.dns_zone].id]
  }
}
