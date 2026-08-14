resource "azurerm_virtual_network" "this" {
  count = var.enable_private_networking ? 1 : 0

  name                = "${local.resource_name}-vnet"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  address_space       = [local.vnet_cidr]
  tags                = local.tags
}

resource "azurerm_subnet" "container_apps" {
  count = var.enable_private_networking ? 1 : 0

  name                 = "container-apps"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [local.subnets.container_apps]

  delegation {
    name = "container-apps-environment"

    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "private_endpoints" {
  count = var.enable_private_networking ? 1 : 0

  name                 = "private-endpoints"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [local.subnets.private_endpoints]
}

resource "azurerm_private_dns_zone" "this" {
  for_each = var.enable_private_networking ? toset(local.private_dns_zones) : toset([])

  name                = each.value
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  for_each = var.enable_private_networking ? toset(local.private_dns_zones) : toset([])

  name                  = "link-${replace(each.value, ".", "-")}"
  resource_group_name   = azurerm_resource_group.this.name
  private_dns_zone_name = each.value
  virtual_network_id    = azurerm_virtual_network.this[0].id
  registration_enabled  = false
  tags                  = local.tags

  depends_on = [azurerm_private_dns_zone.this]
}
