import { http, HttpResponse } from 'msw';

import {
  INSURANCE_CLAIMS,
  INSURANCE_PAYERS,
  INSURANCE_POLICIES,
  INSURANCE_ORGANIZATION_ID,
  type RegistryInsuranceClaim,
  type RegistryInsurancePayer,
  type RegistryInsurancePolicy,
} from '@/mocks/fixtures/insurance-registry';
import { BILLING_INVOICES } from '@/mocks/fixtures/billing-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F7 insurance handlers (payers, policies and claims).
 *
 * State is a deep clone of the claim fixtures, mutable for the length of the mock
 * session: submitting, approving, denying and paying all move the same records
 * the worklist reads back. Money stays decimal strings and is never arithmetic'd.
 *
 * The lifecycle guards mirror the service (`CLAIM_ALLOWED_FROM`): DRAFT→SUBMITTED,
 * SUBMITTED→APPROVED|PARTIALLY_APPROVED|DENIED, APPROVED|PARTIALLY_APPROVED→PAID.
 * A create validates the policy's patient against the invoice and the claim
 * amount against the invoice total. Every write answers the `{ claim }` envelope
 * the service uses while the export types the bare entity (GAP-020).
 *
 * One deliberate simplification: a real `pay` posts an INSURANCE payment against
 * the invoice and moves the invoice balance. This mock moves the claim to PAID
 * only — the invoice ledger is owned by the billing handlers and the two modules
 * do not share mutable state.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const claims: Mutable<RegistryInsuranceClaim>[] = INSURANCE_CLAIMS.map((claim) => ({ ...claim }));
const payers: Mutable<RegistryInsurancePayer>[] = INSURANCE_PAYERS.map((payer) => ({ ...payer }));
const policies: Mutable<RegistryInsurancePolicy>[] = INSURANCE_POLICIES.map((policy) => ({
  ...policy,
}));
let claimSeq = 7;
let payerSeq = 3;
let policySeq = 4;

function notFound(message = 'Insurance claim not found') {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 });
}

function workflowConflict(message: string) {
  return HttpResponse.json(apiError('INVALID_WORKFLOW_TRANSITION', message), { status: 409 });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const MONEY = /^\d+(\.\d{1,2})?$/;

function toCents(value: string): number {
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

function findClaim(id: string): Mutable<RegistryInsuranceClaim> | undefined {
  return claims.find((claim) => claim.id === id);
}

export function insuranceHandlers() {
  return [
    http.get('*/api/v1/insurance/payers', async () => {
      await delay(MOCK_LATENCY_MS);
      return HttpResponse.json(apiPage(payers.map((payer) => ({ ...payer }))));
    }),

    http.post('*/api/v1/insurance/payers', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const name = stringField(body?.name);
      if (!name) return validationError('A payer name is required.');
      if (payers.some((payer) => payer.name === name)) {
        return HttpResponse.json(apiError('CONFLICT', 'A payer with this name already exists.'), {
          status: 409,
        });
      }
      const now = new Date().toISOString();
      const payer: Mutable<RegistryInsurancePayer> = {
        id: `payer_example_${6000 + payerSeq}`,
        organizationId: INSURANCE_ORGANIZATION_ID,
        name,
        contactPhone: stringField(body?.contactPhone),
        email: stringField(body?.email),
        isActive: body?.isActive === false ? false : true,
        createdAt: now,
        updatedAt: now,
      };
      payerSeq += 1;
      payers.push(payer);
      return HttpResponse.json(apiOk({ payer }, 'req_mock_payer_create'), { status: 201 });
    }),

    http.get('*/api/v1/insurance/policies', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const patientId = url.searchParams.get('patientId');
      const payerId = url.searchParams.get('payerId');
      const filtered = policies.filter((policy) => {
        if (patientId && policy.patientId !== patientId) return false;
        if (payerId && policy.payerId !== payerId) return false;
        return true;
      });
      return HttpResponse.json(apiPage(filtered.map((policy) => ({ ...policy }))));
    }),

    http.post('*/api/v1/insurance/policies', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const patientId = stringField(body?.patientId);
      const payerId = stringField(body?.payerId);
      const policyNumber = stringField(body?.policyNumber);
      if (!patientId || !payerId || !policyNumber) return validationError('Invalid policy.');
      const payer = payers.find((row) => row.id === payerId && row.isActive);
      if (!payer) return notFound('Payer not found');

      const coverageType = body?.coverageType === 'FULL' ? 'FULL' : 'PARTIAL';
      const rawPercent = body?.coveragePercent;
      if (coverageType === 'PARTIAL' && typeof rawPercent !== 'number') {
        return validationError('coveragePercent is required for a PARTIAL coverage policy.');
      }
      const coveragePercent =
        typeof rawPercent === 'number' ? rawPercent : coverageType === 'FULL' ? 100 : 0;

      const now = new Date().toISOString();
      const policy: Mutable<RegistryInsurancePolicy> = {
        id: `pol_example_${7000 + policySeq}`,
        organizationId: INSURANCE_ORGANIZATION_ID,
        patientId,
        payerId,
        policyNumber,
        coverageType,
        coveragePercent,
        validityStart: stringField(body?.validityStart),
        validityEnd: stringField(body?.validityEnd),
        isActive: body?.isActive === false ? false : true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      policySeq += 1;
      policies.push(policy);
      return HttpResponse.json(apiOk({ policy }, 'req_mock_policy_create'), { status: 201 });
    }),

    http.get('*/api/v1/insurance/claims', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const invoiceId = url.searchParams.get('invoiceId');
      const patientId = url.searchParams.get('patientId');
      const status = url.searchParams.get('status');
      const filtered = claims.filter((claim) => {
        if (invoiceId && claim.invoiceId !== invoiceId) return false;
        if (patientId && claim.patientId !== patientId) return false;
        if (status && claim.status !== status) return false;
        return true;
      });
      return HttpResponse.json(apiPage(filtered.map((claim) => ({ ...claim }))));
    }),

    http.post('*/api/v1/insurance/claims', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const invoiceId = stringField(body?.invoiceId);
      const policyId = stringField(body?.policyId);
      const invoice = BILLING_INVOICES.find((row) => row.id === invoiceId);
      if (!invoice) return notFound('Invoice not found');
      const policy = policies.find((row) => row.id === policyId && row.isActive);
      if (!policy) return notFound('Insurance policy not found');
      if (policy.patientId !== invoice.patientId) {
        return validationError('The policy belongs to a different patient than the invoice.');
      }

      const amount = stringField(body?.amount) ?? invoice.total;
      if (!MONEY.test(amount)) return validationError('The claim amount is not a valid amount.');
      if (toCents(amount) > toCents(invoice.total)) {
        return validationError('A claim cannot exceed the invoice total.');
      }

      const now = new Date().toISOString();
      const claim: Mutable<RegistryInsuranceClaim> = {
        id: `claim_example_${5000 + claimSeq}`,
        organizationId: invoice.organizationId,
        claimNumber: `CLM-2026-${String(claimSeq).padStart(6, '0')}`,
        invoiceId: invoice.id,
        policyId: policy.id,
        patientId: invoice.patientId,
        amount,
        status: 'DRAFT',
        notes: stringField(body?.notes),
        submittedAt: null,
        approvedAt: null,
        approvedAmount: null,
        deniedAt: null,
        denyReason: null,
        paidAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      claimSeq += 1;
      claims.push(claim);
      return HttpResponse.json(apiOk({ claim }, 'req_mock_claim_create'), { status: 201 });
    }),

    http.post('*/api/v1/insurance/claims/:id/action', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const claim = findClaim(String(params.id));
      if (!claim) return notFound();
      const body = await readJson(request);
      const action = stringField(body?.action);
      const now = new Date().toISOString();

      if (action === 'submit') {
        if (claim.status !== 'DRAFT') return workflowConflict('Only a draft claim can be submitted.');
        claim.status = 'SUBMITTED';
        claim.submittedAt = now;
      } else if (action === 'approve') {
        if (claim.status !== 'SUBMITTED') return workflowConflict('Only a submitted claim can be approved.');
        const approved = stringField(body?.approvedAmount) ?? claim.amount;
        if (!MONEY.test(approved)) return validationError('The approved amount is not a valid amount.');
        if (toCents(approved) > toCents(claim.amount)) {
          return validationError('An approved amount cannot exceed the claim amount.');
        }
        if (toCents(approved) < toCents(claim.amount)) {
          return validationError('For a partial approval use the partial_approve action.');
        }
        claim.status = 'APPROVED';
        claim.approvedAmount = approved;
        claim.approvedAt = now;
      } else if (action === 'partial_approve') {
        if (claim.status !== 'SUBMITTED') {
          return workflowConflict('Only a submitted claim can be partially approved.');
        }
        const approved = stringField(body?.approvedAmount);
        if (!approved || !MONEY.test(approved)) {
          return validationError('partial_approve requires an approved amount.');
        }
        if (toCents(approved) >= toCents(claim.amount) || toCents(approved) <= 0) {
          return validationError('The approved amount must be below the claim amount.');
        }
        claim.status = 'PARTIALLY_APPROVED';
        claim.approvedAmount = approved;
        claim.approvedAt = now;
      } else if (action === 'deny') {
        if (claim.status !== 'SUBMITTED') return workflowConflict('Only a submitted claim can be denied.');
        const reason = stringField(body?.reason);
        if (!reason) return validationError('A deny reason is required.');
        claim.status = 'DENIED';
        claim.denyReason = reason;
        claim.deniedAt = now;
      } else if (action === 'pay') {
        if (claim.status !== 'APPROVED' && claim.status !== 'PARTIALLY_APPROVED') {
          return workflowConflict('Only an approved claim can be paid.');
        }
        claim.status = 'PAID';
        claim.paidAt = now;
      } else {
        return validationError('Unknown claim action.');
      }

      claim.version += 1;
      claim.updatedAt = now;
      return HttpResponse.json(apiOk({ claim }, 'req_mock_claim_action'));
    }),

    http.get('*/api/v1/insurance/claims/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const claim = findClaim(String(params.id));
      if (!claim) return notFound();
      return HttpResponse.json(apiOk({ claim }, 'req_mock_claim'));
    }),
  ];
}
