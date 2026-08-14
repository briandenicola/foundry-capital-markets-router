# App roles for human access. Segregation of duties is enforced by the approval API, not by the
# UI hiding a button. See docs/threat-model.md T-5.

resource "azuread_application" "webui" {
  display_name     = "Foundry Capital Markets Router"
  sign_in_audience = "AzureADMyOrg"

  app_role {
    allowed_member_types = ["User"]
    description          = "Decide on pending proposals. Cannot approve own proposals."
    display_name         = "Approver"
    enabled              = true
    id                   = "1f4e8b6a-0000-4000-8000-000000000001"
    value                = "Approver"
  }

  app_role {
    allowed_member_types = ["User", "Application"]
    description          = "Read routing decisions and the scoreboard."
    display_name         = "Router.Read"
    enabled              = true
    id                   = "1f4e8b6a-0000-4000-8000-000000000002"
    value                = "Router.Read"
  }

  app_role {
    allowed_member_types = ["Application"]
    description          = "Invoke the router. Service-to-service only."
    display_name         = "Router.Invoke"
    enabled              = true
    id                   = "1f4e8b6a-0000-4000-8000-000000000003"
    value                = "Router.Invoke"
  }
}

resource "azuread_service_principal" "webui" {
  client_id = azuread_application.webui.client_id
}
