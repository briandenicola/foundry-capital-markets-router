import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClient, ApiError, type ApprovalDecision } from '../../api/client';
import type { ApprovalResponse } from '../../api/types.generated';
import type { AsyncState } from '../../state/asyncState';

/**
 * Maps a TanStack Query result onto the six-state union every screen renders.
 *
 * The mapping lives here rather than in the view so that "loaded but empty" cannot be rendered by
 * the same branch as "loaded with rows". That collapse is how a screen ends up showing an empty
 * table that looks like a working table with no results.
 */
function toAsyncState<T>(
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; dataUpdatedAt: number },
  options: { isEmpty: (data: T) => boolean; emptyMessage: string; retry: () => void },
): AsyncState<T> {
  if (query.isPending) {
    return { status: 'loading' };
  }

  if (query.isError) {
    const error = query.error;
    return {
      status: 'error',
      message:
        error instanceof ApiError
          ? `${error.message} (HTTP ${error.status}${error.correlationId ? `, correlation ${error.correlationId}` : ''})`
          : error instanceof Error
            ? error.message
            : 'The request failed and returned no detail.',
      retry: options.retry,
    };
  }

  const data = query.data as T;

  if (options.isEmpty(data)) {
    return { status: 'empty', message: options.emptyMessage };
  }

  return {
    status: 'ready',
    data,
    freshness: { asOf: new Date(query.dataUpdatedAt).toISOString(), source: 'approvals-service' },
  };
}

export function usePendingApprovals(client: ApiClient): AsyncState<ApprovalResponse[]> {
  const query = useQuery({
    queryKey: ['approvals', 'PendingApproval'],
    queryFn: () => client.listApprovals('PendingApproval'),

    // Polling, with focus refetch off: a presenter alt-tabbing must not trigger a visible refetch
    // mid-sentence. See docs/ui-design.md.
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  });

  return toAsyncState(
    query,
    {
      isEmpty: (approvals) => approvals.length === 0,
      emptyMessage:
        'No proposals are awaiting a decision. A lane creates one when it proposes a consequential action.',
      retry: () => void query.refetch(),
    },
  );
}

export function useApproval(client: ApiClient, id: string): AsyncState<ApprovalResponse> {
  const query = useQuery({
    queryKey: ['approvals', id],
    queryFn: () => client.getApproval(id),
    refetchOnWindowFocus: false,
  });

  return toAsyncState(query, {
    // A single record is never "empty"; either it exists or the fetch failed with a 404, which is
    // an error and must say so rather than rendering as an absence.
    isEmpty: () => false,
    emptyMessage: '',
    retry: () => void query.refetch(),
  });
}

export function useDecideApproval(client: ApiClient, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (decision: ApprovalDecision) => client.decideApproval(id, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

/**
 * Turns a failed decision into the sentence the approver should read.
 *
 * The server's refusals are the authoritative ones — the client-side check in `approvalRules` is a
 * courtesy that can be out of date the moment somebody else decides the same proposal. These
 * messages therefore describe what the *service* said, not what the UI predicted.
 */
export function describeDecisionFailure(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }

  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : 'The decision could not be recorded.';
  }

  switch (error.status) {
    case 409:
      return `${error.message} The service refused the decision; nothing was recorded.`;
    case 410:
      return `${error.message} The proposal expired before a decision reached the service, so it will never execute.`;
    case 403:
      return 'Your token does not carry the Approver app role, so the service refused the decision.';
    default:
      return `${error.message} (HTTP ${error.status})`;
  }
}
