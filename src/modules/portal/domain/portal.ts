import type { Appointment, Patient, Prisma } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Patient portal (brief Phase 10): self-scoped, pure projection helpers.
 *
 * The scope guard and the projection mappers live here (away from the DB-heavy
 * service) so they are unit-testable in isolation and can never accidentally
 * leak a field that is not on the allowlist.
 */

/** Returns the caller's patient id or denies the request when there is no self-scope. */
export function scopeGuard(scopePatientId: string | null | undefined): string {
  if (!scopePatientId) {
    throw new AppError({
      code: ErrorCodes.PATIENT_ACCESS_DENIED,
      message: 'A patient may only access their own record.',
      silent: true,
    });
  }
  return scopePatientId;
}

export interface PublicPatient {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  phone: string | null;
  email: string | null;
  status: Patient['status'];
  createdAt: Date;
}

/** Safe demographics allowlist. Clinical/extended fields must never be included. */
export function toPublicPatient(p: Patient): PublicPatient {
  return {
    id: p.id,
    patientNumber: p.patientNumber,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth,
    phone: p.phone,
    email: p.email,
    status: p.status,
    createdAt: p.createdAt,
  };
}

export interface PublicAppointment {
  id: string;
  departmentId: string;
  providerId: string;
  startsAt: Date;
  endsAt: Date;
  mode: Appointment['mode'];
  status: Appointment['status'];
  reason: string | null;
}

/** Appointment allowlist. providerId is a user id and is exposed as-is only. */
export function toPublicAppointment(a: Appointment): PublicAppointment {
  return {
    id: a.id,
    departmentId: a.departmentId,
    providerId: a.providerId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    mode: a.mode,
    status: a.status,
    reason: a.reason,
  };
}

export interface PublicLabResult {
  id: string;
  orderId: string;
  itemId: string;
  testId: string;
  testName: string | null;
  value: string;
  unit: string | null;
  referenceMin: string | null;
  referenceMax: string | null;
  isAbnormal: boolean;
  isCritical: boolean;
  verifiedAt: Date | null;
  releasedAt: Date | null;
}

/** Normalised released-result projection (values only, no PHI identifiers). */
export function toPublicLabResult(r: {
  id: string;
  orderId: string;
  itemId: string;
  testId: string;
  testName: string | null;
  value: string;
  unit: string | null;
  referenceMin: Prisma.Decimal | string | null;
  referenceMax: Prisma.Decimal | string | null;
  isAbnormal: boolean;
  isCritical: boolean;
  verifiedAt: Date | null;
  releasedAt: Date | null;
}): PublicLabResult {
  return {
    id: r.id,
    orderId: r.orderId,
    itemId: r.itemId,
    testId: r.testId,
    testName: r.testName,
    value: r.value,
    unit: r.unit,
    referenceMin: referenceToString(r.referenceMin),
    referenceMax: referenceToString(r.referenceMax),
    isAbnormal: r.isAbnormal,
    isCritical: r.isCritical,
    verifiedAt: r.verifiedAt,
    releasedAt: r.releasedAt,
  };
}

function referenceToString(v: Prisma.Decimal | string | null): string | null {
  if (v === null) return null;
  return typeof v === 'string' ? v : v.toString();
}