import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ApiClient } from '../../api/client';
import type { AppRole } from '../../shell/navigation';
import { ApprovalDetail } from './ApprovalDetail';
import { ApprovalsQueue } from './ApprovalsQueue';
import type { ApprovalContext } from './approvalRules';
import {
  describeDecisionFailure,
  useApproval,
  useDecideApproval,
  usePendingApprovals,
} from './useApprovals';

export interface ApprovalRouteProps {
  client: ApiClient;
  roles: readonly AppRole[];
  currentUserObjectId: string | null;
}

export function ApprovalsQueueRoute({ client, roles, currentUserObjectId }: ApprovalRouteProps) {
  const state = usePendingApprovals(client);
  const context: ApprovalContext = { roles, currentUserObjectId };

  return <ApprovalsQueue state={state} context={context} />;
}

export function ApprovalDetailRoute({ client, roles, currentUserObjectId }: ApprovalRouteProps) {
  const { id = '' } = useParams<{ id: string }>();
  const state = useApproval(client, id);
  const decide = useDecideApproval(client, id);
  const [refusal, setRefusal] = useState<string | undefined>();

  const context: ApprovalContext = { roles, currentUserObjectId };

  async function onDecide(decision: 'Approved' | 'Rejected', reason: string) {
    setRefusal(undefined);
    try {
      await decide.mutateAsync({
        decision,
        // Sent only when present. The service requires it to reject and ignores it otherwise;
        // sending an empty string would put a blank reason in an audit record.
        ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
      });
    } catch (error) {
      setRefusal(describeDecisionFailure(error));
    }
  }

  return (
    <ApprovalDetail
      state={state}
      context={context}
      onDecide={onDecide}
      serverRefusal={refusal}
      submitting={decide.isPending}
    />
  );
}
