-- CreateEnum
CREATE TYPE "EncounterType" AS ENUM ('OUTPATIENT', 'EMERGENCY', 'FOLLOW_UP', 'INPATIENT', 'TELEMEDICINE');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ClinicalNoteStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "ClinicalNoteVersionKind" AS ENUM ('ORIGINAL', 'AMENDMENT', 'NEW_VERSION');

-- CreateEnum
CREATE TYPE "DiagnosisClassification" AS ENUM ('PRIMARY', 'SECONDARY', 'SUSPECTED');

-- CreateEnum
CREATE TYPE "DiagnosisStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'HISTORICAL', 'AMENDED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'REMINDED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('CREATED', 'SENT', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "patient_timeline_entries" ADD COLUMN     "sourceEventId" TEXT;

-- CreateTable
CREATE TABLE "encounters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT,
    "type" "EncounterType" NOT NULL DEFAULT 'OUTPATIENT',
    "status" "EncounterStatus" NOT NULL DEFAULT 'OPEN',
    "visitId" TEXT,
    "appointmentId" TEXT,
    "note" TEXT,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inProgressAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "ClinicalNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "sections" JSONB NOT NULL,
    "reason" TEXT,
    "templateId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_note_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "kind" "ClinicalNoteVersionKind" NOT NULL DEFAULT 'ORIGINAL',
    "title" TEXT,
    "sections" JSONB NOT NULL,
    "reason" TEXT,
    "authorId" TEXT NOT NULL,
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_note_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_note_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "sections" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_note_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "providerId" TEXT NOT NULL,
    "classification" "DiagnosisClassification" NOT NULL DEFAULT 'PRIMARY',
    "status" "DiagnosisStatus" NOT NULL DEFAULT 'ACTIVE',
    "codeConceptId" TEXT,
    "code" TEXT,
    "codeSystemKey" TEXT,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "onProblemList" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_systems" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "source" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coding_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_concepts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "providerId" TEXT,
    "departmentId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "instructions" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedNotes" TEXT,
    "missedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "fromProviderId" TEXT NOT NULL,
    "toDepartmentId" TEXT,
    "toFacilityName" TEXT,
    "toFacilityAddress" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "documentIds" TEXT[],
    "status" "ReferralStatus" NOT NULL DEFAULT 'CREATED',
    "decidedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedUserId" TEXT,
    "patientId" TEXT,
    "encounterId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encounters_organizationId_patientId_createdAt_idx" ON "encounters"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "encounters_organizationId_branchId_status_idx" ON "encounters"("organizationId", "branchId", "status");

-- CreateIndex
CREATE INDEX "encounters_organizationId_departmentId_status_idx" ON "encounters"("organizationId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "clinical_notes_organizationId_patientId_createdAt_idx" ON "clinical_notes"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "clinical_notes_organizationId_encounterId_status_idx" ON "clinical_notes"("organizationId", "encounterId", "status");

-- CreateIndex
CREATE INDEX "clinical_note_versions_organizationId_noteId_idx" ON "clinical_note_versions"("organizationId", "noteId");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_note_versions_organizationId_noteId_versionNumber_key" ON "clinical_note_versions"("organizationId", "noteId", "versionNumber");

-- CreateIndex
CREATE INDEX "clinical_note_templates_organizationId_idx" ON "clinical_note_templates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_note_templates_organizationId_name_key" ON "clinical_note_templates"("organizationId", "name");

-- CreateIndex
CREATE INDEX "diagnoses_organizationId_patientId_status_idx" ON "diagnoses"("organizationId", "patientId", "status");

-- CreateIndex
CREATE INDEX "diagnoses_organizationId_encounterId_idx" ON "diagnoses"("organizationId", "encounterId");

-- CreateIndex
CREATE INDEX "diagnoses_organizationId_codeConceptId_idx" ON "diagnoses"("organizationId", "codeConceptId");

-- CreateIndex
CREATE INDEX "coding_systems_organizationId_idx" ON "coding_systems"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "coding_systems_organizationId_key_key" ON "coding_systems"("organizationId", "key");

-- CreateIndex
CREATE INDEX "code_concepts_organizationId_systemId_isActive_idx" ON "code_concepts"("organizationId", "systemId", "isActive");

-- CreateIndex
CREATE INDEX "code_concepts_organizationId_code_idx" ON "code_concepts"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "code_concepts_organizationId_systemId_code_key" ON "code_concepts"("organizationId", "systemId", "code");

-- CreateIndex
CREATE INDEX "follow_ups_organizationId_patientId_status_idx" ON "follow_ups"("organizationId", "patientId", "status");

-- CreateIndex
CREATE INDEX "follow_ups_organizationId_status_dueAt_idx" ON "follow_ups"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "referrals_organizationId_patientId_status_idx" ON "referrals"("organizationId", "patientId", "status");

-- CreateIndex
CREATE INDEX "referrals_organizationId_status_createdAt_idx" ON "referrals"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "tasks_organizationId_assignedUserId_status_idx" ON "tasks"("organizationId", "assignedUserId", "status");

-- CreateIndex
CREATE INDEX "tasks_organizationId_status_dueAt_idx" ON "tasks"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_organizationId_patientId_idx" ON "tasks"("organizationId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_organizationId_entityType_key" ON "workflows"("organizationId", "entityType");

-- CreateIndex
CREATE INDEX "workflow_transitions_organizationId_workflowId_idx" ON "workflow_transitions"("organizationId", "workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_timeline_entries_organizationId_sourceEventId_key" ON "patient_timeline_entries"("organizationId", "sourceEventId");

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "clinical_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_templates" ADD CONSTRAINT "clinical_note_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_codeConceptId_fkey" FOREIGN KEY ("codeConceptId") REFERENCES "code_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_systems" ADD CONSTRAINT "coding_systems_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_concepts" ADD CONSTRAINT "code_concepts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_concepts" ADD CONSTRAINT "code_concepts_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "coding_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_fromProviderId_fkey" FOREIGN KEY ("fromProviderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation (RLS) for Phase 4 clinical tables
ALTER TABLE "encounters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_note_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_note_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coding_systems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "code_concepts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_transitions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_encounters ON "encounters"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_clinical_notes ON "clinical_notes"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_clinical_note_versions ON "clinical_note_versions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_clinical_note_templates ON "clinical_note_templates"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_diagnoses ON "diagnoses"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_coding_systems ON "coding_systems"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_code_concepts ON "code_concepts"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_follow_ups ON "follow_ups"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_referrals ON "referrals"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_tasks ON "tasks"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_workflows ON "workflows"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_workflow_transitions ON "workflow_transitions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "encounters", "clinical_notes",
  "clinical_note_versions", "clinical_note_templates", "diagnoses",
  "coding_systems", "code_concepts", "follow_ups", "referrals", "tasks",
  "workflows", "workflow_transitions" TO careos_app;
