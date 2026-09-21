import { startDependencies } from '../support/testcontainers';

declare global {
  var __E2E_DEPS__: Awaited<ReturnType<typeof startDependencies>> | undefined;
}

export default async function globalSetup(): Promise<void> {
  const deps = await startDependencies();
  globalThis.__E2E_DEPS__ = deps;
}
