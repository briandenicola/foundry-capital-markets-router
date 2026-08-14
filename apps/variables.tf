variable "image_tag" {
  description = "Container image tag to deploy."
  type        = string
  default     = "latest"
}

variable "tf_state_resource_group" {
  description = "Resource group holding the Terraform remote state account."
  type        = string
}

variable "tf_state_storage_account" {
  description = "Storage account holding the Terraform remote state."
  type        = string
}

variable "tf_state_container" {
  description = "Blob container holding the Terraform remote state."
  type        = string
  default     = "tfstate"
}

variable "default_cost_ceiling_usd" {
  description = "Default per-request cost ceiling enforced by the router."
  type        = number
  default     = 0.25
}

variable "approval_expiry_minutes" {
  description = "Minutes before an unapproved proposal expires. Expiry never implies approval."
  type        = number
  default     = 30
}
