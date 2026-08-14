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

    serving is one of:
      "serverless"      - Azure-hosted endpoint, billed per token. Requires format and
                          model_version, both of which must match what the region actually
                          offers. scripts/preflight-azure.sh verifies every entry against
                          `az cognitiveservices model list` before a single resource is created.
      "managed_compute" - dedicated accelerator capacity in the Foundry account, serving a model
                          from the Azure HuggingFace registry (PREVIEW).

    managed_compute entries additionally require accelerator, capacity, model_uri, and
    deployment_template. The template must match the accelerator class.
  EOT

  type = map(object({
    vendor               = string
    model_name           = string
    serving              = string
    cost_per_request_usd = number
    approved             = optional(bool, true)

    # serverless only
    format        = optional(string)
    model_version = optional(string)

    # managed_compute only
    accelerator         = optional(string)
    capacity            = optional(number, 1)
    model_uri           = optional(string)
    deployment_template = optional(string)
  }))

  default = {
    aoai_economy = {
      vendor               = "AzureOpenAI"
      model_name           = "gpt-5.4-mini"
      serving              = "serverless"
      cost_per_request_usd = 0.004
      format               = "OpenAI"
      model_version        = "2026-03-17"
    }
    aoai_standard = {
      vendor               = "AzureOpenAI"
      model_name           = "gpt-5.4"
      serving              = "serverless"
      cost_per_request_usd = 0.031
      format               = "OpenAI"
      model_version        = "2026-03-05"
    }
    aoai_premium = {
      vendor               = "AzureOpenAI"
      model_name           = "gpt-5.6-sol"
      serving              = "serverless"
      cost_per_request_usd = 0.180
      format               = "OpenAI"
      model_version        = "2026-07-09"
    }
    anthropic = {
      vendor               = "Anthropic"
      model_name           = "claude-sonnet-4-5"
      serving              = "serverless"
      cost_per_request_usd = 0.090
      format               = "Anthropic"
      model_version        = "20250929"
    }
    xai = {
      vendor               = "xAI"
      model_name           = "grok-4.3"
      serving              = "serverless"
      cost_per_request_usd = 0.075
      format               = "xAI"
      model_version        = "1"
    }
    openweight = {
      vendor               = "OpenWeight"
      model_name           = "nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8"
      serving              = "managed_compute"
      cost_per_request_usd = 0.002
      accelerator          = "H100_80GB"
      capacity             = 1
      model_uri            = "azureml://registries/azure-huggingface/models/nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8/versions/3"
      deployment_template  = "azureml://registries/azure-huggingface/deploymenttemplates/nvidia--nvidia-nemotron-3-nano-30b-a3b-fp8--256k-nvidia-h100/labels/latest"
    }
  }
}

variable "enable_managed_compute" {
  description = <<-EOT
    Provisions dedicated accelerator capacity in the Foundry account for open-weight models,
    via Microsoft.CognitiveServices/accounts/managedComputeDeployments.

    This is a PREVIEW capability and is slow to provision -- it is the single most likely reason
    a rebuild misses the 45-minute budget. Set it false to run the demo across the three
    serverless vendors only. See docs/adr/006-multi-vendor-model-catalog.md.
  EOT
  type        = bool
  default     = true
}

variable "model_deployment_capacity" {
  description = <<-EOT
    Capacity (TPM units) per serverless deployment.

    Sized to prove a routing decision, not to serve load. Six deployments across three vendors
    draw on the same regional quota, and quota is the scarcest thing in a demo subscription --
    raising this is the most likely way to make an apply fail with an error that reads like a
    permissions problem.
  EOT
  type        = number
  default     = 1
}
