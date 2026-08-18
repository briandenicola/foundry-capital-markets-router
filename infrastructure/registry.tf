resource "azurerm_container_registry" "this" {
  name                = replace("${local.resource_name}acr", "-", "")
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "Premium"
  admin_enabled       = false

  public_network_access_enabled = false
  anonymous_pull_enabled        = false

  # CKV_AZURE_237. With public access off, pulls traverse the private endpoint; dedicated data
  # endpoints give the registry's data plane its own hostnames rather than sharing a regional
  # wildcard. On a private registry that is the difference between a private-endpoint rule that
  # names this registry and one that admits every registry in the region.
  data_endpoint_enabled = true

  # CKV_AZURE_233. Premium supports it and it costs nothing extra. A registry that is unreachable
  # in a zone outage takes every Container App revision with it, because there is nothing to pull.
  zone_redundancy_enabled = true

  # CKV_AZURE_167. Every 'task app:build' pushes a SHA-tagged image and moves 'latest', orphaning
  # the previous manifest. Without this the registry accumulates untagged layers indefinitely.
  # Seven days is longer than any rollback this demo would perform.
  retention_policy_in_days = 7

  #checkov:skip=CKV_AZURE_164:Not implementable. The check wants ACR content trust, which is Docker Content Trust; Azure deprecated it on 2025-03-31 and has refused to enable it on registries that did not already have it since 2026-05-31. Setting trust_policy_enabled here would fail at apply. The successor is the Notary Project, and az acr build does not sign images under either scheme -- signing is a separate pipeline step. Tracked as a real gap on T-036a rather than papered over with a setting that cannot be applied.
  #checkov:skip=CKV_AZURE_165:Geo-replication is for multi-region deployments. This platform is single-region by design: one CAE, one Cosmos account, one Search service. Replicating the registry alone would add cost and no availability, because everything that pulls from it lives in the one region.
  #checkov:skip=CKV_AZURE_166:Quarantine holds every pushed image unpullable until an external scanner marks it verified. No such scanner is integrated, so enabling this would make every image built by 'task app:build' permanently unpullable and the environment undeployable. A control that breaks the system rather than constraining it is not a control. Belongs with image signing on T-036a.

  tags = local.tags
}
