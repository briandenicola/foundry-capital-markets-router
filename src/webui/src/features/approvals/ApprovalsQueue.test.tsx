import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ApprovalResponse } from '../../api/types.generated';
import { ApprovalsQueue, DecisionPanel } from './ApprovalsQueue';
import type { ApprovalContext } from './approvalRules';

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
        rationale: 'Standard tier met the envelope.',
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

describe('ApprovalsQueue', () => {
  it('lists proposals the caller cannot decide rather than hiding them', () => {
    render(
      <MemoryRouter>
        <ApprovalsQueue
          state={{
            status: 'ready',
            data: [approval(), approval({ id: 'APR-2', proposedByObjectId: APPROVER })],
            freshness: { asOf: NOW.toISOString() },
          }}
          context={approverContext}
        />
      </MemoryRouter>,
    );

    // Both rows present. Filtering the ineligible one would make the queue look shorter than it is
    // and would remove the thing beat 6 needs on screen.
    expect(screen.getAllByText('Route 12,000 CONT to XLIT')).toHaveLength(2);
    expect(screen.getByText('You proposed this')).toBeInTheDocument();
    expect(screen.getByText('Can decide')).toBeInTheDocument();
  });

  it('explains an empty queue instead of rendering a blank table', () => {
    render(
      <MemoryRouter>
        <ApprovalsQueue
          state={{ status: 'empty', message: 'No proposals are awaiting a decision.' }}
          context={approverContext}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/No proposals are awaiting a decision/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('names what failed rather than showing a bare error', () => {
    render(
      <MemoryRouter>
        <ApprovalsQueue
          state={{ status: 'error', message: 'approvals-service returned HTTP 503.' }}
          context={approverContext}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('approvals-service returned HTTP 503.');
  });
});

describe('DecisionPanel', () => {
  it('renders the approve control disabled with a stated reason, not hidden', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);

    render(
      <DecisionPanel
        approval={approval()}
        context={{ ...approverContext, currentUserObjectId: PROPOSER }}
        onDecide={onDecide}
      />,
    );

    const approve = screen.getByRole('button', { name: 'Approve' });

    // Present, and disabled. Beat 6 requires showing a user being refused; a hidden button
    // demonstrates nothing because the audience cannot tell it from a screen still loading.
    expect(approve).toBeInTheDocument();
    expect(approve).toBeDisabled();
    expect(screen.getByText('You cannot approve your own proposal')).toBeInTheDocument();

    await userEvent.click(approve);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('refuses to reject without a reason', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);

    render(<DecisionPanel approval={approval()} context={approverContext} onDecide={onDecide} />);

    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'Venue is not on the approved list.');

    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onDecide).toHaveBeenCalledWith('Rejected', 'Venue is not on the approved list.');
  });

  it('approves without requiring a reason', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);

    render(<DecisionPanel approval={approval()} context={approverContext} onDecide={onDecide} />);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onDecide).toHaveBeenCalledWith('Approved', '');
  });

  it('shows a server refusal even when the client thought the action was allowed', () => {
    // The client-side check is a courtesy; the service is the control. When they disagree, the
    // service wins and the screen has to say so, or an approver walks away believing a decision
    // was recorded that was not.
    render(
      <DecisionPanel
        approval={approval()}
        context={approverContext}
        onDecide={vi.fn()}
        serverRefusal="Segregation of duties. The service refused the decision; nothing was recorded."
      />,
    );

    expect(screen.getByText('The service refused this decision')).toBeInTheDocument();
  });
});
