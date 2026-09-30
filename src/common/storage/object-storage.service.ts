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
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
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
 * PUT URLs and document downloads hand back a presigned GET — for those, the
 * binary never transits Nest. Two paths do move bytes through the API, both
 * deliberately and for the same reason: the data originates or terminates
 * *server-side*, so there is no client to hand a URL to. `stream` serves the
 * document scanner (ADR-047) and the report-export download (ADR-049), and
 * `put` stores a report artifact the server itself rendered.
 *
 * The client is created lazily from env; when S3 is not configured
 * (dev/test without storage) every operation fails with S3_UNAVAILABLE rather
 * than hiding the absence.
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

  /**
   * Server-side upload.
   *
   * This is the exception to the rule above that the API never handles the
   * binary. It exists for artifacts the *server* produces — a rendered report
   * export — where there is no client to hand a presigned URL to. The bytes
   * still do not linger: the caller hands over a completed buffer, and the
   * download path streams the object back in chunks.
   *
   * `key` is the caller's to choose and must already be tenant-scoped; nothing
   * here derives a prefix from an organization id, because only the caller
   * knows the row the object belongs to.
   */
  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    const client = this.requireClient();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
    } catch (err) {
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'Object storage is unavailable.',
        cause: err,
      });
    }
  }

  /**
   * Uploads a readable stream, returning the byte count actually stored.
   *
   * A rendered report is piped straight in rather than buffered: `Upload` uses a
   * single PUT for a small body and switches to multipart on its own for a large
   * one, so the artifact never has to exist whole in this process. A failed part
   * set is aborted rather than left behind, since an orphaned part set is
   * invisible to a listing and would quietly cost money.
   */
  async putStream(key: string, body: Readable, contentType?: string): Promise<number> {
    const client = this.requireClient();
    let bytes = 0;
    body.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    try {
      await new Upload({
        client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ...(contentType ? { ContentType: contentType } : {}),
        },
        leavePartsOnError: false,
      }).done();
    } catch (err) {
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'Object storage is unavailable.',
        cause: err,
      });
    }
    return bytes;
  }

  /** Verifies an object exists and reports size/content-type, without body. */
  async head(key: string): Promise<ObjectHead> {    try {
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
   * This brings bytes into the API, for the document scanner (ADR-047) and the
   * report-export download (ADR-049). It is deliberately *not* a `getBuffer`: a
   * hospital upload, or a wide report, can be tens of megabytes, so the cap plus
   * chunked ranges bound memory to the chunk size regardless of object size.
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