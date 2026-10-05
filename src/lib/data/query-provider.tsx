'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Query client provider.
 *
 * Defaults chosen for a clinical product, where a stale read is worse than a slow
 * one and a wrong one is worse than both:
 *
 *  - `staleTime` non-zero so navigating between two screens does not refetch the
 *    same patient list twice.
 *  - `retry` skips 4xx entirely. A 401 or a 403 is a decision, not a blip, and
 *    retrying it just delays the honest "you are not signed in" state. Only 5xx
 *    and network failures are worth a second attempt.
 *  - `refetchOnWindowFocus` on. A triage queue left open on a second monitor must
 *    not show a queue that was correct an hour ago.
 *  - No caching of responses the server marked private; `cache: 'no-store'` on the
 *    proxy means nothing sensitive is written to disk by the platform cache.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // useState, not a module-level singleton: a client shared across requests would
  // leak one clinician's cached data into another's session on the server.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              if (typeof status === 'number' && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // Never auto-retry a write. A retried clinical submission can create a
            // duplicate record, and a duplicate patient record is a serious event.
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
