import { useState } from 'react';
import type {
  ApiClient,
  ExecuteRouteRequest,
  ExecutionRefusal,
  RouteHalt,
  RouteProposalRequest,
  RouteProposalResponse,
} from '../../api/client';
import { isExecutionRefusal, isHalt } from '../../api/client';
import { ExecutionPanel } from './ExecutionPanel';
import type { SimulatedExecution } from '../../api/types.generated';
import { OrderRoutingScreen } from './OrderRoutingScreen';
import { OrderTicket } from './OrderTicket';

/**
 * Container for screen 10.
 *
 * Proposal and execution are held as separate pieces of state, not merged into one "result",
 * because they are separate governance events: a proposal is a recommendation and an execution is
 * a consequence. Collapsing them would let the screen show a fill without also showing what was
 * approved to produce it.
 */
export function OrderRoutingRoute({ client }: { client: ApiClient }) {
  const [result, setResult] = useState<RouteProposalResponse | RouteHalt | undefined>();
  const [execution, setExecution] = useState<SimulatedExecution | ExecutionRefusal | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function propose(request: RouteProposalRequest) {
    setSubmitting(true);
    setFailure(undefined);

    // Cleared on every new proposal. A stale fill left on screen beside a fresh proposal is the
    // one arrangement of this page that could be read as "this order executed".
    setExecution(undefined);

    try {
      setResult(await client.proposeRoute(request));
    } catch (error) {
      setResult(undefined);
      setFailure(error instanceof Error ? error.message : 'The proposal request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function run(request: ExecuteRouteRequest) {
    setFailure(undefined);

    try {
      const response = await client.executeRoute(request);

      // A refusal is a result, not an error. It is stored in the same slot as a fill so the screen
      // renders it with the same weight, which is what beat 6 is for.
      setExecution(isExecutionRefusal(response) ? response : response.execution);
    } catch (error) {
      setExecution(undefined);
      setFailure(error instanceof Error ? error.message : 'The execution request failed.');
    }
  }

  // Only a proposal can be executed. A halt has nothing to execute, and offering the button anyway
  // would suggest the halt were a warning someone could click past.
  const executable = result && !isHalt(result) ? result : undefined;

  return (
    <>
      <OrderTicket onSubmit={propose} submitting={submitting} failure={failure} />
      <OrderRoutingScreen result={result} execution={execution} />
      {executable && <ExecutionPanel client={client} result={executable} onExecuted={run} />}
    </>
  );
}
