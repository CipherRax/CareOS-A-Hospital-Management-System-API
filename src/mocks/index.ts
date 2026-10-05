/**
 * Mock bootstrap.
 *
 * Call `enableMocking()` from a client entry point. It returns immediately unless
 * NEXT_PUBLIC_ENABLE_MOCKS is set, so production never loads the worker — and
 * `src/lib/env.ts` additionally throws at module load if mocks are enabled while
 * NODE_ENV=production, so a misconfigured deployment fails the build rather than
 * serving fabricated clinical data to real users.
 */
export async function enableMocking(): Promise<void> {
  const { publicEnv } = await import('@/lib/env');
  if (!publicEnv.enableMocks) return;

  const { worker } = await import('./browser');
  await worker.start({
    // An unhandled request means a handler is missing, which is a contract gap
    // that should surface in development rather than hit the network.
    onUnhandledRequest: 'bypass',
    quiet: false,
  });
}

export { handlers } from './handlers';
