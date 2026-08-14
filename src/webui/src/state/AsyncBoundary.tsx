import type { ReactNode } from 'react';
import type { AsyncState } from './asyncState';
import { formatFreshness, isStale } from './asyncState';

interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
  /** What this screen is showing, used in the empty and error copy. */
  label: string;
}

/**
 * Renders the correct state for every screen, so no screen has to remember all six.
 *
 * Partial and degraded render the data *and* a qualifying banner rather than replacing the data
 * with a warning: the audience still needs to see the result, and the presenter still needs to be
 * able to say what is wrong with it without leaving the screen.
 */
export function AsyncBoundary<T>({ state, children, label }: AsyncBoundaryProps<T>) {
  switch (state.status) {
    case 'loading':
      return (
        <div className="state state--loading" role="status" aria-live="polite">
          <span className="state__title">Loading {label}…</span>
        </div>
      );

    case 'empty':
      return (
        <div className="state state--empty">
          <span className="state__title">No {label} yet</span>
          <p className="state__detail">{state.message}</p>
        </div>
      );

    case 'error':
      return (
        <div className="state state--error" role="alert">
          <span className="state__title">Could not load {label}</span>
          <p className="state__detail">{state.message}</p>
          {state.retry && (
            <button type="button" className="button" onClick={state.retry}>
              Retry
            </button>
          )}
        </div>
      );

    case 'partial':
      return (
        <>
          <Banner
            tone="warning"
            title={`Showing ${label} with ${state.missing.length} item(s) missing`}
            detail={state.missing.join(', ')}
          />
          <FreshnessLine state={state} />
          {children(state.data)}
        </>
      );

    case 'degraded':
      return (
        <>
          <Banner tone="warning" title="Degraded data source" detail={state.reason} />
          <FreshnessLine state={state} />
          {children(state.data)}
        </>
      );

    case 'ready':
      return (
        <>
          <FreshnessLine state={state} />
          {children(state.data)}
        </>
      );
  }
}

function FreshnessLine<T>({
  state,
}: {
  state: Extract<AsyncState<T>, { freshness: { asOf: string } }>;
}) {
  const stale = isStale(state.freshness);
  return (
    <p className={`freshness${stale ? ' freshness--stale' : ''}`}>
      Data as of {formatFreshness(state.freshness)}
      {stale && ' — outside the 5s freshness budget'}
    </p>
  );
}

export function Banner({
  tone,
  title,
  detail,
}: {
  tone: 'warning' | 'danger' | 'info';
  title: string;
  detail?: string;
}) {
  return (
    <div className={`banner banner--${tone}`} role="status">
      <strong>{title}</strong>
      {detail && <span className="banner__detail">{detail}</span>}
    </div>
  );
}
