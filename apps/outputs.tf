output "resource_group_name" {
  description = "Workload resource group. Container apps live here, not in the platform group."
  value       = azurerm_resource_group.this.name
}

output "webui_url" {
  description = "The single public surface."
  value       = "https://${azurerm_container_app.service["webui"].ingress[0].fqdn}"
}

output "service_identities" {
  description = "Client IDs of the per-service managed identities."
  value = {
    for k, v in azurerm_user_assigned_identity.service : k => v.client_id
  }
}

output "entra_application_id" {
  value = azuread_application.webui.client_id
}
