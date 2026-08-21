import { Fragment } from 'react';
import type { EvidencePacket } from '../api/types.generated';

/**
 * Renders an evidence packet in full.
 *
 * Shared between the approval detail screen and anywhere else a packet is shown, because the
 * packet is what an approver is accountable for having read. Two renderings of it would eventually
 * disagree about what was on screen when somebody clicked Approve, and the audit record would name
 * a hash that matched neither.
 */
export function EvidencePacketView({ packet }: { packet: EvidencePacket }) {
  const sources = packet.retrievedSources ?? [];
  const unattributable = packet.unattributableClaims ?? [];
  const inputs = Object.entries(packet.inputs ?? {});

  return (
    <div className="packet">
      <section className="packet__section">
        <h3 className="packet__heading">Proposed action</h3>
        <p className="packet__summary">{packet.proposedAction.summary}</p>
        <dl className="kv">
          <dt>Kind</dt>
          <dd>{packet.proposedAction.kind}</dd>
          {Object.entries(packet.proposedAction.fields ?? {}).map(([key, value]) => (
            <Fragment key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className="packet__section">
        <h3 className="packet__heading">Routing decision</h3>
        <p className="packet__summary">{packet.routingDecision.rationale}</p>
        <dl className="kv">
          <dt>Outcome</dt>
          <dd>{packet.routingDecision.outcome}</dd>
          <dt>Tier</dt>
          {/*
            A refusal has no tier, and the packet carries an explicit null for it. "Refused, so no
            tier was selected" and "the field is missing" are different facts, and an em dash that
            stands for both teaches an approver to stop asking which one they are looking at.
          */}
          <dd>{packet.routingDecision.selectedTier ?? 'None — no model was selected'}</dd>
          <dt>Vendor</dt>
          <dd>{packet.routingDecision.selectedVendor ?? 'None — no model was selected'}</dd>
          <dt>Complexity score</dt>
          <dd>{packet.routingDecision.complexityScore}</dd>
          <dt>Cost ceiling</dt>
          <dd>{formatUsd(packet.routingDecision.costCeilingUsd)}</dd>
          <dt>Policy set</dt>
          <dd>
            {packet.routingDecision.policySetId
              ? `${packet.routingDecision.policySetId} v${packet.routingDecision.policySetVersion ?? '?'}`
              : 'None recorded'}
          </dd>
        </dl>
      </section>

      {inputs.length > 0 && (
        <section className="packet__section">
          <h3 className="packet__heading">Inputs</h3>
          <dl className="kv">
            {inputs.map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}

      <section className="packet__section">
        <h3 className="packet__heading">Retrieved sources ({sources.length})</h3>
        {sources.length === 0 ? (
          <p className="packet__empty">
            No sources were retrieved for this proposal. Nothing here rests on retrieved evidence.
          </p>
        ) : (
          <ul className="sources">
            {sources.map((source) => (
              <li key={source.chunkId} className="sources__item">
                <span className="sources__id">
                  {source.documentId} · {source.chunkId}
                </span>
                <span className="sources__score">score {source.score.toFixed(2)}</span>
                <blockquote className="sources__excerpt">{source.excerpt}</blockquote>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Always present, including when empty. A panel that appears only on failure teaches the
        audience it is an error state; a panel that is always there teaches them it is a control.
        This is the same rule the research screen follows, and it matters more here, because this
        is the screen where somebody accepts accountability for the output.
      */}
      <section className="packet__section packet__section--claims">
        <h3 className="packet__heading">Unattributable claims ({unattributable.length})</h3>
        {unattributable.length === 0 ? (
          <p className="packet__empty">
            No unattributable claims. Every claim in this packet traces to retrieved evidence.
          </p>
        ) : (
          <ul className="claims">
            {unattributable.map((claim) => (
              <li key={claim} className="claims__item">
                {claim}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}
