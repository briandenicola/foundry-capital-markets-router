import { describe, it, expect } from 'vitest';
import {
  ALL_STATUSES,
  dataOr,
  formatFreshness,
  hasData,
  isStale,
  needsQualification,
  type AsyncState,
} from './asyncState';

const now = new Date('2026-09-10T14:00:00Z');
const fresh = { asOf: '2026-09-10T13:59:58Z' };
const old = { asOf: '2026-09-10T13:59:00Z' };

describe('async state primitives', () => {
  it('declares all six states the design requires', () => {
    expect(ALL_STATUSES).toEqual(['loading', 'empty', 'error', 'ready', 'partial', 'degraded']);
  });

  it('treats partial and degraded as data-bearing', () => {
    const partial: AsyncState<number[]> = {
      status: 'partial',
      data: [1, 2],
      missing: ['alert-0003'],
      freshness: fresh,
    };
    const degraded: AsyncState<number[]> = {
      status: 'degraded',
      data: [1],
      reason: 'change feed fallback',
      freshness: fresh,
    };

    expect(hasData(partial)).toBe(true);
    expect(hasData(degraded)).toBe(true);
    expect(dataOr(partial, [])).toEqual([1, 2]);
  });

  it('does not treat empty and error as data-bearing', () => {
    expect(hasData({ status: 'empty', message: 'none' })).toBe(false);
    expect(hasData({ status: 'error', message: 'boom' })).toBe(false);
    expect(dataOr<number[]>({ status: 'error', message: 'boom' }, [])).toEqual([]);
  });

  it('flags partial and degraded as needing qualification, ready as not', () => {
    expect(needsQualification({ status: 'partial', data: 1, missing: [], freshness: fresh })).toBe(true);
    expect(needsQualification({ status: 'degraded', data: 1, reason: 'x', freshness: fresh })).toBe(true);
    expect(needsQualification({ status: 'ready', data: 1, freshness: fresh })).toBe(false);
  });

  it('measures staleness against the five-second budget', () => {
    expect(isStale(fresh, now)).toBe(false);
    expect(isStale(old, now)).toBe(true);
  });

  it('renders freshness as an age, and names a fallback source when there is one', () => {
    expect(formatFreshness(fresh, now)).toBe('2s ago');
    expect(formatFreshness({ ...old, source: 'Cosmos change feed' }, now)).toBe(
      '1m ago · Cosmos change feed',
    );
  });
});
