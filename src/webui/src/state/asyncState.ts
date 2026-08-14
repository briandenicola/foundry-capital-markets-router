/**
 * The five states every screen must handle, plus the one it hopes for.
 *
 * They are modelled as a discriminated union rather than a set of booleans because
 * `isLoading && !error && data?.length` is how a screen ends up rendering an empty table that
 * looks like a working table with no results. On a projector, in front of an audience, "we have
 * no data" and "we could not reach the data" must never look the same.
 */

export interface Freshness {
  /** ISO 8601. Rendered as a visible timestamp, never as a spinner. */
  asOf: string;
  /** Where the number came from. Shown when it is not the primary source. */
  source?: string;
}

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'ready'; data: T; freshness: Freshness }
  /**
   * Some of the answer, and an explicit list of what is missing.
   *
   * Required because the lanes can partially fail: a surveillance batch may triage 480 of 500
   * alerts. Rendering 480 as though it were the whole batch is the failure mode that matters
   * most here, because the number looks entirely plausible.
   */
  | { status: 'partial'; data: T; missing: string[]; freshness: Freshness }
  /**
   * A complete answer from a fallback *source* -- never from a fallback *reasoner*.
   *
   * ADR-007 draws the line this state must not cross: re-reading real evidence by another path is
   * permitted, substituting recorded reasoning for live reasoning is not. `degraded` is for the
   * former only. A lane must never report `degraded` because the agent could not run; that is an
   * `error`, and it must say which dependency failed.
   *
   * The scoreboard reads Application Insights and falls back to the Cosmos change feed when the
   * five-second freshness budget cannot be met. The audience is told which one they are looking
   * at, because a governance demo that hides its own degradation is arguing against itself.
   */
  | { status: 'degraded'; data: T; reason: string; freshness: Freshness };

export type AsyncStatus = AsyncState<unknown>['status'];

export const ALL_STATUSES: readonly AsyncStatus[] = [
  'loading',
  'empty',
  'error',
  'ready',
  'partial',
  'degraded',
] as const;

/** True when the state carries data a screen can render. */
export function hasData<T>(
  state: AsyncState<T>,
): state is Extract<AsyncState<T>, { data: T }> {
  return state.status === 'ready' || state.status === 'partial' || state.status === 'degraded';
}

/** Data if present, otherwise a caller-supplied fallback. Never throws. */
export function dataOr<T>(state: AsyncState<T>, fallback: T): T {
  return hasData(state) ? state.data : fallback;
}

/**
 * True when the screen is showing something it must qualify out loud.
 * Drives the banner; also drives whether a screenshot of this screen is honest on its own.
 */
export function needsQualification<T>(state: AsyncState<T>): boolean {
  return state.status === 'partial' || state.status === 'degraded';
}

export function formatFreshness(freshness: Freshness, now: Date = new Date()): string {
  const asOf = new Date(freshness.asOf);
  const seconds = Math.max(0, Math.round((now.getTime() - asOf.getTime()) / 1000));
  const age = seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  return freshness.source ? `${age} · ${freshness.source}` : age;
}

/**
 * The freshness budget the scoreboard acceptance criterion names. Anything older is stale and
 * the UI says so rather than quietly showing an old number as a current one.
 */
export const FRESHNESS_BUDGET_SECONDS = 5;

export function isStale(freshness: Freshness, now: Date = new Date()): boolean {
  const asOf = new Date(freshness.asOf);
  return (now.getTime() - asOf.getTime()) / 1000 > FRESHNESS_BUDGET_SECONDS;
}
