import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { ClsStore as BaseClsStore } from 'nestjs-cls';
import { TenantRequiredError } from '../common/errors/app-error';

export const TENANT_SCOPE_KEY = 'scope';
export const CLS_REQUEST_ID = 'requestId';

export interface TenantScope {
  organizationId: string | null;
  userId: string | null;
  sessionId: string | null;
  roles: string[];
  /** Effective permissions (resolved from roles at auth time). */
  permissions: string[];
  requestId: string;
  /** True inside audited platform jobs (worker, migrations) that may touch multiple orgs. */
  isPlatformJob: boolean;
  /**
   * Break-glass / emergency access marker when set; only populated by the
   * emergency-access flow (Phase 1+). Never set implicitly.
   */
  emergency?: boolean;
  /**
   * Patient-participant self-scope: set for a PATIENT principal authenticated
   * through the patient portal; it is the patient id whose record that
   * principal may read/write. Null for staff principals. Enforcement lives in
   * the patient ownership policy (PATIENT_ACCESS_DENIED).
   */
  patientId?: string | null;
  /**
   * Display-device scope: set only by DeviceAuthGuard for unattended waiting-
   * room displays. Carries the device id and the branch/departments it may
   * stream. Enforcement is writer-side, never trusted from the wire.
   */
  device?: {
    deviceId: string;
    branchId: string;
    departmentIds: string[];
  } | null;
}

export interface ClsStore extends BaseClsStore {
  scope: TenantScope | undefined;
  requestId?: string;
}

export const EMPTY_SCOPE: TenantScope = Object.freeze({
  organizationId: null,
  userId: null,
  sessionId: null,
  roles: [],
  permissions: [],
  requestId: '',
  isPlatformJob: false,
  patientId: null,
  device: null,
});

/**
 * Central accessor for the per-request tenant context stored in AsyncLocalStorage.
 * Guards/decorators populate it from the verified token; services read it. The
 * tenant-scoped Prisma extension refuses tenant queries when it is absent.
 */
@Injectable()
export class TenantContext {
  constructor(private readonly cls: ClsService<ClsStore>) {}

  get scope(): TenantScope {
    return this.cls.get(TENANT_SCOPE_KEY) ?? EMPTY_SCOPE;
  }

  hasOrg(): boolean {
    return this.scope.organizationId !== null;
  }

  requireOrg(): string {
    const org = this.scope.organizationId;
    if (org === null) {
      throw new TenantRequiredError();
    }
    return org;
  }

  requireUserId(): string {
    const userId = this.scope.userId;
    if (userId === null) {
      throw new TenantRequiredError();
    }
    return userId;
  }

  setScope(scope: Partial<TenantScope>): void {
    this.cls.set(TENANT_SCOPE_KEY, { ...this.scope, ...scope });
  }

  isPlatformJob(): boolean {
    return this.scope.isPlatformJob;
  }
}
