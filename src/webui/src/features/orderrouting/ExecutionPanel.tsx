import { useState } from 'react';
import type { ApiClient, ExecuteRouteRequest, RouteProposalResponse } from '../../api/client';
import type { ApprovalResponse } from '../../api/types.generated';
import { Banner } from '../../state/AsyncBoundary';

/**
 * The half of beat 6 that turns an approval into a consequence.
 *
 * The panel never constructs an approval. It looks one up by id and forwards the record the
 * approvals service returned, field for field. That distinction is the whole control: a screen
 * that assembled `{ approvalId, approvedBy, approvedAt }` from whatever the operator typed would
 * be manufacturing the exact artefact Principle I exists to require, and the service would have no
 * way to tell the difference.
 *
 * Two paths are therefore offered and both are honest:
 *
 *   - Execute with an approval. The looked-up record is sent verbatim. If it is not approved, or
 *     has expired, or was decided by the proposer, the service refuses and the refusal is shown.
 *   - Execute with no approval at all. Nothing is fabricated to fill the gap; the request simply
 *     carries no approval and earns its 403.
 *
 * The second button is not a footgun. It is the demonstration: the audience needs to see the gate
 * refuse, and a gate that can only be observed working is indistinguishable from an absent one.
 */
export function ExecutionPanel({
  client,
  result,
  onExecuted,
}: {
  client: ApiClient;
  result: RouteProposalResponse;
  onExecuted: (request: ExecuteRouteRequest) => Promise<void>;
}) {
  const [approvalId, setApprovalId] = useState('');
  const [lookup, setLookup] = useState<ApprovalResponse | undefined>();
  const [lookupFailure, setLookupFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const base = {
    proposalId: result.proposal.proposalId,
    correlationId: result.correlationId,
  };

  async function look() {
    setBusy(true);
    setLookupFailure(undefined);
    setLookup(undefined);

    try {
      setLookup(await client.getApproval(approvalId.trim()));
    } catch (error) {
      setLookupFailure(
        error instanceof Error ? error.message : 'That approval could not be retrieved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function execute(approval?: ApprovalResponse) {
    setBusy(true);

    try {
      await onExecuted(
        approval
          ? {
              ...base,

              // Copied straight off the retrieved record. decidedAt and decidedByObjectId are
              // null until someone decides, and they are forwarded as-is when they are: sending a
              // placeholder would hand the gate a well-formed approval nobody granted.
              approval: {
                approvalId: approval.id,
                approvedBy: approval.decidedByObjectId ?? '',
                approvedAt: approval.decidedAt ?? approval.createdAt,
                expiresAt: approval.expiresAt,
              },
            }
          : base,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="execution execution--panel">
      <h3 className="execution__heading">Execute this proposal</h3>

      <p className="screen__subtitle">
        Execution requires an approval granted by someone other than the proposer. This panel
        forwards the approval record as the approvals service returned it; it does not build one.
      </p>

      <label className="field">
        <span className="field__label">
          Approval id
          <span className="field__hint"> — the proposal must already have been approved</span>
        </span>
        <input
          className="field__input"
          value={approvalId}
          onChange={(event) => setApprovalId(event.target.value)}
          placeholder="APR-…"
        />
      </label>

      <div className="ticket__actions">
        <button
          type="button"
          className="button"
          onClick={() => void look()}
          disabled={busy || approvalId.trim().length === 0}
        >
          Look up approval
        </button>

        <button
          type="button"
          className="button button--primary"
          onClick={() => void execute(lookup)}
          disabled={busy || !lookup}
          title={lookup ? undefined : 'Look up an approval first.'}
        >
          Execute with this approval
        </button>

        <button
          type="button"
          className="button button--danger"
          onClick={() => void execute(undefined)}
          disabled={busy}
          title="Sends the request with no approval attached, so the gate can refuse it."
        >
          Attempt without approval
        </button>
      </div>

      {lookupFailure && <Banner tone="danger" title="Approval not retrieved" detail={lookupFailure} />}

      {lookup && (
        <dl className="kv kv--inline">
          <dt>State</dt>
          <dd>{lookup.state}</dd>
          <dt>Proposed by</dt>
          <dd className="mono">{lookup.proposedByObjectId}</dd>
          <dt>Decided by</dt>
          <dd className="mono">{lookup.decidedByObjectId ?? 'Not yet decided'}</dd>
          <dt>Expires</dt>
          <dd>{lookup.expiresAt}</dd>
        </dl>
      )}

      {lookup && lookup.state !== 'Approved' && (
        <Banner
          tone="warning"
          title={`This approval is ${lookup.state}`}
          detail="Sending it will be refused. The request is still forwarded unchanged so the refusal comes from the service, not from this screen."
        />
      )}
    </section>
  );
}
