-- Phase P11 async + streamed report exports.
--
-- Report generation ran inside the request: `POST /reports/export` built the
-- whole payload, serialized it, and persisted it before responding. A wide
-- report over a long window was bounded only by the HTTP timeout, and the
-- artifact was held base64-encoded in a `String` column — ~33% larger than the
-- file, unreadable as bytes, and impossible to stream.
--
-- This migration moves the artifact into object storage and makes the row able
-- to describe an export that has not been produced yet:
--
--  * artifactKey replaces `artifact`. The object key in the configured bucket.
--    A multi-megabyte patient-data file does not belong in a row, and the
--    download could never be streamed out of one. Rows written before this
--    migration hold base64 in `artifact`; the data migration below preserves
--    any not-yet-expired export by moving its bytes into S3 is NOT attempted —
--    see below.
--  * summary — the report's summary, captured at generation time, so a caller
--    can see what an export contains without downloading it. Previously the
--    POST response carried it, which was only possible because the request
--    built the report synchronously.
--  * completedAt — when generation reached a terminal state, so "how long did
--    this take?" is answerable from the row instead of from logs.
--
-- `status` already carried PENDING/READY/FAILED/EXPIRED; the PENDING window is
-- simply now real rather than vestigial.

-- Data migration: move any unexpired artifact into object storage is not
-- possible from SQL alone (it needs an S3 client), so the artifacts written
-- before this migration are dropped rather than silently left as unreachable
-- base64. Exports expire after 24h by design, so the window is at most a day of
-- exports and they are regenerable from the same parameters. Recorded here
-- rather than done silently.
DELETE FROM "report_exports" WHERE "artifact" IS NOT NULL;

ALTER TABLE "report_exports" DROP COLUMN "artifact";

ALTER TABLE "report_exports" ADD COLUMN "artifactKey" TEXT;
ALTER TABLE "report_exports" ADD COLUMN "summary" JSONB;
ALTER TABLE "report_exports" ADD COLUMN "completedAt" TIMESTAMP(3);
