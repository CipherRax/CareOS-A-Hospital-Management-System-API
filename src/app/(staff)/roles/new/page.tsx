import { RoleCreateScreen } from '@/components/staff/role-workspace';

/**
 * /roles/new — create a custom role (F9 administration). A static segment, so it
 * takes precedence over `/roles/[id]`.
 */
export default function NewRolePage() {
  return <RoleCreateScreen />;
}
