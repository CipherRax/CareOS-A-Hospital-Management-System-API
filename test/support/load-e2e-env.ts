import { loadE2EEnv } from './testcontainers';

/**
 * setupFiles entry: runs in each test worker process before any test module is
 * imported, so ConfigModule/PrismaService pick up the container URLs.
 */
const env = loadE2EEnv();
for (const key of Object.keys(env)) {
  process.env[key] = env[key] as string;
}

process.env.NODE_ENV = 'test';
