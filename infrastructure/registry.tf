resource "azurerm_container_registry" "this" {
  name                = replace("${local.resource_name}acr", "-", "")
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "Premium"
  admin_enabled       = false

  public_network_access_enabled = false
  anonymous_pull_enabled        = false

  tags = local.tags
}
