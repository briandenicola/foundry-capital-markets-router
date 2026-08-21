import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RouteHalt, RouteProposalResponse } from '../../api/client';
import type { SimulatedExecution, VenueEvaluation } from '../../api/types.generated';
import { OrderRoutingScreen } from './OrderRoutingScreen';

function evaluation(overrides: Partial<VenueEvaluation> = {}): VenueEvaluation {
  return {
    quote: {
      venueCode: 'XLIT',
      type: 'Lit',
      midPrice: 100,
      spread: 0.05,
      displayedLiquidity: 250_000,
      isDark: false,
    },
    cost: {
      participationRate: 0.048,
      spreadCostBps: 2.5,
      impactBps: 2.4,
      feeBps: 0.2,
      projectedPrice: 100.05,
      projectedCostUsd: 6_003,
      totalCostBps: 5.1,
    },
    breaches: [],
    isEligible: true,
    liquidityRationale: 'Displayed liquidity covers the order twenty times over.',
    ...overrides,
  };
}

const proposed: RouteProposalResponse = {
  status: 'Proposed',
  correlationId: 'corr-1',
  considered: [
    evaluation(),
    evaluation({
      quote: {
        venueCode: 'DARK-2',
        type: 'Dark',
        midPrice: 100,
        spread: 0.02,
        displayedLiquidity: 0,
        isDark: true,
      },
      breaches: [
        {
          boundary: 'VenueNotApproved',
          venueCode: 'DARK-2',
          permitted: 'XLIT, XMER, XNOR, XPAC, DARK-1',
          observed: 'DARK-2',
          explanation: 'DARK-2 is not on the approved venue list.',
        },
      ],
      isEligible: false,
    }),
  ],
  proposal: {
    proposalId: 'PRP-1',
    correlationId: 'corr-1',
    orderId: 'ORD-1041',
    quantity: 12_000,
    venueCode: 'XLIT',
    cost: evaluation().cost,
    liquidityRationale: 'Displayed liquidity covers the order twenty times over.',
    bestExecutionJustification: 'XLIT was cheapest at 5.10 bps across four eligible venues.',
    proposedBy: 'obj-trader-1',
    considered: [],
  },
};

const halted: RouteHalt = {
  status: 'Halted',
  correlationId: 'corr-2',
  haltSummary: 'No venue satisfied the best-execution policy for this order.',
  breaches: [
    {
      boundary: 'DarkPoolMinimumSize',
      venueCode: 'DARK-1',
      permitted: '10,000 shares',
      observed: '400 shares',
      explanation: 'An order this small may not be routed to a dark venue.',
    },
  ],
  considered: [evaluation({ isEligible: false })],
};

describe('OrderRoutingScreen', () => {
  it('explains the empty state rather than showing a blank page', () => {
    render(<OrderRoutingScreen />);
    expect(screen.getByText('No order routed yet')).toBeInTheDocument();
  });

  it('leads with a justification that can be read aloud, not a score', () => {
    render(<OrderRoutingScreen result={proposed} />);

    expect(
      screen.getByText('XLIT was cheapest at 5.10 bps across four eligible venues.'),
    ).toBeInTheDocument();
  });

  it('says a proposal has changed nothing', () => {
    render(<OrderRoutingScreen result={proposed} />);
    expect(screen.getByText('Proposed, not executed')).toBeInTheDocument();
  });

  it('shows venues that were rejected alongside the one that won', () => {
    render(<OrderRoutingScreen result={proposed} />);

    // Without the rejected venues the recommendation is an assertion; with them it is an argument
    // the audience can check.
    expect(screen.getByText('DARK-2')).toBeInTheDocument();
    expect(screen.getByText('VenueNotApproved')).toBeInTheDocument();
  });

  it('renders a halt as a governed refusal naming the boundary', () => {
    render(<OrderRoutingScreen result={halted} />);

    expect(screen.getByText('Routing halted by policy')).toBeInTheDocument();
    expect(screen.getByText('DarkPoolMinimumSize')).toBeInTheDocument();
    expect(screen.getByText('10,000 shares')).toBeInTheDocument();
    expect(screen.getByText('400 shares')).toBeInTheDocument();
  });

  it('labels an execution with the mode carried on the record', () => {
    const execution: SimulatedExecution = {
      executionId: 'EXE-1',
      proposalId: 'PRP-1',
      orderId: 'ORD-1041',
      correlationId: 'corr-1',
      venueCode: 'XLIT',
      quantity: 12_000,
      price: 100.05,
      executedAt: '2026-09-10T12:01:00Z',
      approvalId: 'APR-1',
      executionMode: 'SIMULATED',
    };

    render(<OrderRoutingScreen result={proposed} execution={execution} />);

    // T-034. The label comes from execution.executionMode, so a screenshot taken out of context is
    // still honest and the label cannot drift from what the audit record says.
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
  });

  it('renders a refused execution as a refusal, never as a silent absence', () => {
    render(
      <OrderRoutingScreen
        result={proposed}
        execution={{
          executed: false,
          refusal: 'SegregationOfDuties',
          detail: 'The approver is the same identity that proposed this order.',
          correlationId: 'corr-1',
        }}
      />,
    );

    expect(screen.getByText('Execution refused — SegregationOfDuties')).toBeInTheDocument();
    expect(screen.queryByText('SIMULATED')).not.toBeInTheDocument();
  });
});
