// GENERATED FILE -- DO NOT EDIT.
//
// Source: src/Fcmr.Router.Decisions/*.cs
// Regenerate: node scripts/generate-api-types.mjs
// CI asserts this file is in sync via: node scripts/generate-api-types.mjs --check

export type ModelTier =
  | 'Economy'
  | 'Standard'
  | 'Premium';

export const ModelTierValues: readonly ModelTier[] = [
  'Economy',
  'Standard',
  'Premium',
] as const;

export type RoutingOutcome =
  | 'Routed'
  | 'Downgraded'
  | 'Denied'
  | 'RefusedByPolicy';

export const RoutingOutcomeValues: readonly RoutingOutcome[] = [
  'Routed',
  'Downgraded',
  'Denied',
  'RefusedByPolicy',
] as const;

export type ModelVendor =
  | 'AzureOpenAI'
  | 'Anthropic'
  | 'XAI'
  | 'OpenWeight';

export const ModelVendorValues: readonly ModelVendor[] = [
  'AzureOpenAI',
  'Anthropic',
  'XAI',
  'OpenWeight',
] as const;

export type ServingMode =
  | 'Serverless'
  | 'ManagedCompute';

export const ServingModeValues: readonly ServingMode[] = [
  'Serverless',
  'ManagedCompute',
] as const;

export type DataClassification =
  | 'Public'
  | 'Internal'
  | 'Confidential'
  | 'Restricted';

export const DataClassificationValues: readonly DataClassification[] = [
  'Public',
  'Internal',
  'Confidential',
  'Restricted',
] as const;

export type PolicyExclusionKind =
  | 'VendorNotApproved'
  | 'ClassificationExceeded'
  | 'RegionNotPermitted'
  | 'PolicyCostCeiling';

export const PolicyExclusionKindValues: readonly PolicyExclusionKind[] = [
  'VendorNotApproved',
  'ClassificationExceeded',
  'RegionNotPermitted',
  'PolicyCostCeiling',
] as const;

export interface RoutingDecision {
  complexityScore: number;
  costCeilingUsd: number;
  outcome: RoutingOutcome;
  selectedTier?: ModelTier | null;
  selectedDeployment?: string | null;
  candidateTiers: TierCandidate[];
  rationale: string;
  policySetId?: string | null;
  policySetVersion?: number | null;
  dataClassification?: DataClassification | null;
  selectedVendor?: ModelVendor | null;
  policyExclusions?: PolicyExclusion[];
}

export interface TierCandidate {
  tier: ModelTier;
  deployment: string;
  projectedCostUsd: number;
  vendor?: ModelVendor;
  selected?: boolean;
  rejectedReason?: string | null;
}

export interface PolicyExclusion {
  deployment: string;
  vendor: ModelVendor;
  kind: PolicyExclusionKind;
  reason: string;
}

export interface PolicySet {
  id: string;
  businessUnit: string;
  displayName?: string;
  approvedVendors: ModelVendor[];
  maxClassification: Partial<Record<ModelVendor, DataClassification>>;
  allowedRegions?: string[];
  maxCostPerRequestUsd?: number;
  permitsRestrictedData?: boolean;
  version?: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface PolicySetFieldChange {
  field: string;
  from: string;
  to: string;
}
