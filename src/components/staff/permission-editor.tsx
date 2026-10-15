'use client';

import { useTranslations } from 'next-intl';

import { CheckboxField } from '@/components/ui/primitives';
import type { PermissionGroup } from '@/lib/data/admin';

/**
 * Permission picker for a role, grouped by the catalog's own group keys.
 *
 * The labels are the API's permission vocabulary (`patients.read`,
 * `clinical_notes.create`, …) rather than invented prose: a permission string is
 * a real capability boundary, and a friendly paraphrase risks understating what
 * an administrator is granting. The group heading is the only humanising step.
 */

/** Turns a group key like `clinicalNotes` into `Clinical notes`. */
export function permissionGroupLabel(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The action part of a permission, e.g. `patients.create` → `Create`. */
export function permissionActionLabel(permission: string): string {
  const action = permission.includes('.')
    ? permission.slice(permission.lastIndexOf('.') + 1)
    : permission;
  const spaced = action.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function PermissionsEditor({
  groups,
  selected,
  onToggle,
  disabled = false,
}: {
  groups: readonly PermissionGroup[];
  selected: readonly string[];
  onToggle: (permission: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('admin');

  if (groups.length === 0) {
    return <p className="text-meta text-tertiary">{t('catalogEmpty')}</p>;
  }

  return (
    <div className="flex max-h-[28rem] flex-col gap-5 overflow-y-auto pr-1">
      {groups.map((group) => (
        <fieldset key={group.key} className="flex flex-col gap-2">
          <legend className="text-meta font-medium text-secondary">
            {permissionGroupLabel(group.key)}
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.permissions.map((permission) => (
              <CheckboxField
                key={permission}
                id={`permission-${group.key}-${permission}`}
                label={permissionActionLabel(permission)}
                description={permission}
                checked={selected.includes(permission)}
                disabled={disabled}
                onCheckedChange={() => onToggle(permission)}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
