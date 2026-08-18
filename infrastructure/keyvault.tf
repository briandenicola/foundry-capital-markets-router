data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  name                = "${local.resource_name}-kv"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true

  # CKV_AZURE_42 and CKV_AZURE_110. A vault that can be permanently deleted on a whim -- by
  # accident or by someone covering their tracks -- is not a vault a compliance audience should
  # accept. The demo argues that its controls are real; a recoverability setting turned off for
  # teardown convenience would be the first thing to contradict that.
  #
  # Consequence, accepted knowingly: 'task cloud:down' can no longer purge the vault, so a
  # soft-deleted vault survives for the retention window. Vault names carry the random suffix in
  # local.resource_name, so a rebuild never collides with one.
  purge_protection_enabled   = true
  soft_delete_retention_days = 7

  public_network_access_enabled = false

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = local.tags
}
