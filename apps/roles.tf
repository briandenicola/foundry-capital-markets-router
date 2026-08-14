# Least privilege, resource-scoped. No service holds a subscription-scoped role.
# scripts/policy-no-public-endpoints.sh and CI verify the scoping rule.

data "azurerm_cosmosdb_account" "this" {
  name                = local.platform.cosmos_account_name
  resource_group_name = local.platform.resource_group_name
}

resource "azurerm_role_assignment" "acr_pull" {
  for_each = local.services

  scope                = data.azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.service[each.key].principal_id
}

data "azurerm_container_registry" "this" {
  name                = local.platform.acr_name
  resource_group_name = local.platform.resource_group_name
}

# Only the router reaches the Foundry data plane. The lane services have no such assignment,
# which is what makes the chokepoint in Principle V real rather than conventional.
resource "azurerm_role_assignment" "router_foundry" {
  scope                = local.platform.foundry_project_id
  role_definition_name = "Azure AI Developer"
  principal_id         = azurerm_user_assigned_identity.service["router-service"].principal_id
}

resource "azurerm_role_assignment" "search_reader" {
  for_each = toset(["research-service", "surveillance-service"])

  scope                = data.azurerm_search_service.this.id
  role_definition_name = "Search Index Data Reader"
  principal_id         = azurerm_user_assigned_identity.service[each.value].principal_id
}

data "azurerm_search_service" "this" {
  name                = split(".", replace(local.platform.search_endpoint, "https://", ""))[0]
  resource_group_name = local.platform.resource_group_name
}
