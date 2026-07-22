-- CreateTable
CREATE TABLE "MatchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sportDate" DATETIME NOT NULL,
    "forebetSnapshotId" TEXT NOT NULL,
    "forebetSha256" TEXT NOT NULL,
    "statareaSnapshotId" TEXT NOT NULL,
    "statareaSha256" TEXT NOT NULL,
    "matcherVersion" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "configurationJson" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "forebetInputCount" INTEGER NOT NULL,
    "statareaInputCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL,
    "ambiguousCount" INTEGER NOT NULL,
    "onlyForebetCount" INTEGER NOT NULL,
    "onlyStatareaCount" INTEGER NOT NULL,
    "conflictCount" INTEGER NOT NULL,
    "exactCount" INTEGER NOT NULL,
    "conservativeCount" INTEGER NOT NULL,
    "approximateCount" INTEGER NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "exportPath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MatchRunAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchRunAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MatchRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "forebetObservationId" TEXT,
    "statareaRowId" TEXT,
    "orientation" TEXT NOT NULL,
    "homeScore" REAL NOT NULL,
    "awayScore" REAL NOT NULL,
    "competitionEvidence" TEXT NOT NULL,
    "countryEvidence" TEXT NOT NULL,
    "categoryEvidence" TEXT NOT NULL,
    "aggregateScore" REAL NOT NULL,
    "marginToSecond" REAL,
    "stage" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "rejectionReasonsJson" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MatchRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "forebetObservationId" TEXT,
    "statareaRowId" TEXT,
    "selectedCandidateId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "confidenceClass" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MatchRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "eventType" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MatchStabilityReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sportDate" DATETIME NOT NULL,
    "primaryRunId" TEXT NOT NULL,
    "alternativeRunIdsJson" TEXT NOT NULL,
    "reportHash" TEXT NOT NULL,
    "reportJson" TEXT NOT NULL,
    "exportPath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchRun_sportDate_forebetSnapshotId_statareaSnapshotId_matcherVersion_normalizerVersion_configurationHash_runType_key" ON "MatchRun"("sportDate", "forebetSnapshotId", "statareaSnapshotId", "matcherVersion", "normalizerVersion", "configurationHash", "runType");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCandidate_runId_forebetObservationId_statareaRowId_orientation_key" ON "MatchCandidate"("runId", "forebetObservationId", "statareaRowId", "orientation");

-- CreateIndex
CREATE INDEX "MatchDecision_runId_status_idx" ON "MatchDecision"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MatchStabilityReport_primaryRunId_reportHash_key" ON "MatchStabilityReport"("primaryRunId", "reportHash");

-- Reconciliation evidence is append-only.
CREATE TRIGGER "MatchRun_no_update" BEFORE UPDATE ON "MatchRun" BEGIN SELECT RAISE(ABORT, 'MatchRun is append-only'); END;
CREATE TRIGGER "MatchRun_no_delete" BEFORE DELETE ON "MatchRun" BEGIN SELECT RAISE(ABORT, 'MatchRun is append-only'); END;
CREATE TRIGGER "MatchCandidate_no_update" BEFORE UPDATE ON "MatchCandidate" BEGIN SELECT RAISE(ABORT, 'MatchCandidate is append-only'); END;
CREATE TRIGGER "MatchCandidate_no_delete" BEFORE DELETE ON "MatchCandidate" BEGIN SELECT RAISE(ABORT, 'MatchCandidate is append-only'); END;
CREATE TRIGGER "MatchDecision_no_update" BEFORE UPDATE ON "MatchDecision" BEGIN SELECT RAISE(ABORT, 'MatchDecision is append-only'); END;
CREATE TRIGGER "MatchDecision_no_delete" BEFORE DELETE ON "MatchDecision" BEGIN SELECT RAISE(ABORT, 'MatchDecision is append-only'); END;
CREATE TRIGGER "MatchAuditEvent_no_update" BEFORE UPDATE ON "MatchAuditEvent" BEGIN SELECT RAISE(ABORT, 'MatchAuditEvent is append-only'); END;
CREATE TRIGGER "MatchAuditEvent_no_delete" BEFORE DELETE ON "MatchAuditEvent" BEGIN SELECT RAISE(ABORT, 'MatchAuditEvent is append-only'); END;
CREATE TRIGGER "MatchStabilityReport_no_update" BEFORE UPDATE ON "MatchStabilityReport" BEGIN SELECT RAISE(ABORT, 'MatchStabilityReport is append-only'); END;
CREATE TRIGGER "MatchStabilityReport_no_delete" BEFORE DELETE ON "MatchStabilityReport" BEGIN SELECT RAISE(ABORT, 'MatchStabilityReport is append-only'); END;
