import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalResponse } from '../../api/types.generated';
import { AsyncBoundary, Banner } from '../../state/AsyncBoundary';
import type { AsyncState } from '../../state/asyncState';
import {
  evaluateApproval,
  formatExpiry,
  type ApprovalBlockCode,
  type ApprovalContext,
} from './approvalRules';

interface ApprovalsQueueProps {
  state: AsyncState<ApprovalResponse[]>;
  context: ApprovalContext;
}

/**
 * Screen 7. The queue of proposals awaiting a decision.
 *
 * Rows that the signed-in user cannot approve are shown, not filtered out. Hiding them would make
 * the queue look shorter than it is and would remove the thing beat 6 needs on screen: a proposal
 * this person is visibly not allowed to decide.
 */
export function ApprovalsQueue({ state, context }: ApprovalsQueueProps) {
  return (
    <section className="screen">
      <header className="screen__header">
        <h2 className="screen__title">Approvals</h2>
        <p className="screen__subtitle">
          Nothing consequential executes without a decision recorded here.
        </p>
      </header>

      <AsyncBoundary state={state} label="pending approvals">
        {(approvals) => <QueueTable approvals={approvals} context={context} />}
      </AsyncBoundary>
    </section>
  );
}

function QueueTable({
  approvals,
  context,
}: {
  approvals: ApprovalResponse[];
  context: ApprovalContext;
}) {
  return (
    <table className="table">
      <caption className="table__caption">
        {approvals.length} proposal{approvals.length === 1 ? '' : 's'} awaiting a decision
      </caption>
      <thead>
        <tr>
          <th scope="col">Lane</th>
          <th scope="col">Proposed action</th>
          <th scope="col">Proposed by</th>
          <th scope="col">Expires</th>
          <th scope="col">Your standing</th>
          <th scope="col">
            <span className="visually-hidden">Open</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {approvals.map((approval) => {
          const block = evaluateApproval(approval, context);
          return (
            <tr key={approval.id}>
              <td>{approval.lane}</td>
              <td>{approval.proposedAction.summary}</td>
              <td className="mono">{approval.proposedByObjectId}</td>
              <td>{formatExpiry(approval, context.now)}</td>
              <td>
                {block.blocked ? (
                  <span className="tag tag--blocked" title={block.reason}>
                    {block.code === 'SegregationOfDuties' ? 'You proposed this' : block.code}
                  </span>
                ) : (
                  <span className="tag tag--eligible">Can decide</span>
                )}
              </td>
              <td>
                <Link className="link" to={`/approvals/${approval.id}`}>
                  Open evidence
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface DecisionPanelProps {
  approval: ApprovalResponse;
  context: ApprovalContext;
  onDecide: (decision: 'Approved' | 'Rejected', reason: string) => Promise<void>;
  /** A refusal returned by the server after the client thought the action was allowed. */
  serverRefusal?: string;
  submitting?: boolean;
}

/**
 * The approve and reject controls.
 *
 * Disabled with the reason stated, never hidden. Beat 6 requires showing a user being refused, and
 * an invisible control demonstrates nothing — the audience cannot tell a governance decision from
 * a screen that has not finished loading.
 */
export function DecisionPanel({
  approval,
  context,
  onDecide,
  serverRefusal,
  submitting = false,
}: DecisionPanelProps) {
  const [reason, setReason] = useState('');
  const block = evaluateApproval(approval, context);

  // The server requires a reason to reject. Enforced here too, because a rejection with no stated
  // reason is an audit record that cannot answer the only question anyone will ask of it.
  const rejectionNeedsReason = reason.trim().length === 0;

  return (
    <section className="decision">
      <h3 className="decision__heading">Decision</h3>

      {block.blocked && (
        <Banner
          tone={block.code === 'SegregationOfDuties' ? 'danger' : 'warning'}
          title={blockTitle(block.code)}
          detail={block.reason}
        />
      )}

      {serverRefusal && (
        <Banner
          tone="danger"
          title="The service refused this decision"
          detail={serverRefusal}
        />
      )}

      <label className="field">
        <span className="field__label">
          Reason <span className="field__hint">(required to reject)</span>
        </span>
        <textarea
          className="field__input"
          value={reason}
          rows={3}
          disabled={block.blocked || submitting}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <div className="decision__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={block.blocked || submitting}
          onClick={() => void onDecide('Approved', reason)}
        >
          Approve
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={block.blocked || submitting || rejectionNeedsReason}
          onClick={() => void onDecide('Rejected', reason)}
        >
          Reject
        </button>
      </div>

      {!block.blocked && rejectionNeedsReason && (
        <p className="decision__hint">
          Rejecting requires a reason. The record has to say why, not only that.
        </p>
      )}
    </section>
  );
}

function blockTitle(code: ApprovalBlockCode): string {
  switch (code) {
    case 'SegregationOfDuties':
      return 'You cannot approve your own proposal';
    case 'MissingRole':
      return 'You do not hold the Approver role';
    case 'Expired':
      return 'This proposal has expired';
    case 'AlreadyDecided':
      return 'A decision has already been recorded';
    case 'UnknownIdentity':
      return 'Your identity could not be established';
  }
}
