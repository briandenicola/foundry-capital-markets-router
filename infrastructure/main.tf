resource "azurerm_resource_group" "this" {
  name     = "rg-${local.resource_name}"
  location = var.region
  tags     = local.tags
}
