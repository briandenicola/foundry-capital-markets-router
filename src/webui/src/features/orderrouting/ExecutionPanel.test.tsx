import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient, ExecuteRouteRequest, RouteProposalResponse } from '../../api/client';
import type { ApprovalResponse } from '../../api/types.generated';
import { ExecutionPanel } from './ExecutionPanel';

const result = {
  status: 'Proposed',
  correlationId: 'corr-1',
  proposal: { proposalId: 'PROP-1' },
  considered: [],
} as unknown as RouteProposalResponse;

function approvalRecord(overrides: Partial<ApprovalResponse> = {}): ApprovalResponse {
  const base = {
    id: 'APR-1',
    correlationId: 'corr-1',
    lane: 'OrderRouting',
    state: 'Approved',
    evidencePacketHash: 'sha256:abc',
    proposedByObjectId: 'obj-proposer',
    decidedByObjectId: 'obj-approver',
    decidedAt: '2026-09-10T12:00:00Z',
    expiresAt: '2026-09-10T13:00:00Z',
    createdAt: '2026-09-10T11:00:00Z',
    proposedAction: { kind: 'RouteOrder', summary: 'Route 12,000 CONT to XLIT' },
    evidenceIntegrityVerified: true,
  } as ApprovalResponse;

  return Object.assign(base, overrides);
}

function harness(approval: ApprovalResponse | Error = approvalRecord()) {
  const executed: ExecuteRouteRequest[] = [];

  const client = {
    getApproval: vi.fn(() =>
      approval instanceof Error ? Promise.reject(approval) : Promise.resolve(approval),
    ),
  } as unknown as ApiClient;

  const onExecuted = vi.fn(async (request: ExecuteRouteRequest) => {
    executed.push(request);
  });

  render(<ExecutionPanel client={client} result={result} onExecuted={onExecuted} />);

  return { executed, client };
}

async function lookUp(user: ReturnType<typeof userEvent.setup>, id = 'APR-1') {
  await user.type(screen.getByRole('textbox'), id);
  await user.click(screen.getByRole('button', { name: /look up approval/i }));
}

describe('ExecutionPanel', () => {
  it('forwards the retrieved approval verbatim rather than constructing one', async () => {
    const user = userEvent.setup();
    const { executed } = harness();

    await lookUp(user);
    await user.click(screen.getByRole('button', { name: /execute with this approval/i }));

    expect(executed).toHaveLength(1);
    expect(executed[0]).toEqual({
      proposalId: 'PROP-1',
      correlationId: 'corr-1',
      approval: {
        approvalId: 'APR-1',
        approvedBy: 'obj-approver',
        approvedAt: '2026-09-10T12:00:00Z',
        expiresAt: '2026-09-10T13:00:00Z',
      },
    });
  });

  it('sends no approval at all rather than a placeholder when none was supplied', async () => {
    const user = userEvent.setup();
    const { executed } = harness();

    await user.click(screen.getByRole('button', { name: /attempt without approval/i }));

    // The gate must see an absent approval, not a well-formed one nobody granted.
    expect(executed[0]).toEqual({ proposalId: 'PROP-1', correlationId: 'corr-1' });
    expect(executed[0]).not.toHaveProperty('approval');
  });

  it('cannot execute with an approval until one has actually been retrieved', () => {
    harness();

    expect(screen.getByRole('button', { name: /execute with this approval/i })).toBeDisabled();
  });

  it('forwards an undecided approval unchanged so the service issues the refusal', async () => {
    const user = userEvent.setup();
    const { executed } = harness(
      approvalRecord({ state: 'PendingApproval', decidedByObjectId: null, decidedAt: null }),
    );

    await lookUp(user);

    expect(screen.getByText(/this approval is PendingApproval/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /execute with this approval/i }));

    // approvedBy stays empty because nobody decided. Filling it would be the fabrication.
    expect(executed[0]?.approval?.approvedBy).toBe('');
  });

  it('reports a failed lookup instead of proceeding without the record', async () => {
    const user = userEvent.setup();
    const { executed } = harness(new Error('No proposal with id APR-1'));

    await lookUp(user);

    expect(screen.getByText(/no proposal with id APR-1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execute with this approval/i })).toBeDisabled();
    expect(executed).toHaveLength(0);
  });
});
