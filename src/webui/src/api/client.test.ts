import { describe, it, expect } from 'vitest';
import { ApiClient, ApiError, isRefusal, type RouteResponse } from './client';

function clientWith(response: Response) {
  return new ApiClient({
    baseUrl: 'https://router.internal',
    getAccessToken: async () => 'token',
    fetchImpl: async () => response,
  });
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
    ...init,
  });
}

describe('ApiClient', () => {
  it('returns a policy refusal as a normal response, not an error', async () => {
    const body: RouteResponse = {
      correlationId: 'corr-1',
      decision: {
        complexityScore: 0.4,
        costCeilingUsd: 0.5,
        outcome: 'RefusedByPolicy',
        candidateTiers: [],
        rationale: 'No approved vendor may process Restricted data.',
        selectedDeployment: null,
        selectedVendor: null,
      },
    };

    const result = await clientWith(json(body)).route({
      prompt: 'summarise',
      dataClassification: 'Restricted',
    });

    expect(isRefusal(result)).toBe(true);
    expect(result.decision.selectedDeployment).toBeNull();
  });

  it('does not classify a routed decision as a refusal', async () => {
    const body: RouteResponse = {
      correlationId: 'corr-1',
      decision: {
        complexityScore: 0.4,
        costCeilingUsd: 0.5,
        outcome: 'Routed',
        candidateTiers: [],
        rationale: 'Routed to Standard.',
      },
    };

    expect(isRefusal(await clientWith(json(body)).route({
      prompt: 'x',
      dataClassification: 'Internal',
    }))).toBe(false);
  });

  it('raises ApiError with the correlation id on a genuine failure', async () => {
    const failing = clientWith(
      json({ detail: 'Router unreachable' }, { status: 503 }),
    );

    await expect(
      failing.route({ prompt: 'x', dataClassification: 'Internal' }),
    ).rejects.toMatchObject({ status: 503, message: 'Router unreachable', correlationId: 'corr-1' });
  });

  it('surfaces a non-JSON error body without throwing on the parse', async () => {
    const failing = new ApiClient({
      baseUrl: 'https://router.internal',
      getAccessToken: async () => null,
      fetchImpl: async () => new Response('gateway timeout', { status: 504, statusText: 'Gateway Timeout' }),
    });

    await expect(failing.route({ prompt: 'x', dataClassification: 'Public' }))
      .rejects.toBeInstanceOf(ApiError);
  });
});
