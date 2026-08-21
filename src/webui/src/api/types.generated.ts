// GENERATED FILE -- DO NOT EDIT.
//
// Source: src/Fcmr.Router.Decisions/*.cs
// Source: src/Fcmr.Approvals.Domain/*.cs
// Source: src/Fcmr.OrderRouting.Domain/*.cs
// Source: src/Contracts/*.cs
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

export type ApprovalState =
  | 'PendingApproval'
  | 'Approved'
  | 'Rejected'
  | 'Expired';

export const ApprovalStateValues: readonly ApprovalState[] = [
  'PendingApproval',
  'Approved',
  'Rejected',
  'Expired',
] as const;

export type ApprovalRefusalKind =
  | 'SegregationOfDuties'
  | 'InvalidTransition'
  | 'Expired'
  | 'NotYetExpired'
  | 'ReasonRequired'
  | 'ApproverIdentityRequired'
  | 'ProposerIdentityRequired'
  | 'CorrelationIdRequired'
  | 'ExpiryNotInFuture'
  | 'EvidencePacketMismatch'
  | 'NotApproved'
  | 'InconsistentRecord';

export const ApprovalRefusalKindValues: readonly ApprovalRefusalKind[] = [
  'SegregationOfDuties',
  'InvalidTransition',
  'Expired',
  'NotYetExpired',
  'ReasonRequired',
  'ApproverIdentityRequired',
  'ProposerIdentityRequired',
  'CorrelationIdRequired',
  'ExpiryNotInFuture',
  'EvidencePacketMismatch',
  'NotApproved',
  'InconsistentRecord',
] as const;

export type Lane =
  | 'Research'
  | 'Surveillance'
  | 'OrderRouting';

export const LaneValues: readonly Lane[] = [
  'Research',
  'Surveillance',
  'OrderRouting',
] as const;

export type OrderSide =
  | 'Buy'
  | 'Sell';

export const OrderSideValues: readonly OrderSide[] = [
  'Buy',
  'Sell',
] as const;

export type VenueType =
  | 'Lit'
  | 'Dark';

export const VenueTypeValues: readonly VenueType[] = [
  'Lit',
  'Dark',
] as const;

export type PolicyBoundary =
  | 'VenueNotApproved'
  | 'DarkPoolMinimumSize'
  | 'ParticipationRateExceeded'
  | 'SpreadToleranceExceeded'
  | 'LimitPriceBreached'
  | 'NotionalCeilingExceeded';

export const PolicyBoundaryValues: readonly PolicyBoundary[] = [
  'VenueNotApproved',
  'DarkPoolMinimumSize',
  'ParticipationRateExceeded',
  'SpreadToleranceExceeded',
  'LimitPriceBreached',
  'NotionalCeilingExceeded',
] as const;

export type ExecutionRefusalReason =
  | 'NoAuthorization'
  | 'AuthorizationExpired'
  | 'AuthorizationForDifferentProposal'
  | 'SegregationOfDuties'
  | 'CorrelationMismatch';

export const ExecutionRefusalReasonValues: readonly ExecutionRefusalReason[] = [
  'NoAuthorization',
  'AuthorizationExpired',
  'AuthorizationForDifferentProposal',
  'SegregationOfDuties',
  'CorrelationMismatch',
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

export interface ApprovalResponse {
  id: string;
  correlationId: string;
  lane: Lane;
  state: ApprovalState;
  evidencePacketHash: string;
  proposedByObjectId: string;
  decidedByObjectId?: string | null;
  decisionReason?: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt?: string | null;
  evidencePacket?: EvidencePacket | null;
  proposedAction: ProposedAction;
  evidenceIntegrityVerified?: boolean;
}

export interface EvidencePacket {
  correlationId: string;
  lane: Lane;
  inputs?: Partial<Record<string, string>>;
  retrievedSources?: EvidenceSource[];
  routingDecision: RoutingDecisionSummary;
  proposedAction: ProposedAction;
  unattributableClaims?: string[];
}

export interface EvidenceSource {
  documentId: string;
  chunkId: string;
  excerpt: string;
  score: number;
}

export interface ProposedAction {
  kind: string;
  summary: string;
  fields?: Partial<Record<string, string>>;
}

export interface RoutingDecisionSummary {
  outcome: string;
  complexityScore: number;
  costCeilingUsd: number;
  selectedTier?: string | null;
  selectedDeployment?: string | null;
  selectedVendor?: string | null;
  policySetId?: string | null;
  policySetVersion?: number | null;
  rationale: string;
}

export interface ApprovalRefusal {
  kind: ApprovalRefusalKind;
  reason: string;
  correlationId: string;
  approvalId?: string | null;
  currentState?: ApprovalState | null;
  statusCode: number;
}

export interface RouteProposal {
  proposalId: string;
  correlationId: string;
  orderId: string;
  quantity: number;
  venueCode: string;
  cost: CostBreakdown;
  liquidityRationale: string;
  bestExecutionJustification: string;
  proposedBy: string;
  considered: VenueEvaluation[];
}

export interface VenueEvaluation {
  quote: VenueQuote;
  cost: CostBreakdown;
  breaches: PolicyBreach[];
  isEligible: boolean;
  liquidityRationale: string;
}

export interface VenueQuote {
  venueCode: string;
  type: VenueType;
  midPrice: number;
  spread: number;
  displayedLiquidity: number;
  feeBps?: number;
  isDark: boolean;
}

export interface CostBreakdown {
  participationRate: number;
  spreadCostBps: number;
  impactBps: number;
  feeBps: number;
  projectedPrice: number;
  projectedCostUsd: number;
  totalCostBps: number;
}

export interface SimulatedExecution {
  executionId: string;
  proposalId: string;
  orderId: string;
  correlationId: string;
  venueCode: string;
  quantity: number;
  price: number;
  executedAt: string;
  approvalId: string;
  executionMode: string;
}

export interface PolicyBreach {
  boundary: PolicyBoundary;
  venueCode?: string | null;
  permitted: string;
  observed: string;
  explanation: string;
}
