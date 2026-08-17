resource "azurerm_container_app" "service" {
  for_each = local.services

  name                         = each.key
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = local.platform.container_app_environment_id
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.service[each.key].id]
  }

  registry {
    server   = local.platform.acr_login_server
    identity = azurerm_user_assigned_identity.service[each.key].id
  }

  ingress {
    # Only the UI is externally reachable. Everything else is internal ingress.
    external_enabled = each.value.external
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 3

    container {
      name   = each.key
      image  = "${local.platform.acr_login_server}/${each.key}:${var.image_tag}"
      cpu    = each.value.cpu
      memory = each.value.memory

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.service[each.key].client_id
      }

      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = local.platform.application_insights_connection_string
      }

      env {
        name  = "COSMOS_ENDPOINT"
        value = local.platform.cosmos_endpoint
      }

      env {
        name  = "COSMOS_DATABASE"
        value = local.platform.cosmos_database_name
      }

      env {
        name  = "DEFAULT_COST_CEILING_USD"
        value = tostring(var.default_cost_ceiling_usd)
      }

      env {
        name  = "APPROVAL_EXPIRY_MINUTES"
        value = tostring(var.approval_expiry_minutes)
      }
    }
  }
}
