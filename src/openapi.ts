import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Single definition of the careOS OpenAPI document.
 *
 * Extracted from `main.ts` so the served `/docs` page and the exported
 * `openapi.json` can never describe different APIs. A second copy of this
 * DocumentBuilder would drift, and a drifted contract is worse than no contract:
 * the frontend would generate types from a document the API does not actually
 * serve.
 *
 * Note the version is read from the package rather than hard-coded, so a release
 * bump cannot leave the document claiming to be 1.0.0.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  patchNestJsSwagger();

  const config = new DocumentBuilder()
    .setTitle('careOS API')
    .setDescription('Auditable multi-tenant healthcare operations API')
    .setVersion(readApiVersion())
    .addBearerAuth()
    .addCookieAuth('careos_session', {
      type: 'apiKey',
      in: 'cookie',
      description: 'Opaque HttpOnly session identifier issued to staff and patient sessions.',
    })
    .addTag('health', 'Operational health')
    .addTag('organizations', 'Tenant root entity')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Reads the version from package.json at call time rather than importing it.
 *
 * An import would either be inlined at build time (and go stale on a version bump)
 * or be emitted as a require of a file outside the compiler's rootDir, which the
 * standalone OpenAPI build does not copy. Reading from disk at runtime avoids both.
 */
function readApiVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
