resource "azurerm_search_service" "this" {
  name                = "${local.resource_name}-search"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "standard"

  public_network_access_enabled = false
  local_authentication_enabled  = false

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}
