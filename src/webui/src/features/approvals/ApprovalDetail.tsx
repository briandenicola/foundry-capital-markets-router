import type { ApprovalResponse } from '../../api/types.generated';
import { EvidencePacketView } from '../../components/EvidencePacketView';
import { AsyncBoundary, Banner } from '../../state/AsyncBoundary';
import type { AsyncState } from '../../state/asyncState';
import { DecisionPanel } from './ApprovalsQueue';
import { formatExpiry, type ApprovalContext } from './approvalRules';

interface ApprovalDetailProps {
  state: AsyncState<ApprovalResponse>;
  context: ApprovalContext;
  onDecide: (decision: 'Approved' | 'Rejected', reason: string) => Promise<void>;
  serverRefusal?: string;
  submitting?: boolean;
}

/**
 * Screen 8. The full evidence packet and the decision controls.
 *
 * The packet is rendered above the controls, in full, and is not collapsed behind a disclosure.
 * An approver is accountable for having read it, and a screen that makes approving cheaper than
 * reading is a screen that manufactures the appearance of oversight.
 */
export function ApprovalDetail({
  state,
  context,
  onDecide,
  serverRefusal,
  submitting,
}: ApprovalDetailProps) {
  return (
    <section className="screen">
      <AsyncBoundary state={state} label="this proposal">
        {(approval) => (
          <>
            <header className="screen__header">
              <h2 className="screen__title">{approval.proposedAction.summary}</h2>
              <p className="screen__subtitle">
                {approval.lane} · {approval.state} · {formatExpiry(approval, context.now)}
              </p>
              <dl className="kv kv--inline">
                <dt>Correlation id</dt>
                <dd className="mono">{approval.correlationId}</dd>
                <dt>Proposed by</dt>
                <dd className="mono">{approval.proposedByObjectId}</dd>
                {/*
                  The hash is shown, not hidden behind a tooltip. It is what ties this screen to the
                  stored record, and it is the only thing that lets someone later prove the packet
                  an approver saw is the packet the audit trail holds.
                */}
                <dt>Evidence packet hash</dt>
                <dd className="mono">{approval.evidencePacketHash}</dd>
                {approval.decidedByObjectId && (
                  <>
                    <dt>Decided by</dt>
                    <dd className="mono">{approval.decidedByObjectId}</dd>
                    <dt>Reason</dt>
                    <dd>{approval.decisionReason ?? 'No reason recorded'}</dd>
                  </>
                )}
              </dl>
            </header>

            {/*
              A detail response is supposed to carry its packet. If one does not, the screen says
              so and the decision panel below stays blocked — it does not render an empty packet
              that an approver could mistake for "there was nothing to show". Principle III: missing
              evidence is reported, never manufactured.
            */}
            {approval.evidencePacket ? (
              <EvidencePacketView packet={approval.evidencePacket} />
            ) : (
              <Banner
                tone="danger"
                title="Evidence packet missing"
                detail="This proposal returned without its evidence packet. Nothing can be approved on evidence that was not shown."
              />
            )}

            <DecisionPanel
              approval={approval}
              context={context}
              onDecide={onDecide}
              serverRefusal={serverRefusal}
              submitting={submitting}
            />
          </>
        )}
      </AsyncBoundary>
    </section>
  );
}
