/**
 * Exports the OpenAPI document to docs/openapi.json.
 *
 * The careOS API serves its Swagger UI at runtime but does not check the document
 * in, which means the frontend has no stable artifact to generate types from. This
 * script closes that gap: run it against an environment where the API can boot, and
 * commit the result.
 *
 * Requires a reachable PostgreSQL and Redis, because creating the Nest application
 * instantiates providers that connect on init. Use `docker compose up -d` (or an
 * equivalent environment) first.
 *
 * Note: this must run from compiled JavaScript, not through tsx. tsx transpiles
 * without emitting decorator metadata, so Nest's dependency injection cannot
 * resolve constructor parameters and the application fails to build. The npm
 * script therefore compiles with tsconfig.openapi.json first.
 *
 * Usage:
 *   npm run openapi:export
 *   npm run openapi:export -- --check   # fail if docs/openapi.json is stale
 *
 * Then, in the web repository: copy docs/openapi.json over
 * openapi/careos.partial.json (or point openapi-typescript at it directly) and run
 * `npm run api:types`.
 */
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AppModule } from '../src/app/app.module';
import { buildOpenApiDocument } from '../src/openapi';

const logger = new Logger('ExportOpenApi');
// Resolved from the working directory rather than __dirname, because this script
// runs from a dedicated build output (dist-openapi/scripts) whose depth does not
// match its source location. npm scripts always run from the repository root.
const OUT_PATH = resolve(process.cwd(), 'docs/openapi.json');

async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  logger.log('Creating Nest application (this connects to PostgreSQL and Redis)…');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  try {
    // `init` rather than `listen`: the document can be built without binding a
    // port, so this is safe to run alongside a running instance.
    await app.init();

    const document = buildOpenApiDocument(app);
    const serialised = `${JSON.stringify(document, null, 2)}\n`;

    if (check) {
      const existing = await readFile(OUT_PATH, 'utf8').catch(() => null);
      if (existing === serialised) {
        logger.log('docs/openapi.json is up to date.');
        return;
      }
      logger.error('docs/openapi.json is stale. Run: npm run openapi:export');
      process.exitCode = 1;
      return;
    }

    await writeFile(OUT_PATH, serialised, 'utf8');
    const paths = Object.keys(document.paths ?? {}).length;
    const schemas = Object.keys(document.components?.schemas ?? {}).length;
    logger.log(`Wrote docs/openapi.json — ${paths} paths, ${schemas} schemas.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  logger.error(
    'OpenAPI export failed. The API must be able to reach PostgreSQL and Redis.',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
