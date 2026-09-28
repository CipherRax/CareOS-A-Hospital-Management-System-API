import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV, type Env } from '../../config/config.module';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';

export interface PresignedUpload {
  method: 'PUT';
  url: string;
  expiresIn: number;
}

export interface ObjectHead {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
}

export interface ObjectStream {
  /** Chunk size requested from S3; bounds per-chunk memory. */
  chunkBytes: number;
  /** Total bytes the caller asked for. The stream stops early at this cap. */
  limitBytes: number;
  chunks: AsyncGenerator<Buffer>;
}

/**
 * S3/MinIO object storage. Clients upload directly to short-lived presigned
 * PUT URLs and download through presigned GET URLs — the API never proxies the
 * binary through Nest. The client is created lazily from env; when S3 is not
 * configured (dev/test without storage) every operation fails with
 * S3_UNAVAILABLE rather than hiding the absence.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly ttlSeconds: number;

  constructor(@Inject(ENV) @Optional() env: Env | undefined) {
    this.bucket = env?.S3_BUCKET ?? 'careos';
    this.ttlSeconds = env?.S3_SIGNED_URL_TTL_SECONDS ?? 900;
    this.client = this.buildClient(env);
  }

  private buildClient(env: Env | undefined): S3Client | null {
    if (!env?.S3_ENDPOINT || !env?.S3_ACCESS_KEY || !env?.S3_SECRET_KEY) {
      this.logger.warn(
        'S3 not configured (missing endpoint or credentials) — storage operations will fail with S3_UNAVAILABLE',
      );
      return null;
    }
    return new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'Object storage is not configured.',
        silent: true,
      });
    }
    return this.client;
  }

  /** Presigned PUT for direct client upload. ContentType is part of the signature. */
  async presignPut(key: string, contentType?: string): Promise<PresignedUpload> {
    const client = this.requireClient();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(contentType ? { ContentType: contentType } : {}),
    });
    const url = await getSignedUrl(client, command, {
      expiresIn: this.ttlSeconds,
      signableHeaders: contentType ? new Set(['content-type']) : undefined,
    });
    return { method: 'PUT', url, expiresIn: this.ttlSeconds };
  }

  /** Presigned GET for direct client download. */
  async presignGet(key: string, filename?: string): Promise<{ url: string; expiresIn: number }> {
    const client = this.requireClient();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    });
    const url = await getSignedUrl(client, command, { expiresIn: this.ttlSeconds });
    return { url, expiresIn: this.ttlSeconds };
  }

  /** Verifies an object exists and reports size/content-type, without body. */
  async head(key: string): Promise<ObjectHead> {
    try {
      const client = this.requireClient();
      const res = await client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        exists: true,
        sizeBytes: res.ContentLength,
        contentType: res.ContentType,
      };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotFound' || name === 'NoSuchKey') {
        return { exists: false };
      }
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'Object storage is unavailable.',
        cause: err,
      });
    }
  }

  /** Deletes an object (idempotent — S3 removes nothing on a missing key). */
  async remove(key: string): Promise<void> {
    const client = this.requireClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Streams an object back in chunks, stopping at `limitBytes`.
   *
   * This is the one path that brings bytes into the API, and it exists for the
   * document scanner (ADR-047). It is deliberately *not* a `getBuffer`: a
   * hospital upload can be hundreds of megabytes, so the cap plus chunked
   * ranges bound memory to the chunk size regardless of object size. Everything
   * else in this service stays presigned so the binary never transits Nest.
   */
  async stream(key: string, limitBytes: number, chunkBytes = 64 * 1024): Promise<ObjectStream> {
    const client = this.requireClient();
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    let res: GetObjectCommandOutput;
    try {
      res = await client.send(command);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotFound' || name === 'NoSuchKey') {
        throw AppError.notFound('Stored object not found');
      }
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'Object storage is unavailable.',
        cause: err,
      });
    }

    // The SDK types `Body` as a union that includes Blob/string, but the Node
    // handler always returns a stream. Narrow it for real instead of asserting:
    // an unreadable body must fail the scan, not surface as a hang.
    const body = res.Body as unknown;
    if (
      body === null ||
      body === undefined ||
      typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function'
    ) {
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'Object storage returned an unreadable body.',
      });
    }

    async function* bounded(
      source: AsyncIterable<Uint8Array>,
      limit: number,
    ): AsyncGenerator<Buffer> {
      let seen = 0;
      for await (const part of source) {
        const buf = Buffer.from(part);
        if (seen + buf.length >= limit) {
          const slice = buf.subarray(0, Math.max(0, limit - seen));
          if (slice.length > 0) yield slice;
          return;
        }
        seen += buf.length;
        yield buf;
      }
    }

    return {
      chunkBytes,
      limitBytes,
      chunks: bounded(body as AsyncIterable<Uint8Array>, limitBytes),
    };
  }
}