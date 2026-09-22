/**
 * Minimal ambient typings for s3rver (no published @types). Only the surface
 * used by the e2e harness is declared; see node_modules/s3rver for the rest.
 */
declare module 's3rver' {
  interface S3rverBucketConfig {
    name: string;
  }

  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    allowMismatchedSignatures?: boolean;
    vhostBuckets?: boolean;
    configureBuckets?: S3rverBucketConfig[];
    directory?: string;
    serverOptions?: Record<string, unknown>;
  }

  interface Address {
    address: string;
    family: string;
    port: number;
  }

  class S3rver {
    constructor(options?: S3rverOptions);
    readonly httpServer?: { address(): Address | null; close(): void };
    run(): Promise<Address>;
    listen(...args: unknown[]): Promise<unknown>;
    close(): Promise<unknown>;
    reset(): Promise<void>;
  }

  export default S3rver;
}