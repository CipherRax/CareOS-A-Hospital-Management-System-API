import { LoginForm } from '@/components/auth/login-form';

/**
 * /login — staff sign-in.
 *
 * A public route (the signed-out gate has to point somewhere), but deliberately
 * under the public shell only: no staff chrome, no session footer, nothing that
 * would let a visitor mistake this for an internal screen.
 *
 * The form posts the real `LoginDto`; the session cookies are owned by the
 * same-origin proxy (see `src/app/api/v1/[...path]/route.ts`), so the token pair
 * never exists in page-reachable memory.
 */
export default function LoginPage() {
  return (
    <div>
      <LoginForm />
    </div>
  );
}