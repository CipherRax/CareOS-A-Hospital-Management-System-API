import { Prisma } from '@prisma/client';
import { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  scopeGuard,
  toPublicAppointment,
  toPublicLabResult,
  toPublicPatient,
} from '../../../src/modules/portal/domain/portal';

describe('portal: scopeGuard', () => {
  it('returns the patient id when a self-scope is present', () => {
    expect(scopeGuard('patient-1')).toBe('patient-1');
  });

  it('denies the request when there is no patient self-scope', () => {
    for (const value of [null, undefined]) {
      try {
        scopeGuard(value);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCodes.PATIENT_ACCESS_DENIED);
      }
    }
  });
});

describe('portal: toPublicPatient allowlist', () => {
  it('returns only the documented safe profile fields', () => {
    const patient = {
      id: 'patient-1',
      organizationId: 'org-1',
      patientNumber: 'PAT-2026-000001',
      firstName: 'Ada',
      lastName: 'Lovelace',
      otherNames: 'Augusta',
      dateOfBirth: new Date('1815-12-10'),
      sex: 'FEMALE',
      phone: '0700000000',
      email: 'ada@example.com',
      address: '12 Analytical Engine Street',
      county: 'Nairobi',
      town: 'Nairobi',
      photoUrl: 'https://cdn.example/ada.png',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      allergies: ['penicillin'],
      medicalHistory: [{ condition: 'cardiac' }],
      mergedIntoPatientId: null,
    };
    const out = toPublicPatient(patient as unknown as Parameters<typeof toPublicPatient>[0]);

    expect(out).toEqual({
      id: 'patient-1',
      patientNumber: 'PAT-2026-000001',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: new Date('1815-12-10'),
      phone: '0700000000',
      email: 'ada@example.com',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining([
        'id',
        'patientNumber',
        'firstName',
        'lastName',
        'dateOfBirth',
        'phone',
        'email',
        'status',
        'createdAt',
      ]),
    );
    expect(out).not.toHaveProperty('allergies');
    expect(out).not.toHaveProperty('medicalHistory');
    expect(out).not.toHaveProperty('address');
    expect(out).not.toHaveProperty('organizationId');
  });
});

describe('portal: toPublicAppointment allowlist', () => {
  it('exposes providerId as an opaque id and never leaks patient/identity data', () => {
    const appointment = {
      id: 'appt-1',
      organizationId: 'org-1',
      branchId: 'branch-1',
      departmentId: 'dept-1',
      patientId: 'patient-1',
      providerId: 'user-provider-9',
      createdById: 'user-staff-1',
      startsAt: new Date('2026-02-01T09:00:00Z'),
      endsAt: new Date('2026-02-01T09:30:00Z'),
      mode: 'IN_PERSON',
      reason: 'Annual check-up',
      status: 'BOOKED',
      createdAt: new Date('2026-01-20T00:00:00Z'),
      version: 0,
    };
    const out = toPublicAppointment(appointment as unknown as Parameters<typeof toPublicAppointment>[0]);

    expect(out).toEqual({
      id: 'appt-1',
      departmentId: 'dept-1',
      providerId: 'user-provider-9',
      startsAt: new Date('2026-02-01T09:00:00Z'),
      endsAt: new Date('2026-02-01T09:30:00Z'),
      mode: 'IN_PERSON',
      status: 'BOOKED',
      reason: 'Annual check-up',
    });
    expect(out).not.toHaveProperty('patientId');
    expect(out).not.toHaveProperty('createdById');
    expect(out).not.toHaveProperty('branchId');
    expect(out).not.toHaveProperty('organizationId');
  });
});

describe('portal: toPublicLabResult', () => {
  it('projects value/reference fields and stamps only ids/timestamps', () => {
    const out = toPublicLabResult({
      id: 'result-1',
      orderId: 'order-1',
      itemId: 'item-1',
      testId: 'test-1',
      testName: 'Glucose',
      value: '5.4',
      unit: 'mmol/L',
      referenceMin: new Prisma.Decimal('3.9'),
      referenceMax: '6.1',
      isAbnormal: false,
      isCritical: false,
      verifiedAt: new Date('2026-03-01T10:00:00Z'),
      releasedAt: new Date('2026-03-01T10:05:00Z'),
    });

    expect(out).toEqual({
      id: 'result-1',
      orderId: 'order-1',
      itemId: 'item-1',
      testId: 'test-1',
      testName: 'Glucose',
      value: '5.4',
      unit: 'mmol/L',
      referenceMin: '3.9',
      referenceMax: '6.1',
      isAbnormal: false,
      isCritical: false,
      verifiedAt: new Date('2026-03-01T10:00:00Z'),
      releasedAt: new Date('2026-03-01T10:05:00Z'),
    });
    expect(out).not.toHaveProperty('organizationId');
    expect(out).not.toHaveProperty('patientId');
    expect(out).not.toHaveProperty('orderItemId');
  });

  it('keeps missing reference ranges as null', () => {
    const out = toPublicLabResult({
      id: 'result-2',
      orderId: 'order-2',
      itemId: 'item-2',
      testId: 'test-2',
      testName: 'HIV',
      value: 'Negative',
      unit: null,
      referenceMin: null,
      referenceMax: null,
      isAbnormal: false,
      isCritical: false,
      verifiedAt: null,
      releasedAt: null,
    });
    expect(out.referenceMin).toBeNull();
    expect(out.referenceMax).toBeNull();
    expect(out.verifiedAt).toBeNull();
    expect(out.releasedAt).toBeNull();
  });
});