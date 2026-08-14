import type { RoutingDecision, PolicySet, DataClassification } from './types.generated';

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

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
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

    if (!response.ok) {
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

    return (await response.json()) as T;
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
