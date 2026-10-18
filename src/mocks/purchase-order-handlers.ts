import { http, HttpResponse } from 'msw';

import {
  PROCUREMENT_SUPPLIERS,
  PURCHASE_ORDERS,
} from '@/mocks/fixtures/purchase-order-registry';
import { apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F6 procurement handlers (purchase-order worklist).
 *
 * `GET /purchase-orders` is served as the service answers it — a page of
 * serialized orders under the unwrapped `data`, with the totals in the sibling
 * `meta` — not as the export types it (the *query* DTO, GAP-020). The supplier
 * read is the name lookup the list needs; nothing here writes, because the
 * contract's three writes are not built yet.
 */
export function purchaseOrderHandlers() {
  return [
    http.get('*/api/v1/purchase-orders', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '25') || 25));

      const filtered = PURCHASE_ORDERS.filter((order) => !status || order.status === status);
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/suppliers', async () => {
      await delay(MOCK_LATENCY_MS);
      return HttpResponse.json(apiPage(PROCUREMENT_SUPPLIERS));
    }),
  ];
}
