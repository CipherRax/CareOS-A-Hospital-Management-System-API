import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { ZodValidationPipe } from 'nestjs-zod';
import { patchNestJsSwagger } from 'nestjs-zod';
import { AppModule } from './app/app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/config.module';
import { envSummary } from './config/env.schema';

const logger = new Logger('Bootstrap');

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
    { bufferLogs: false },
  );

  const env: Env = app.get(ENV);
  app.useLogger(app.get(PinoNestLogger));

  // --- security middleware ---
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  // --- validation (Zod DTO bodies/queries/params; metatype-driven) ---
  app.useGlobalPipes(new ZodValidationPipe());

  // --- versioned prefix; health + metrics stay at root ---
  app.setGlobalPrefix(env.API_PREFIX, {
    exclude: ['health/(.*)', 'health', env.METRICS_ENABLED ? env.METRICS_PATH : ''],
  });

  // --- OpenAPI (Swagger) ---
  if (env.ENABLE_SWAGGER) {
    patchNestJsSwagger();
    const config = new DocumentBuilder()
      .setTitle('careOS API')
      .setDescription('Auditable multi-tenant healthcare operations API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('health', 'Operational health')
      .addTag('organizations', 'Tenant root entity')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(env.PORT, '0.0.0.0');

  if (env.NODE_ENV !== 'test') {
    logger.log(`careOS API listening on http://0.0.0.0:${env.PORT}${env.API_PREFIX}`);
    logger.debug(`env summary: ${JSON.stringify(envSummary(env))}`);
  }
}

void bootstrap().catch((err: unknown) => {
  logger.error(
    'careOS API failed to start',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
