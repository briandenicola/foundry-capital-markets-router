import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AsyncBoundary } from './AsyncBoundary';
import type { AsyncState } from './asyncState';

const freshness = { asOf: new Date().toISOString() };

function renderState(state: AsyncState<string[]>) {
  return render(
    <AsyncBoundary state={state} label="decisions">
      {(data) => <ul>{data.map((d) => <li key={d}>{d}</li>)}</ul>}
    </AsyncBoundary>,
  );
}

describe('AsyncBoundary', () => {
  it('distinguishes empty from error', () => {
    const { unmount } = renderState({ status: 'empty', message: 'Submit a request to begin.' });
    expect(screen.getByText('No decisions yet')).toBeInTheDocument();
    unmount();

    renderState({ status: 'error', message: 'Router unreachable.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load decisions');
  });

  it('still renders the data when partial, and names what is missing', () => {
    renderState({
      status: 'partial',
      data: ['a', 'b'],
      missing: ['alert-0003'],
      freshness,
    });

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText(/1 item\(s\) missing/)).toBeInTheDocument();
    expect(screen.getByText('alert-0003')).toBeInTheDocument();
  });

  it('still renders the data when degraded, and says why', () => {
    renderState({
      status: 'degraded',
      data: ['a'],
      reason: 'Application Insights exceeded the freshness budget; using the Cosmos change feed.',
      freshness,
    });

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('Degraded data source')).toBeInTheDocument();
  });

  it('shows a data timestamp rather than a spinner once loaded', () => {
    renderState({ status: 'ready', data: ['a'], freshness });
    expect(screen.getByText(/Data as of/)).toBeInTheDocument();
  });
});
