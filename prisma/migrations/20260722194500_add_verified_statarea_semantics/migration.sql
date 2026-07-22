-- B006: additive, versioned Statarea Legacy semantic registry and projections.
CREATE TABLE "SemanticRegistry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourcePresentation" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "evidenceStatus" TEXT NOT NULL,
    "legendSha256" TEXT NOT NULL,
    "registryHash" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SemanticFieldDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryId" TEXT NOT NULL,
    "rawHeader" TEXT,
    "canonicalField" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "direction" TEXT,
    "line" DECIMAL,
    "semanticStatus" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "normalizationRule" TEXT NOT NULL,
    "derivationRule" TEXT,
    "analysisEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemanticFieldDefinition_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "SemanticRegistry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SemanticAssessmentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "assessmentVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL,
    "qualitySummaryJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemanticAssessmentRun_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "SemanticRegistry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SemanticAssessmentRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SemanticAssessmentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentRunId" TEXT,
    "registryId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reusedAssessmentRunId" TEXT,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemanticAssessmentAttempt_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "SemanticAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SemanticAssessmentAttempt_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "SemanticRegistry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "StatareaSemanticProjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentRunId" TEXT NOT NULL,
    "rawRowId" TEXT NOT NULL,
    "sportsDate" DATETIME NOT NULL,
    "partition" TEXT NOT NULL,
    "sourceHomeWinPercent" DECIMAL,
    "sourceDrawPercent" DECIMAL,
    "sourceAwayWinPercent" DECIMAL,
    "sourceDoubleChance1XPercent" DECIMAL,
    "sourceDoubleChanceX2Percent" DECIMAL,
    "sourceDoubleChance12Percent" DECIMAL,
    "sourceHtHomeWinPercent" DECIMAL,
    "sourceHtDrawPercent" DECIMAL,
    "sourceHtAwayWinPercent" DECIMAL,
    "sourceOver15Percent" DECIMAL,
    "sourceUnder15Percent" DECIMAL,
    "sourceOver25Percent" DECIMAL,
    "sourceUnder25Percent" DECIMAL,
    "sourceOver35Percent" DECIMAL,
    "sourceUnder35Percent" DECIMAL,
    "sourceHandicap01HomePercent" DECIMAL,
    "sourceHandicap01DrawPercent" DECIMAL,
    "sourceHandicap01AwayPercent" DECIMAL,
    "ou25SemanticReady" BOOLEAN NOT NULL DEFAULT false,
    "doubleChanceSemanticReady" BOOLEAN NOT NULL DEFAULT false,
    "htSemanticReady" BOOLEAN NOT NULL DEFAULT false,
    "handicap01SemanticReady" BOOLEAN NOT NULL DEFAULT false,
    "semanticReadiness" TEXT NOT NULL,
    "qualityStatus" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatareaSemanticProjection_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "SemanticAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StatareaSemanticProjection_rawRowId_fkey" FOREIGN KEY ("rawRowId") REFERENCES "StatareaRawRow" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SemanticQualityFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentRunId" TEXT NOT NULL,
    "rawRowId" TEXT,
    "sportsDate" DATETIME,
    "field" TEXT NOT NULL,
    "findingType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "observedValue" TEXT,
    "expectedRule" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemanticQualityFinding_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "SemanticAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SemanticAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentRunId" TEXT,
    "registryId" TEXT,
    "eventType" TEXT NOT NULL,
    "contextJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemanticAuditEvent_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "SemanticAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SemanticAuditEvent_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "SemanticRegistry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SemanticRegistry_registryHash_key" ON "SemanticRegistry"("registryHash");
CREATE UNIQUE INDEX "SemanticRegistry_code_version_key" ON "SemanticRegistry"("code", "version");
CREATE UNIQUE INDEX "SemanticFieldDefinition_registryId_canonicalField_key" ON "SemanticFieldDefinition"("registryId", "canonicalField");
CREATE UNIQUE INDEX "SemanticAssessmentRun_registryId_datasetId_manifestHash_assessmentVersion_key" ON "SemanticAssessmentRun"("registryId", "datasetId", "manifestHash", "assessmentVersion");
CREATE UNIQUE INDEX "StatareaSemanticProjection_assessmentRunId_rawRowId_key" ON "StatareaSemanticProjection"("assessmentRunId", "rawRowId");
CREATE INDEX "StatareaSemanticProjection_sportsDate_partition_idx" ON "StatareaSemanticProjection"("sportsDate", "partition");
CREATE INDEX "SemanticQualityFinding_assessmentRunId_field_findingType_idx" ON "SemanticQualityFinding"("assessmentRunId", "field", "findingType");
CREATE INDEX "SemanticAuditEvent_eventType_createdAt_idx" ON "SemanticAuditEvent"("eventType", "createdAt");

CREATE TRIGGER "SemanticRegistry_no_update" BEFORE UPDATE ON "SemanticRegistry" BEGIN SELECT RAISE(ABORT, 'SemanticRegistry is append-only'); END;
CREATE TRIGGER "SemanticRegistry_no_delete" BEFORE DELETE ON "SemanticRegistry" BEGIN SELECT RAISE(ABORT, 'SemanticRegistry is append-only'); END;
CREATE TRIGGER "SemanticFieldDefinition_no_update" BEFORE UPDATE ON "SemanticFieldDefinition" BEGIN SELECT RAISE(ABORT, 'SemanticFieldDefinition is append-only'); END;
CREATE TRIGGER "SemanticFieldDefinition_no_delete" BEFORE DELETE ON "SemanticFieldDefinition" BEGIN SELECT RAISE(ABORT, 'SemanticFieldDefinition is append-only'); END;
CREATE TRIGGER "SemanticAssessmentRun_no_update" BEFORE UPDATE ON "SemanticAssessmentRun" BEGIN SELECT RAISE(ABORT, 'SemanticAssessmentRun is append-only'); END;
CREATE TRIGGER "SemanticAssessmentRun_no_delete" BEFORE DELETE ON "SemanticAssessmentRun" BEGIN SELECT RAISE(ABORT, 'SemanticAssessmentRun is append-only'); END;
CREATE TRIGGER "SemanticAssessmentAttempt_no_update" BEFORE UPDATE ON "SemanticAssessmentAttempt" BEGIN SELECT RAISE(ABORT, 'SemanticAssessmentAttempt is append-only'); END;
CREATE TRIGGER "SemanticAssessmentAttempt_no_delete" BEFORE DELETE ON "SemanticAssessmentAttempt" BEGIN SELECT RAISE(ABORT, 'SemanticAssessmentAttempt is append-only'); END;
CREATE TRIGGER "StatareaSemanticProjection_no_update" BEFORE UPDATE ON "StatareaSemanticProjection" BEGIN SELECT RAISE(ABORT, 'StatareaSemanticProjection is append-only'); END;
CREATE TRIGGER "StatareaSemanticProjection_no_delete" BEFORE DELETE ON "StatareaSemanticProjection" BEGIN SELECT RAISE(ABORT, 'StatareaSemanticProjection is append-only'); END;
CREATE TRIGGER "SemanticQualityFinding_no_update" BEFORE UPDATE ON "SemanticQualityFinding" BEGIN SELECT RAISE(ABORT, 'SemanticQualityFinding is append-only'); END;
CREATE TRIGGER "SemanticQualityFinding_no_delete" BEFORE DELETE ON "SemanticQualityFinding" BEGIN SELECT RAISE(ABORT, 'SemanticQualityFinding is append-only'); END;
CREATE TRIGGER "SemanticAuditEvent_no_update" BEFORE UPDATE ON "SemanticAuditEvent" BEGIN SELECT RAISE(ABORT, 'SemanticAuditEvent is append-only'); END;
CREATE TRIGGER "SemanticAuditEvent_no_delete" BEFORE DELETE ON "SemanticAuditEvent" BEGIN SELECT RAISE(ABORT, 'SemanticAuditEvent is append-only'); END;
