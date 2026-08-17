# The workload stack owns its own resource group. Container apps and their identities are
# recreated many times a day; the platform group holds the network, the registry, and the data
# plane and should not be in the blast radius of a routine redeploy. See
# docs/adr/002-two-stack-terraform.md.
#
# Location is taken from the Container App Environment rather than a variable. The apps can only
# ever live where their environment lives, so asking for it again is a second source of truth
# that can disagree with the first.
resource "azurerm_resource_group" "this" {
  name     = local.apps_rg_name
  location = data.azurerm_container_app_environment.this.location
  tags     = local.tags
}
