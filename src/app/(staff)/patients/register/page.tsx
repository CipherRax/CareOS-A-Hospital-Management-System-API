import { RegisterPatientScreen } from '@/components/staff/patient-register';

/**
 * /patients/register — walk-in registration (F2).
 *
 * The wizard's duplicate comparison reuses the API's own 409 candidate envelope,
 * so this screen is a genuine contract exercise, not a form wired to fixtures.
 */
export default function RegisterPatientPage() {
  return <RegisterPatientScreen />;
}
