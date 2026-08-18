# Cosmos DB data-plane access.
#
# Cosmos data-plane permissions are not Azure RBAC role assignments -- they are a separate SQL role
# system on the account, and a service holding "Contributor" over the resource still gets 403 on
# every read and write. That distinction is easy to miss and produces a failure that looks like a
# networking problem, so the assignments are explicit and container-scoped here.
#
# Scoped per container rather than per account. The router has no business reading surveillance
# alerts, and the segregation the demo claims should be true in the access model, not only in the
# code that chooses which container to open.

locals {
  # Which service writes which container. The lane services are listed even though they are stubs
  # until T-023 to T-025: granting access at the moment code appears is how a grant gets made in a
  # hurry and scoped to the whole account.
  cosmos_data_access = {
    "router-service"       = ["routerDecisions"]
    "approvals-service"    = ["approvals", "auditEvents"]
    "research-service"     = ["researchQueries"]
    "surveillance-service" = ["surveillanceAlerts"]
    "orderrouting-service" = ["orderProposals"]
  }

  cosmos_assignments = merge([
    for service, containers in local.cosmos_data_access : {
      for container in containers :
      "${service}-${container}" => { service = service, container = container }
    }
  ]...)
}

# The built-in Data Contributor role: read, write, and delete within its scope.
#
# T-019 replaces the auditEvents grant with a custom role carrying create and read but not replace
# or delete, because an append-only audit trail that the writing identity can amend is not
# append-only. Using the built-in role there today is a known gap, recorded on T-019 rather than
# left to be discovered.
data "azurerm_cosmosdb_sql_role_definition" "data_contributor" {
  resource_group_name = local.resource_group_name
  account_name        = data.azurerm_cosmosdb_account.this.name
  role_definition_id  = "00000000-0000-0000-0000-000000000002"
}

resource "azurerm_cosmosdb_sql_role_assignment" "service_data" {
  for_each = local.cosmos_assignments

  resource_group_name = local.resource_group_name
  account_name        = data.azurerm_cosmosdb_account.this.name
  role_definition_id  = data.azurerm_cosmosdb_sql_role_definition.data_contributor.id
  principal_id        = azurerm_user_assigned_identity.service[each.value.service].principal_id

  scope = "${data.azurerm_cosmosdb_account.this.id}/dbs/${local.cosmos_database}/colls/${each.value.container}"
}
