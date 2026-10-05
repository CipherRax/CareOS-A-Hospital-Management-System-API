'use client';

import { useEffect, useState } from 'react';

import { enableMocking } from './index';

/**
 * Starts the MSW worker in the browser.
 *
 * Mounted only when NEXT_PUBLIC_ENABLE_MOCKS is on, which is a build-time
 * constant — so in a production build this component is never rendered and the
 * worker is never bundled.
 *
 * Children are withheld until the worker is running. Rendering first and starting
 * mocks afterwards produces a burst of real requests on first paint, which is both
 * noisy and a confusing thing to debug.
 */
export function MockProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    enableMocking().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <p className="p-6 text-body text-secondary" role="status">
        Starting mock API…
      </p>
    );
  }

  return <>{children}</>;
}
