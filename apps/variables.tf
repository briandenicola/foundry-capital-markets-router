variable "app_name" {
  description = "Base resource name from the infrastructure stack output app_name."
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy."
  type        = string
  default     = "latest"
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
