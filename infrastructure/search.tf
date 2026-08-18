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

  #checkov:skip=CKV_AZURE_208:Requires replica_count >= 3 to qualify for the index-update SLA. This service backs a single-region demo over synthetic data (Principle VI) and makes no availability claim; three replicas would triple the cost of the most expensive resource in the platform to insure a promise nobody has made. The demo's credibility rests on governance controls, not on uptime figures.
  #checkov:skip=CKV_AZURE_209:Same reasoning as CKV_AZURE_208, for the query SLA at replica_count >= 2. Revisit if this ever carries a workload that someone depends on.

  tags = local.tags
}
