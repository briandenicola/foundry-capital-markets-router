output "app_name" {
  description = "Base resource name. Every platform resource name derives from this, and the\napps stack takes it as its only required input."
  value       = local.resource_name
}

output "resource_group_name" {
  description = "Platform resource group."
  value       = azurerm_resource_group.this.name
}

output "location" {
  value = azurerm_resource_group.this.location
}

output "acr_name" {
  value = azurerm_container_registry.this.name
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "container_app_environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.this.endpoint
}

output "cosmos_account_name" {
  value = azurerm_cosmosdb_account.this.name
}

output "cosmos_database_name" {
  value = azurerm_cosmosdb_sql_database.this.name
}

output "search_endpoint" {
  value = "https://${azurerm_search_service.this.name}.search.windows.net"
}

output "keyvault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "keyvault_id" {
  value = azurerm_key_vault.this.id
}

output "foundry_endpoint" {
  value = azapi_resource.foundry.output.properties.endpoint
}

output "foundry_id" {
  value = azapi_resource.foundry.id
}

output "foundry_project_id" {
  value = azapi_resource.foundry_project.id
}

output "foundry_project_endpoint" {
  description = "Project endpoint the router uses to reach hosted agents."
  value       = "https://${azapi_resource.foundry.name}.services.ai.azure.com/api/projects/${azapi_resource.foundry_project.name}"
}

output "foundry_principal_id" {
  description = "System-assigned identity of the Foundry account, for role assignments."
  value       = azapi_resource.foundry.output.identity.principalId
}

output "application_insights_connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.id
}

output "vnet_id" {
  value = var.enable_private_networking ? azurerm_virtual_network.this[0].id : null
}

output "model_catalog" {
  description = "Approved model catalog consumed by the router and the policy engine."
  value       = var.model_catalog
}

output "managed_compute_enabled" {
  value = var.enable_managed_compute
}
