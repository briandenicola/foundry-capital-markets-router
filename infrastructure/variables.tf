variable "region" {
  description = "Azure region for all platform resources."
  type        = string
  default     = "eastus2"
}

variable "enable_private_networking" {
  description = <<-EOT
    Gates all private networking resources. Defaults to true.
    Setting this to false is a local development affordance only; doing so in a cloud
    environment violates Principle II of the constitution.
  EOT
  type        = bool
  default     = true
}

variable "model_catalog" {
  description = <<-EOT
    The approved model catalog. Multi-vendor by design: the exchange's central claim is that
    models are interchangeable and swappable by policy without an application change.

    serving is one of "serverless" (Azure-hosted endpoint) or "managed_compute" (dedicated GPU
    capacity provisioned in the Foundry project; PREVIEW).
  EOT

  type = map(object({
    vendor               = string
    model                = string
    serving              = string
    cost_per_request_usd = number
    approved             = optional(bool, true)
  }))

  default = {
    aoai_economy = {
      vendor               = "AzureOpenAI"
      model                = "gpt-5.4-mini"
      serving              = "serverless"
      cost_per_request_usd = 0.004
    }
    aoai_standard = {
      vendor               = "AzureOpenAI"
      model                = "gpt-5.4"
      serving              = "serverless"
      cost_per_request_usd = 0.031
    }
    aoai_premium = {
      vendor               = "AzureOpenAI"
      model                = "gpt-5.6-sol"
      serving              = "serverless"
      cost_per_request_usd = 0.180
    }
    anthropic = {
      vendor               = "Anthropic"
      model                = "claude-sonnet-4-5"
      serving              = "serverless"
      cost_per_request_usd = 0.090
    }
    xai = {
      vendor               = "xAI"
      model                = "grok-4"
      serving              = "serverless"
      cost_per_request_usd = 0.075
    }
    openweight = {
      vendor               = "OpenWeight"
      model                = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
      serving              = "managed_compute"
      cost_per_request_usd = 0.002
    }
  }
}

variable "enable_managed_compute" {
  description = <<-EOT
    Provisions dedicated GPU capacity in the Foundry project for open-weight models.

    This is a PREVIEW capability. It is subject to GPU quota, is slow to provision, and is the
    single most likely reason a rebuild misses the 45-minute budget. Provision it well before
    the demo and verify quota first. See docs/adr/006-multi-vendor-model-catalog.md.
  EOT
  type        = bool
  default     = true
}

variable "managed_compute_sku" {
  description = "VM SKU backing managed compute. Requires GPU quota in the target region."
  type        = string
  default     = "Standard_NC24ads_A100_v4"
}

variable "managed_compute_instance_count" {
  description = "Instance count for the managed compute deployment. Keep at 1 for a demo."
  type        = number
  default     = 1
}
