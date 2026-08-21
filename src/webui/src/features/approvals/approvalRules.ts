import type { ApprovalResponse } from '../../api/types.generated';
import type { AppRole } from '../../shell/navigation';

/**
 * Why the approve control is unavailable, or that it is available.
 *
 * A separate, pure function rather than logic inline in the view, because this is the rule the
 * demo is built to show and it needs to be testable without rendering anything.
 *
 * The client-side check is a *courtesy*, not the control. The approvals service refuses the same
 * cases with 409 SegregationOfDuties, 410 Expired, and 409 InvalidTransition, and it is the only
 * thing standing between a proposal and an execution. Everything here does is save an approver a
 * round trip and give the presenter something to point at. If this file were deleted, nothing
 * would become approvable that is not approvable now.
 */
export type ApprovalBlock =
  | { blocked: false }
  | { blocked: true; code: ApprovalBlockCode; reason: string };

export type ApprovalBlockCode =
  | 'MissingRole'
  | 'UnknownIdentity'
  | 'SegregationOfDuties'
  | 'Expired'
  | 'AlreadyDecided';

export interface ApprovalContext {
  roles: readonly AppRole[];
  /** The signed-in user's Entra object id, or null when it cannot be established. */
  currentUserObjectId: string | null;
  now?: Date;
}

export function evaluateApproval(approval: ApprovalResponse, context: ApprovalContext): ApprovalBlock {
  const now = context.now ?? new Date();

  if (!context.roles.includes('Approver')) {
    return {
      blocked: true,
      code: 'MissingRole',
      reason:
        'Approving requires the Approver app role. Your account does not hold it, so this ' +
        'proposal can be read but not decided.',
    };
  }

  // Null rather than a placeholder, and refused rather than approximated. An identity the UI
  // cannot establish is one segregation of duties cannot be evaluated against, and guessing here
  // would produce a screen that permits exactly the action the control exists to prevent.
  if (!context.currentUserObjectId) {
    return {
      blocked: true,
      code: 'UnknownIdentity',
      reason:
        'Your identity could not be established from the signed-in token, so this proposal ' +
        'cannot be checked against its proposer. ApprovalResponse is refused rather than assumed.',
    };
  }

  if (approval.state !== 'PendingApproval') {
    return {
      blocked: true,
      code: 'AlreadyDecided',
      reason: `This proposal is already ${approval.state.toLowerCase()}. A decision is made once.`,
    };
  }

  // Checked before expiry deliberately. When a proposer looks at their own expired proposal, the
  // sentence they need to read is the one about segregation of duties: waiting for a fresh
  // proposal would not make them eligible, and reporting only the expiry implies it would.
  if (approval.proposedByObjectId === context.currentUserObjectId) {
    return {
      blocked: true,
      code: 'SegregationOfDuties',
      reason:
        'You proposed this action. The identity that proposes cannot be the identity that ' +
        'approves, so this decision has to be made by someone else.',
    };
  }

  if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
    return {
      blocked: true,
      code: 'Expired',
      reason:
        'This proposal expired before a decision was recorded. An elapsed window is the absence ' +
        'of a decision, not a quiet approval, so it will never execute.',
    };
  }

  return { blocked: false };
}

/** Milliseconds until expiry, negative once elapsed. */
export function timeToExpiry(approval: ApprovalResponse, now: Date = new Date()): number {
  return new Date(approval.expiresAt).getTime() - now.getTime();
}

export function formatExpiry(approval: ApprovalResponse, now: Date = new Date()): string {
  const ms = timeToExpiry(approval, now);

  if (ms <= 0) {
    return 'Expired';
  }

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return `Expires in ${Math.floor(ms / 1000)}s`;
  }
  if (minutes < 60) {
    return `Expires in ${minutes}m`;
  }
  return `Expires in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
