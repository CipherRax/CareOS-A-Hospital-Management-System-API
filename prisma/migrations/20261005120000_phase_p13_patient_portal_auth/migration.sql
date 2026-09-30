-- Phase P13 patient-portal real JWT auth.
--
-- `TenantScope.patientId` is read by eight services — the portal projections,
-- `patients.assertPatientOwnership`, queue status, notification principal
-- identity, conversation access, feedback, and the two `assertStaffPrincipal`
-- denials. Every one of them narrows to `patientId = scope.patientId` or fails
-- closed. None of them could ever fire in production, because the only writer of
-- that value was the test-only header middleware: there was no way for a patient
-- to become a principal (ADR-051).
--
-- The missing piece was a link, not an authentication system:
--
--  * `patients.userId` links a patient record to the `User` that may reach it.
--    The patient portal login is an ordinary user row holding the `PATIENT` role,
--    so `Session.userId` stays NOT NULL, refresh rotation and reuse detection are
--    untouched, and there is no second token purpose, secret or audience to
--    audit. Patient/staff separation is already expressed by permissions:
--    `portal.read` is granted to `PATIENT` and to no other role.
--
--  * The column is NULLABLE, so this migration rewrites no existing row and every
--    patient keeps behaving exactly as before: no portal access until a member of
--    staff provisions it.
--
--  * The column is UNIQUE. A login resolving to two records would hand one person
--    another person's chart, and a unique index makes that impossible rather than
--    merely unlikely — the constraint has to exist in the database, because the
--    application check and the link write are not in the same transaction.
--
-- `ON DELETE SET NULL` rather than `CASCADE`: deleting a login must not delete a
-- patient's medical record. Revoking portal access drops the link and leaves the
-- chart intact.
--
-- There is no backfill. A link is an assertion that a specific person owns a
-- specific record, and no existing column records that. Deriving candidate links
-- from a matching email or phone number would silently grant portal access to
-- whoever happened to share a contact detail with a patient.

ALTER TABLE "patients" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "patients_userid_key" ON "patients" USING Btree ("userId");

ALTER TABLE "patients"
  ADD CONSTRAINT "patients_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
