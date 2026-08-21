import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';

export function QueryProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const queryClient = useMemo(
    () =>
      client ??
      new QueryClient({
        defaultOptions: {
          queries: {
            // A refusal is a decision, not a transient fault, and retrying one is the single
            // behaviour this product must never encourage. Retries are opt-in per query.
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [client],
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
