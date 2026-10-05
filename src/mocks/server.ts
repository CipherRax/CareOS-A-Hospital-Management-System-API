import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * Node-side MSW server for tests. Starts in `src/test/setup.ts` so every test
 * runs against the mocked API by default — a test that reaches the real network
 * is a flaky test.
 */
export const server = setupServer(...handlers);
