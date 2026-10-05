import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

/**
 * Browser-side MSW worker.
 *
 * Kept in its own module so `./index` can import it dynamically. That is what
 * keeps the service worker and the whole handler bundle out of the production
 * JavaScript, rather than shipping them and relying on a runtime flag to no-op.
 */
export const worker = setupWorker(...handlers);
