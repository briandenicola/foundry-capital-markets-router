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

      # Double underscore is ASP.NET Core's configuration separator, so these bind to the Cosmos
      # section the services actually read. The previous COSMOS_ENDPOINT and COSMOS_DATABASE bound
      # to nothing: the variables were present, looked correct in the portal, and the service would
      # have started with persistence silently disabled.
      env {
        name  = "Cosmos__Enabled"
        value = "true"
      }

      env {
        name  = "Cosmos__AccountEndpoint"
        value = local.platform.cosmos_endpoint
      }

      env {
        name  = "Cosmos__Database"
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
