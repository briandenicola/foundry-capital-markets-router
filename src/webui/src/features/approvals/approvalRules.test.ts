import { describe, it, expect } from 'vitest';
import type { ApprovalResponse } from '../../api/types.generated';
import { evaluateApproval, formatExpiry, type ApprovalContext } from './approvalRules';

const PROPOSER = 'obj-proposer-1';
const APPROVER = 'obj-approver-2';
const NOW = new Date('2026-09-10T12:00:00Z');

// Object.assign rather than a spread: spreading a Partial widens every overridden property to
// `T | undefined`, which makes the fixture stop type-checking against ApprovalResponse. The merge is the
// same; only the resulting type differs.
function approval(overrides: Partial<ApprovalResponse> = {}): ApprovalResponse {
  const action = { kind: 'RouteOrder', summary: 'Route 12,000 CONT to XLIT' };

  const base: ApprovalResponse = {
    id: 'APR-1',
    correlationId: 'corr-1',
    lane: 'OrderRouting',
    evidencePacketHash: 'sha256:abc',
    state: 'PendingApproval',
    proposedByObjectId: PROPOSER,
    expiresAt: '2026-09-10T12:30:00Z',
    createdAt: '2026-09-10T11:55:00Z',
    evidencePacket: {
      correlationId: 'corr-1',
      lane: 'OrderRouting',
      routingDecision: {
        outcome: 'Routed',
        complexityScore: 42,
        costCeilingUsd: 5,
        rationale: 'Standard tier met the complexity and cost envelope.',
      },
      proposedAction: action,
    },

    // Carried alongside the packet on every response, including list rows that omit the packet.
    proposedAction: action,
    evidenceIntegrityVerified: true,
  };

  return Object.assign(base, overrides);
}

const approverContext: ApprovalContext = {
  roles: ['Approver'],
  currentUserObjectId: APPROVER,
  now: NOW,
};

describe('evaluateApproval', () => {
  it('permits a distinct, entitled approver on a live proposal', () => {
    expect(evaluateApproval(approval(), approverContext)).toEqual({ blocked: false });
  });

  it('blocks the proposer from approving their own proposal', () => {
    const result = evaluateApproval(approval(), {
      ...approverContext,
      currentUserObjectId: PROPOSER,
    });

    expect(result).toMatchObject({ blocked: true, code: 'SegregationOfDuties' });

    // The reason is shown to a user and read aloud on stage, so it has to be a sentence rather
    // than a code. A blank or codey reason is how a control becomes indistinguishable from a bug.
    expect(result.blocked && result.reason).toMatch(/cannot be the identity that/i);
  });

  it('blocks a caller without the Approver role', () => {
    expect(
      evaluateApproval(approval(), { ...approverContext, roles: ['Router.Read'] }),
    ).toMatchObject({ blocked: true, code: 'MissingRole' });
  });

  it('refuses rather than assumes when the identity cannot be established', () => {
    // The important half of this test is that it does not return { blocked: false }. An unknown
    // identity cannot be compared to the proposer, and permitting the action would enable exactly
    // what segregation of duties exists to prevent.
    expect(
      evaluateApproval(approval(), { ...approverContext, currentUserObjectId: null }),
    ).toMatchObject({ blocked: true, code: 'UnknownIdentity' });
  });

  it('treats an elapsed window as the absence of a decision', () => {
    const result = evaluateApproval(
      approval({ expiresAt: '2026-09-10T11:59:00Z' }),
      approverContext,
    );

    expect(result).toMatchObject({ blocked: true, code: 'Expired' });
  });

  it('reports segregation of duties ahead of expiry to the proposer', () => {
    // A proposer looking at their own expired proposal needs the sentence about who may approve.
    // Reporting only the expiry implies a fresh proposal would make them eligible; it would not.
    const result = evaluateApproval(approval({ expiresAt: '2026-09-10T11:59:00Z' }), {
      ...approverContext,
      currentUserObjectId: PROPOSER,
    });

    expect(result).toMatchObject({ blocked: true, code: 'SegregationOfDuties' });
  });

  it('blocks a proposal that already carries a decision', () => {
    expect(evaluateApproval(approval({ state: 'Approved' }), approverContext)).toMatchObject({
      blocked: true,
      code: 'AlreadyDecided',
    });
  });

  it('treats expiry as exclusive at the exact boundary', () => {
    // Equal timestamps expire. A window that is open at the instant it closes is a window whose
    // edge nobody can state, and this value ends up in an audit record.
    expect(
      evaluateApproval(approval({ expiresAt: NOW.toISOString() }), approverContext),
    ).toMatchObject({ blocked: true, code: 'Expired' });
  });
});

describe('formatExpiry', () => {
  it('says Expired rather than a negative duration', () => {
    expect(formatExpiry(approval({ expiresAt: '2026-09-10T11:00:00Z' }), NOW)).toBe('Expired');
  });

  it('reports minutes for a live proposal', () => {
    expect(formatExpiry(approval(), NOW)).toBe('Expires in 30m');
  });

  it('reports seconds under a minute, so a closing window is visibly closing', () => {
    expect(formatExpiry(approval({ expiresAt: '2026-09-10T12:00:20Z' }), NOW)).toBe(
      'Expires in 20s',
    );
  });
});
