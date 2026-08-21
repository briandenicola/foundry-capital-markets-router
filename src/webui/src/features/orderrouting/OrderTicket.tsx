import { useState } from 'react';
import type { RouteProposalRequest, VenueQuoteInput } from '../../api/client';
import { Banner } from '../../state/AsyncBoundary';

/**
 * The order entry form.
 *
 * Quotes are entered rather than fetched because there is no market data feed in this demo and
 * there must not be a fabricated one. The router refuses an order with no quotes rather than
 * inventing liquidity, and this form mirrors that: it cannot be submitted empty.
 *
 * Two presets exist so a presenter can reach a routable order and a policy halt without typing
 * during a live run. They are labelled as presets, not disguised as market data.
 */
export function OrderTicket({
  onSubmit,
  submitting,
  failure,
}: {
  onSubmit: (request: RouteProposalRequest) => Promise<void>;
  submitting: boolean;
  failure?: string;
}) {
  const [request, setRequest] = useState<RouteProposalRequest>(routablePreset());

  return (
    <form
      className="ticket"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(request);
      }}
    >
      <h3 className="ticket__heading">Order ticket</h3>

      {failure && <Banner tone="danger" title="The request failed" detail={failure} />}

      <div className="ticket__grid">
        <label className="field">
          <span className="field__label">Order id</span>
          <input
            className="field__input"
            value={request.orderId}
            onChange={(e) => setRequest({ ...request, orderId: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field__label">Symbol</span>
          <input
            className="field__input"
            value={request.symbol}
            onChange={(e) => setRequest({ ...request, symbol: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field__label">Side</span>
          <select
            className="field__input"
            value={request.side}
            onChange={(e) => setRequest({ ...request, side: e.target.value as 'Buy' | 'Sell' })}
          >
            <option value="Buy">Buy</option>
            <option value="Sell">Sell</option>
          </select>
        </label>

        <label className="field">
          <span className="field__label">Quantity</span>
          <input
            className="field__input"
            type="number"
            min={1}
            value={request.quantity}
            onChange={(e) => setRequest({ ...request, quantity: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span className="field__label">Limit price</span>
          <input
            className="field__input"
            type="number"
            step="0.01"
            value={request.limitPrice ?? 0}
            onChange={(e) => setRequest({ ...request, limitPrice: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span className="field__label">Arrival mid</span>
          <input
            className="field__input"
            type="number"
            step="0.01"
            value={request.arrivalMidPrice}
            onChange={(e) => setRequest({ ...request, arrivalMidPrice: Number(e.target.value) })}
          />
        </label>
      </div>

      <p className="ticket__quotes">
        {request.quotes.length} venue quote{request.quotes.length === 1 ? '' : 's'}:{' '}
        {request.quotes.map((q) => q.venueCode).join(', ') || 'none — the router will refuse'}
      </p>

      <div className="ticket__actions">
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? 'Routing…' : 'Propose route'}
        </button>
        <button
          type="button"
          className="button"
          disabled={submitting}
          onClick={() => setRequest(routablePreset())}
        >
          Preset: routable
        </button>
        <button
          type="button"
          className="button"
          disabled={submitting}
          onClick={() => setRequest(haltPreset())}
        >
          Preset: policy halt
        </button>
      </div>
    </form>
  );
}

const litVenues: VenueQuoteInput[] = [
  { venueCode: 'XLIT', type: 'Lit', midPrice: 100, spread: 0.05, displayedLiquidity: 250_000, feeBps: 0.2 },
  { venueCode: 'XMER', type: 'Lit', midPrice: 100.01, spread: 0.08, displayedLiquidity: 90_000, feeBps: 0.15 },
  { venueCode: 'XNOR', type: 'Lit', midPrice: 99.99, spread: 0.12, displayedLiquidity: 40_000, feeBps: 0.1 },
];

function routablePreset(): RouteProposalRequest {
  return {
    orderId: 'ORD-1041',
    symbol: 'CONT',
    side: 'Buy',
    quantity: 12_000,
    limitPrice: 101,
    arrivalMidPrice: 100,
    quotes: litVenues,
  };
}

/**
 * A small order offered only a dark venue.
 *
 * Chosen because the resulting halt names a boundary an audience understands without a glossary:
 * the order is below the dark-pool minimum, so there is nowhere it may legitimately go.
 */
function haltPreset(): RouteProposalRequest {
  return {
    orderId: 'ORD-1042',
    symbol: 'CONT',
    side: 'Buy',
    quantity: 400,
    limitPrice: 101,
    arrivalMidPrice: 100,
    quotes: [
      {
        venueCode: 'DARK-1',
        type: 'Dark',
        midPrice: 100,
        spread: 0.02,
        displayedLiquidity: 0,
        feeBps: 0.1,
      },
    ],
  };
}
