import type {
  PolicyBreach,
  SimulatedExecution,
  VenueEvaluation,
} from '../../api/types.generated';
import type { ExecutionRefusal, RouteHalt, RouteProposalResponse } from '../../api/client';
import { Banner } from '../../state/AsyncBoundary';

/**
 * T-034. The label that says nothing reached a market.
 *
 * It reads its text from `execution.executionMode`, which is a field on the stored record, rather
 * than from a constant in this file. A screenshot of this screen taken out of context is then
 * still honest, and the label cannot drift away from what the audit trail says.
 */
export function SimulatedBadge({ mode }: { mode: string }) {
  return (
    <span className="badge badge--simulated" title="No order reached a real venue.">
      {mode}
    </span>
  );
}

/**
 * Screen 10. Order routing.
 *
 * Three outcomes get equal weight on this screen, because all three are the product:
 * a routable proposal, a policy halt with the boundary named, and a refused execution.
 * A screen that renders the happy path in a table and the other two as toasts is arguing that
 * refusals are exceptions, when they are the thing being demonstrated.
 */
export function OrderRoutingScreen({
  result,
  execution,
}: {
  result?: RouteProposalResponse | RouteHalt;
  execution?: SimulatedExecution | ExecutionRefusal;
}) {
  return (
    <section className="screen">
      <header className="screen__header">
        <h2 className="screen__title">Order routing</h2>
        <p className="screen__subtitle">
          Venue selection is deterministic policy evaluation. No model chooses a venue.
        </p>
      </header>

      {result === undefined ? (
        <div className="state state--empty">
          <span className="state__title">No order routed yet</span>
          <p className="state__detail">
            Submit an order with its venue quotes to see the best-execution evaluation. The router
            does not invent liquidity, so at least one quote is required.
          </p>
        </div>
      ) : result.status === 'Halted' ? (
        <HaltView halt={result} />
      ) : (
        <ProposalView response={result} />
      )}

      {execution !== undefined &&
        ('executed' in execution ? (
          <ExecutionRefusalView refusal={execution} />
        ) : (
          <ExecutionView execution={execution} />
        ))}
    </section>
  );
}

function HaltView({ halt }: { halt: RouteHalt }) {
  return (
    <>
      <Banner tone="danger" title="Routing halted by policy" detail={halt.haltSummary} />
      <BreachTable breaches={halt.breaches} />

      {/*
        The venues that were considered are shown even though none was chosen. Without them the
        halt is an assertion; with them it is an argument the audience can check.
      */}
      <ConsideredTable considered={halt.considered} />
      <p className="screen__footnote">
        Correlation id <span className="mono">{halt.correlationId}</span>
      </p>
    </>
  );
}

function ProposalView({ response }: { response: RouteProposalResponse }) {
  const { proposal } = response;
  return (
    <>
      <div className="proposal">
        <h3 className="proposal__heading">
          Route {proposal.quantity.toLocaleString()} to {proposal.venueCode}
        </h3>

        {/*
          The justification is a sentence, not a score. The presenter reads it aloud mid-sentence,
          and a JSON blob or a bare number cannot be read aloud.
        */}
        <p className="proposal__justification">{proposal.bestExecutionJustification}</p>
        <p className="proposal__liquidity">{proposal.liquidityRationale}</p>

        <dl className="kv kv--inline">
          <dt>Total cost</dt>
          <dd>{proposal.cost.totalCostBps.toFixed(2)} bps</dd>
          <dt>Spread</dt>
          <dd>{proposal.cost.spreadCostBps.toFixed(2)} bps</dd>
          <dt>Impact</dt>
          <dd>{proposal.cost.impactBps.toFixed(2)} bps</dd>
          <dt>Fee</dt>
          <dd>{proposal.cost.feeBps.toFixed(2)} bps</dd>
          <dt>Participation</dt>
          <dd>{(proposal.cost.participationRate * 100).toFixed(1)}%</dd>
          <dt>Projected price</dt>
          <dd>{proposal.cost.projectedPrice.toFixed(4)}</dd>
          <dt>Proposed by</dt>
          <dd className="mono">{proposal.proposedBy}</dd>
        </dl>

        <Banner
          tone="info"
          title="Proposed, not executed"
          detail="This proposal changes nothing until an approver other than the proposer records a decision."
        />
      </div>

      <ConsideredTable considered={response.considered} />
      <p className="screen__footnote">
        Correlation id <span className="mono">{response.correlationId}</span>
      </p>
    </>
  );
}

function BreachTable({ breaches }: { breaches: PolicyBreach[] }) {
  return (
    <table className="table">
      <caption className="table__caption">Policy boundaries breached</caption>
      <thead>
        <tr>
          <th scope="col">Boundary</th>
          <th scope="col">Venue</th>
          <th scope="col">Permitted</th>
          <th scope="col">Observed</th>
          <th scope="col">Explanation</th>
        </tr>
      </thead>
      <tbody>
        {breaches.map((breach, index) => (
          <tr key={`${breach.boundary}-${breach.venueCode ?? 'order'}-${index}`}>
            <td>{breach.boundary}</td>
            <td>{breach.venueCode ?? 'Order-level'}</td>
            <td>{breach.permitted}</td>
            <td>{breach.observed}</td>
            <td>{breach.explanation}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsideredTable({ considered }: { considered: VenueEvaluation[] }) {
  return (
    <table className="table">
      <caption className="table__caption">
        Venues considered ({considered.length}) — every one evaluated, eligible or not
      </caption>
      <thead>
        <tr>
          <th scope="col">Venue</th>
          <th scope="col">Type</th>
          <th scope="col">Total cost</th>
          <th scope="col">Projected cost</th>
          <th scope="col">Eligible</th>
          <th scope="col">Why</th>
        </tr>
      </thead>
      <tbody>
        {considered.map((venue) => (
          <tr key={venue.quote.venueCode} className={venue.isEligible ? '' : 'row--ineligible'}>
            <td>{venue.quote.venueCode}</td>
            <td>{venue.quote.type}</td>
            <td>{venue.cost.totalCostBps.toFixed(2)} bps</td>
            <td>{formatUsd(venue.cost.projectedCostUsd)}</td>
            <td>{venue.isEligible ? 'Yes' : 'No'}</td>
            <td>
              {venue.isEligible
                ? venue.liquidityRationale
                : venue.breaches.map((b) => b.boundary).join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExecutionView({ execution }: { execution: SimulatedExecution }) {
  return (
    <section className="execution">
      <h3 className="execution__heading">
        Executed <SimulatedBadge mode={execution.executionMode} />
      </h3>
      <dl className="kv kv--inline">
        <dt>Execution id</dt>
        <dd className="mono">{execution.executionId}</dd>
        <dt>Venue</dt>
        <dd>{execution.venueCode}</dd>
        <dt>Quantity</dt>
        <dd>{execution.quantity.toLocaleString()}</dd>
        <dt>Price</dt>
        <dd>{execution.price.toFixed(4)}</dd>
        <dt>Approval</dt>
        <dd className="mono">{execution.approvalId}</dd>
        <dt>Correlation id</dt>
        <dd className="mono">{execution.correlationId}</dd>
      </dl>
    </section>
  );
}

function ExecutionRefusalView({ refusal }: { refusal: ExecutionRefusal }) {
  return (
    <Banner tone="danger" title={`Execution refused — ${refusal.refusal}`} detail={refusal.detail} />
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
