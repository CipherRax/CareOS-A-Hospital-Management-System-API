import { BillingWorklistScreen } from '@/components/staff/billing-worklist';

/**
 * /billing — invoices desk (F7).
 *
 * `GET /invoices` is a thin projection whose 200 is mis-typed as the request DTO
 * (GAP-020), so rows are validated structurally in `src/lib/data/billing.ts`.
 * Rows carry only `patientId`; names resolve on demand (GAP-018).
 */
export default function BillingPage() {
  return <BillingWorklistScreen />;
}
