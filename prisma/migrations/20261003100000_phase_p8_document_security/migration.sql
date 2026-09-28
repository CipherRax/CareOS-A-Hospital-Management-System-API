-- Phase P8 document content security (ADR-047).
--
-- `complete` verified only that the object existed and matched its declared
-- size. Nothing ever read the bytes, so a renamed executable, a test-virus, or a
-- stray national-ID number could be uploaded and then downloaded by anyone
-- holding `documents.read`. `docs/limitations.md` had said the fix belongs on
-- the `Storage.DocumentUploaded` outbox event, which had no consumer.
--
-- This migration adds the state that makes a verdict storable, so a scan is a
-- durable fact about a document rather than a moment in a worker:
--
--  * scanStatus — the content-security verdict, orthogonal to DocumentStatus.
--    PENDING is the real window between `complete` and the scan, and a document
--    is not downloadable while it holds. INFECTED/REJECTED are refused outright;
--    FLAGGED is downloadable because it is a review signal, not a verdict.
--  * scanDetail — a rule or signature NAME only. Matched bytes would put patient
--    data in an audit-visible column, so the scanners report identifiers, never
--    content.
--  * scannedAt / scanEngine / scannedBytes / scanTruncated — what ran, over how
--    much, and whether the verdict covered the whole object. A CLEAN result on a
--    truncated scan means "clean as far as we read", and the row has to say so.
--  * scanFingerprint — a short digest of the inspected prefix so a re-scan can
--    be correlated with the original without persisting any content.
--
-- The (status, scanStatus) index serves the operator query "what is unscanned or
-- failed" that the rescan endpoint and the docs point at.

CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'REJECTED', 'FLAGGED', 'ERROR');

ALTER TABLE "documents"
  ADD COLUMN "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "scannedAt" TIMESTAMP(3),
  ADD COLUMN "scanEngine" TEXT,
  ADD COLUMN "scanDetail" TEXT,
  ADD COLUMN "scannedBytes" INTEGER,
  ADD COLUMN "scanTruncated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scanFingerprint" TEXT;

-- Historical rows were uploaded before any scanner existed and have never been
-- inspected. They are deliberately left PENDING rather than backfilled to
-- CLEAN: claiming an unexamined 2021 scan report was clean is exactly the lie
-- this phase exists to stop. They become unservable until a re-scan runs, which
-- the `POST /documents/:id/rescan` endpoint provides.
CREATE INDEX "documents_status_scanStatus_idx" ON "documents"("status", "scanStatus");
