import type {
  RoutingDecision,
  PolicySet,
  DataClassification,
  ApprovalResponse,
  ApprovalState,
  RouteProposal,
  SimulatedExecution,
  PolicyBreach,
  VenueEvaluation,
  ExecutionRefusalReason,
} from './types.generated';

/**
 * Router API client.
 *
 * Note what `RouteRequest` does not have: no model, no vendor, no deployment, no tier. Principle
 * IV is enforced by the type, because a field that exists is a field that eventually gets used.
 *
 * `dataClassification` is required. The server treats an omission as a 400 rather than assuming
 * Public, and the client type mirrors that so the mistake is caught at compile time instead of
 * during a live request.
 */
export interface RouteRequest {
  prompt: string;
  dataClassification: DataClassification;
  costCeilingUsd?: number;
  policySetId?: string;
  correlationId?: string;
}

export interface RouteResponse {
  correlationId: string;
  decision: RoutingDecision;
  output?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Supplied by the MSAL wiring in T-028b. Returns null when unauthenticated. */
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  route(request: RouteRequest): Promise<RouteResponse> {
    return this.send<RouteResponse>('POST', '/v1/route', request);
  }

  listPolicySets(): Promise<{ policySets: PolicySet[] }> {
    return this.send<{ policySets: PolicySet[] }>('GET', '/v1/policy-sets');
  }

  listApprovals(state: ApprovalState = 'PendingApproval'): Promise<ApprovalResponse[]> {
    // The endpoint returns a bare array, not an envelope. List rows omit the full evidence packet
    // and carry the proposed-action summary only.
    return this.send<ApprovalResponse[]>('GET', `/v1/approvals?state=${state}`);
  }

  getApproval(id: string): Promise<ApprovalResponse> {
    return this.send<ApprovalResponse>('GET', `/v1/approvals/${encodeURIComponent(id)}`);
  }

  /**
   * Records a decision.
   *
   * There is no `decidedByObjectId` parameter, and there must never be one. The approvals service
   * answers 400 IdentityNotAccepted if a caller supplies it, because segregation of duties
   * compares the approver against the proposer, and a comparison between two caller-supplied
   * strings is not a control. The identity comes from the token. See ADR-011.
   */
  decideApproval(id: string, decision: ApprovalDecision): Promise<ApprovalResponse> {
    return this.send<ApprovalResponse>('POST', `/v1/approvals/${encodeURIComponent(id)}/decision`, decision);
  }

  proposeRoute(request: RouteProposalRequest): Promise<RouteProposalResponse | RouteHalt> {
    return this.sendAllowing<RouteProposalResponse, RouteHalt>(
      'POST',
      '/v1/route-proposals',
      request,
      [422],
    );
  }

  executeRoute(request: ExecuteRouteRequest): Promise<ExecutionResponse | ExecutionRefusal> {
    return this.sendAllowing<ExecutionResponse, ExecutionRefusal>(
      'POST',
      '/v1/executions',
      request,
      [403, 409],
    );
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.sendAllowing<T, never>(method, path, body, [])) as T;
  }

  /**
   * Sends a request, treating some non-2xx statuses as structured answers rather than failures.
   *
   * A governed refusal is not a transport error. The order-routing lane answers 422 for a policy
   * halt and 403 for a refused execution, and both carry a body the screen must render in full:
   * the named boundary, or the reason the approval was not honoured. Collapsing those into an
   * exception with a message string would reduce the demonstration to a red toast, and would tempt
   * a caller into a retry -- the one behaviour a refusal must never invite.
   *
   * Statuses not listed still throw. A 500 is a failure and must not be mistaken for a decision.
   */
  private async sendAllowing<TOk, TRefusal>(
    method: string,
    path: string,
    body: unknown,
    refusalStatuses: readonly number[],
  ): Promise<TOk | TRefusal> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const token = await this.options.getAccessToken();

    const response = await fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const correlationId = response.headers.get('x-correlation-id') ?? undefined;

    if (!response.ok && !refusalStatuses.includes(response.status)) {
      // A refusal is a 200 with outcome RefusedByPolicy, never an error status, so anything
      // landing here is a genuine failure and must not be retried against a different model.
      let detail = response.statusText;
      try {
        const payload = (await response.json()) as { detail?: string; title?: string };
        detail = payload.detail ?? payload.title ?? detail;
      } catch {
        // Body was not JSON; the status text stands.
      }
      throw new ApiError(response.status, detail, correlationId);
    }

    return (await response.json()) as TOk | TRefusal;
  }
}

/**
 * True when a response is a governed refusal rather than a result.
 *
 * Exists so screens cannot accidentally treat a refusal as an error and offer a retry. Retrying
 * a refusal is the one behaviour the exchange must never encourage.
 */
export function isRefusal(response: RouteResponse): boolean {
  return response.decision.outcome === 'RefusedByPolicy';
}

/**
 * A decision on a proposal.
 *
 * `reason` is optional here even though the server requires it when rejecting. The server owns
 * that rule; duplicating it client-side gives the demo two places to disagree about what a valid
 * rejection is, and the one that matters is the one the audit record is written from.
 */
export interface ApprovalDecision {
  decision: 'Approved' | 'Rejected';
  reason?: string;
}

export interface RouteProposalRequest {
  orderId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  quantity: number;
  limitPrice?: number;
  arrivalMidPrice: number;
  quotes: VenueQuoteInput[];
  correlationId?: string;
}

export interface VenueQuoteInput {
  venueCode: string;
  type: 'Lit' | 'Dark';
  midPrice: number;
  spread: number;
  displayedLiquidity: number;
  feeBps?: number;
}

export interface RouteProposalResponse {
  status: 'Proposed';
  proposal: RouteProposal;
  considered: VenueEvaluation[];
  correlationId: string;
}

/**
 * A policy halt, returned as 422.
 *
 * Its own type rather than an error, because a halt is a governed refusal the screen must render
 * in full -- the named boundaries are the demonstration. Collapsing it into an error message would
 * reduce "this order breached the participation-rate ceiling at XMER" to a red toast.
 */
export interface RouteHalt {
  status: 'Halted';
  haltSummary: string;
  breaches: PolicyBreach[];
  considered: VenueEvaluation[];
  correlationId: string;
}

export function isHalt(result: RouteProposalResponse | RouteHalt): result is RouteHalt {
  return result.status === 'Halted';
}

export function isExecutionRefusal(
  result: ExecutionResponse | ExecutionRefusal,
): result is ExecutionRefusal {
  return result.executed === false;
}

export interface ExecuteRouteRequest {
  proposalId: string;
  correlationId: string;
  approval?: {
    approvalId: string;
    approvedBy: string;
    approvedAt: string;
    expiresAt: string;
  };
}

export interface ExecutionResponse {
  executed: true;
  execution: SimulatedExecution;
  correlationId: string;
}

/** A refusal from the execution gate. Always 403, never a quiet 200 with nothing in it. */
export interface ExecutionRefusal {
  executed: false;
  refusal: ExecutionRefusalReason | 'AlreadyExecuted';
  detail: string;
  correlationId: string;
}
