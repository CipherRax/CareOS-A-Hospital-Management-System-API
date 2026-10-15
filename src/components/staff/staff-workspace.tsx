'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/primitives';
import { AdminActionAlert } from '@/components/staff/admin-alert';
import { USER_STATUS_TONE } from '@/components/staff/users-worklist';
import {
  useBranchOptions,
  useDepartmentList,
  useSetStaffAssignments,
  useStaffMember,
  useUpdateStaff,
} from '@/lib/data/queries';
import {
  EMPLOYMENT_STATUSES,
  displayName,
  type EmploymentStatus,
  type UserStatus,
} from '@/lib/data/admin';
import type { StaffRow } from '@/lib/data/staff';

/**
 * Staff workspace (F9 administration).
 *
 * A staff read answers `{ staff }` while the export types the bare entity
 * (GAP-020), so the body is validated in `src/lib/data/staff.ts`. The profile is
 * edited with `PATCH /staff/{id}`; branch and department assignments are replaced
 * wholesale with `POST /staff/{id}/assignments`, which refuses the entire set if
 * any branch or department does not exist. Identity is owned by the user account
 * and is shown read-only here.
 */

export function StaffWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('admin');
  const staff = useStaffMember(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/staff"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToStaff')}
      </Link>

      {staff.isLoading && !staff.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingStaff')}
        </p>
      ) : staff.error ? (
        <EmptyState
          title={t('staffMemberUnavailableTitle')}
          description={t('staffMemberUnavailableBody')}
          headingLevel={2}
        />
      ) : !staff.data ? (
        <EmptyState
          title={t('staffMemberNotFoundTitle')}
          description={t('staffMemberNotFoundBody')}
          headingLevel={2}
        />
      ) : (
        <StaffBody staff={staff.data.data} />
      )}
    </div>
  );
}

function StaffBody({ staff }: { staff: StaffRow }) {
  const t = useTranslations('admin');
  const update = useUpdateStaff();

  const [professionalTitle, setProfessionalTitle] = useState(staff.professionalTitle ?? '');
  const [specialization, setSpecialization] = useState(staff.specialization ?? '');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>(
    staff.employmentStatus,
  );
  const [licenseNumber, setLicenseNumber] = useState(staff.licenseNumber ?? '');

  const saveProfile = () => {
    update.mutate({
      id: staff.id,
      professionalTitle: professionalTitle.trim() || null,
      specialization: specialization.trim() || null,
      employmentStatus,
      licenseNumber: licenseNumber.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">
          {displayName(staff.user) || staff.user.email}
        </h1>
        <StatusPill
          tone={USER_STATUS_TONE[staff.user.status as UserStatus] ?? 'neutral'}
          label={t(`userStatus.${staff.user.status}`)}
        />
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">{t('staffIdentityHeading')}</h2>
        <dl className="grid grid-cols-1 gap-3 text-meta sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('staffFieldEmail')}</dt>
            <dd className="text-primary">{staff.user.email}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('staffFieldStaffNumber')}</dt>
            <dd className="tabular-nums text-primary">{staff.staffNumber}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('staffFieldAccountStatus')}</dt>
            <dd className="text-primary">{t(`userStatus.${staff.user.status}`)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">{t('staffProfileHeading')}</h2>
        <AdminActionAlert error={update.error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="staff-title" label={t('staffFieldProfessionalTitle')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={professionalTitle}
                onChange={(event) => setProfessionalTitle(event.target.value)}
              />
            )}
          </Field>
          <Field id="staff-specialization" label={t('staffFieldSpecialization')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={specialization}
                onChange={(event) => setSpecialization(event.target.value)}
              />
            )}
          </Field>
          <Field id="staff-employment" label={t('staffFieldEmploymentStatus')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={employmentStatus}
                onChange={(event) => setEmploymentStatus(event.target.value as EmploymentStatus)}
              >
                {EMPLOYMENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`employmentStatus.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="staff-license" label={t('staffFieldLicenseNumber')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={licenseNumber}
                onChange={(event) => setLicenseNumber(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" disabled={update.isPending} onClick={saveProfile}>
            {t('saveStaff')}
          </Button>
        </div>
      </section>

      <AssignmentsEditor staff={staff} />
    </div>
  );
}

function AssignmentsEditor({ staff }: { staff: StaffRow }) {
  const t = useTranslations('admin');
  const branches = useBranchOptions();
  const departments = useDepartmentList();
  const save = useSetStaffAssignments();

  const [branchIds, setBranchIds] = useState<readonly string[]>(
    staff.branches.map((branch) => branch.id),
  );
  const [departmentIds, setDepartmentIds] = useState<readonly string[]>(
    staff.departments.map((department) => department.id),
  );

  const toggleBranch = (id: string) =>
    setBranchIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const toggleDepartment = (id: string) =>
    setDepartmentIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-subheading font-semibold text-primary">
          {t('staffAssignmentsHeading')}
        </h2>
        <p className="text-meta text-secondary">{t('staffAssignmentsIntro')}</p>
      </div>
      <AdminActionAlert error={save.error} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-meta font-medium text-secondary">
            {t('staffBranchesLabel')}
          </legend>
          {branches.isLoading ? (
            <p role="status" className="text-meta text-tertiary">
              {t('loadingBranches')}
            </p>
          ) : (branches.data?.data.length ?? 0) === 0 ? (
            <p className="text-meta text-tertiary">{t('staffNoBranches')}</p>
          ) : (
            branches.data?.data.map((branch) => (
              <CheckboxField
                key={branch.id}
                id={`staff-branch-${branch.id}`}
                label={branch.name}
                description={branch.code}
                checked={branchIds.includes(branch.id)}
                onCheckedChange={() => toggleBranch(branch.id)}
              />
            ))
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-meta font-medium text-secondary">
            {t('staffDepartmentsLabel')}
          </legend>
          {departments.isLoading ? (
            <p role="status" className="text-meta text-tertiary">
              {t('loadingDepartments')}
            </p>
          ) : (departments.data?.data.length ?? 0) === 0 ? (
            <p className="text-meta text-tertiary">{t('staffNoDepartments')}</p>
          ) : (
            departments.data?.data.map((department) => (
              <CheckboxField
                key={department.id}
                id={`staff-department-${department.id}`}
                label={department.name}
                description={department.code ?? undefined}
                checked={departmentIds.includes(department.id)}
                onCheckedChange={() => toggleDepartment(department.id)}
              />
            ))
          )}
        </fieldset>
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate({ id: staff.id, branchIds, departmentIds })}
        >
          {t('saveAssignments')}
        </Button>
      </div>
    </section>
  );
}
