# One user-assigned identity per service. No shared identity, so every role assignment is
# attributable to exactly one workload. Principle VIII.

resource "azurerm_user_assigned_identity" "service" {
  for_each = local.services

  name                = "id-${each.key}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  tags                = local.tags
}
