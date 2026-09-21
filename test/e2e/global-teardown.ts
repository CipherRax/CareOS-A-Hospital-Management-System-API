import { stopDependencies } from '../support/testcontainers';

export default async function globalTeardown(): Promise<void> {
  const deps = globalThis.__E2E_DEPS__;
  if (deps) {
    await stopDependencies(deps);
  }
}
