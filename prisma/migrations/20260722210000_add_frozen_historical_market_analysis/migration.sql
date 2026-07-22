CREATE TABLE "HistoricalAnalysisSpec" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "registryHash" TEXT NOT NULL,
  "outcomePolicyVersion" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "specHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "canonicalSpecJson" TEXT NOT NULL,
  "resultEvidenceCountAtFreeze" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalAnalysisSpec_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "PatternDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "specId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "side" TEXT,
  "threshold" DECIMAL,
  "canonicalRuleJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatternDefinition_specId_fkey" FOREIGN KEY ("specId") REFERENCES "HistoricalAnalysisSpec" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "OutcomeExtractionRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "specId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "extractorVersionsJson" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "countsJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutcomeExtractionRun_specId_fkey" FOREIGN KEY ("specId") REFERENCES "HistoricalAnalysisSpec" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "OutcomeExtractionRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "OutcomeExtractionAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "specId" TEXT NOT NULL,
  "extractionRunId" TEXT,
  "status" TEXT NOT NULL,
  "contextJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "OutcomeEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "extractionRunId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sportsDate" DATETIME NOT NULL,
  "rawResult" TEXT,
  "rawHtResult" TEXT,
  "homeGoals" INTEGER,
  "awayGoals" INTEGER,
  "parseStatus" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "extractorVersion" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutcomeEvidence_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "OutcomeExtractionRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "FixtureOutcome" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "extractionRunId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "forebetOutcomeEvidenceId" TEXT,
  "statareaOutcomeEvidenceId" TEXT,
  "reconciliationStatus" TEXT NOT NULL,
  "homeGoals" INTEGER,
  "awayGoals" INTEGER,
  "totalGoals" INTEGER,
  "result1X2" TEXT,
  "ou25Outcome" TEXT,
  "doubleChance1XOutcome" BOOLEAN,
  "doubleChanceX2Outcome" BOOLEAN,
  "doubleChance12Outcome" BOOLEAN,
  "partition" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixtureOutcome_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "OutcomeExtractionRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FixtureOutcome_matchDecisionId_fkey" FOREIGN KEY ("matchDecisionId") REFERENCES "MatchDecision" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FixtureOutcome_forebetOutcomeEvidenceId_fkey" FOREIGN KEY ("forebetOutcomeEvidenceId") REFERENCES "OutcomeEvidence" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FixtureOutcome_statareaOutcomeEvidenceId_fkey" FOREIGN KEY ("statareaOutcomeEvidenceId") REFERENCES "OutcomeEvidence" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "HistoricalEvaluationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "specId" TEXT NOT NULL,
  "extractionRunId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "registryHash" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "countsJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalEvaluationRun_specId_fkey" FOREIGN KEY ("specId") REFERENCES "HistoricalAnalysisSpec" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalEvaluationRun_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "OutcomeExtractionRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "HistoricalEvaluationAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "specId" TEXT NOT NULL,
  "extractionRunId" TEXT,
  "evaluationRunId" TEXT,
  "status" TEXT NOT NULL,
  "contextJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PatternEvaluation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "evaluationRunId" TEXT NOT NULL,
  "patternDefinitionId" TEXT NOT NULL,
  "partition" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "total" INTEGER NOT NULL,
  "evaluable" INTEGER NOT NULL,
  "hits" INTEGER NOT NULL,
  "misses" INTEGER NOT NULL,
  "hitRate" DECIMAL,
  "wilsonLower" DECIMAL,
  "wilsonUpper" DECIMAL,
  "brierScore" DECIMAL,
  "theoreticalBreakEvenOdds" DECIMAL,
  "retainedSampleRate" DECIMAL,
  "maxCountryShare" DECIMAL,
  "maxCompetitionShare" DECIMAL,
  "maxHitStreak" INTEGER NOT NULL,
  "maxMissStreak" INTEGER NOT NULL,
  "sampleClass" TEXT NOT NULL,
  "stabilityClass" TEXT,
  "warningsJson" TEXT NOT NULL,
  "detailsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatternEvaluation_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "HistoricalEvaluationRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PatternEvaluation_patternDefinitionId_fkey" FOREIGN KEY ("patternDefinitionId") REFERENCES "PatternDefinition" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "CalibrationBucket" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "evaluationRunId" TEXT NOT NULL,
  "patternDefinitionId" TEXT NOT NULL,
  "partition" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "lowerBound" DECIMAL NOT NULL,
  "upperBound" DECIMAL NOT NULL,
  "count" INTEGER NOT NULL,
  "averageSourcePercent" DECIMAL,
  "observedFrequency" DECIMAL,
  "calibrationDifference" DECIMAL,
  "warningsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalibrationBucket_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "HistoricalEvaluationRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CalibrationBucket_patternDefinitionId_fkey" FOREIGN KEY ("patternDefinitionId") REFERENCES "PatternDefinition" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "HistoricalAnalysisAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "specId" TEXT,
  "extractionRunId" TEXT,
  "evaluationRunId" TEXT,
  "eventType" TEXT NOT NULL,
  "contextJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "HistoricalAnalysisSpec_identity_key" ON "HistoricalAnalysisSpec"("code", "version", "datasetId", "manifestHash", "registryHash", "specHash");
CREATE INDEX "HistoricalAnalysisSpec_code_version_idx" ON "HistoricalAnalysisSpec"("code", "version");
CREATE UNIQUE INDEX "PatternDefinition_spec_code_key" ON "PatternDefinition"("specId", "code");
CREATE INDEX "PatternDefinition_spec_family_idx" ON "PatternDefinition"("specId", "family");
CREATE UNIQUE INDEX "OutcomeExtractionRun_identity_key" ON "OutcomeExtractionRun"("specId", "datasetId", "manifestHash", "extractorVersionsJson");
CREATE UNIQUE INDEX "OutcomeEvidence_identity_key" ON "OutcomeEvidence"("extractionRunId", "source", "sourceRecordId", "extractorVersion");
CREATE INDEX "OutcomeEvidence_run_date_idx" ON "OutcomeEvidence"("extractionRunId", "sportsDate");
CREATE INDEX "OutcomeEvidence_hash_idx" ON "OutcomeEvidence"("evidenceHash");
CREATE UNIQUE INDEX "FixtureOutcome_run_decision_key" ON "FixtureOutcome"("extractionRunId", "matchDecisionId");
CREATE INDEX "FixtureOutcome_run_status_partition_idx" ON "FixtureOutcome"("extractionRunId", "reconciliationStatus", "partition");
CREATE UNIQUE INDEX "HistoricalEvaluationRun_identity_key" ON "HistoricalEvaluationRun"("specId", "extractionRunId", "engineVersion");
CREATE UNIQUE INDEX "PatternEvaluation_identity_key" ON "PatternEvaluation"("evaluationRunId", "patternDefinitionId", "partition", "segment", "side");
CREATE INDEX "PatternEvaluation_run_partition_idx" ON "PatternEvaluation"("evaluationRunId", "partition");
CREATE UNIQUE INDEX "CalibrationBucket_identity_key" ON "CalibrationBucket"("evaluationRunId", "patternDefinitionId", "partition", "side", "lowerBound", "upperBound");
CREATE INDEX "CalibrationBucket_run_partition_idx" ON "CalibrationBucket"("evaluationRunId", "partition");
CREATE INDEX "HistoricalAnalysisAuditEvent_type_created_idx" ON "HistoricalAnalysisAuditEvent"("eventType", "createdAt");

CREATE TRIGGER "HistoricalAnalysisSpec_no_update" BEFORE UPDATE ON "HistoricalAnalysisSpec" BEGIN SELECT RAISE(ABORT, 'HistoricalAnalysisSpec is append-only'); END;
CREATE TRIGGER "HistoricalAnalysisSpec_no_delete" BEFORE DELETE ON "HistoricalAnalysisSpec" BEGIN SELECT RAISE(ABORT, 'HistoricalAnalysisSpec is append-only'); END;
CREATE TRIGGER "PatternDefinition_no_update" BEFORE UPDATE ON "PatternDefinition" BEGIN SELECT RAISE(ABORT, 'PatternDefinition is append-only'); END;
CREATE TRIGGER "PatternDefinition_no_delete" BEFORE DELETE ON "PatternDefinition" BEGIN SELECT RAISE(ABORT, 'PatternDefinition is append-only'); END;
CREATE TRIGGER "OutcomeExtractionRun_no_update" BEFORE UPDATE ON "OutcomeExtractionRun" BEGIN SELECT RAISE(ABORT, 'OutcomeExtractionRun is append-only'); END;
CREATE TRIGGER "OutcomeExtractionRun_no_delete" BEFORE DELETE ON "OutcomeExtractionRun" BEGIN SELECT RAISE(ABORT, 'OutcomeExtractionRun is append-only'); END;
CREATE TRIGGER "OutcomeExtractionAttempt_no_update" BEFORE UPDATE ON "OutcomeExtractionAttempt" BEGIN SELECT RAISE(ABORT, 'OutcomeExtractionAttempt is append-only'); END;
CREATE TRIGGER "OutcomeExtractionAttempt_no_delete" BEFORE DELETE ON "OutcomeExtractionAttempt" BEGIN SELECT RAISE(ABORT, 'OutcomeExtractionAttempt is append-only'); END;
CREATE TRIGGER "OutcomeEvidence_no_update" BEFORE UPDATE ON "OutcomeEvidence" BEGIN SELECT RAISE(ABORT, 'OutcomeEvidence is append-only'); END;
CREATE TRIGGER "OutcomeEvidence_no_delete" BEFORE DELETE ON "OutcomeEvidence" BEGIN SELECT RAISE(ABORT, 'OutcomeEvidence is append-only'); END;
CREATE TRIGGER "FixtureOutcome_no_update" BEFORE UPDATE ON "FixtureOutcome" BEGIN SELECT RAISE(ABORT, 'FixtureOutcome is append-only'); END;
CREATE TRIGGER "FixtureOutcome_no_delete" BEFORE DELETE ON "FixtureOutcome" BEGIN SELECT RAISE(ABORT, 'FixtureOutcome is append-only'); END;
CREATE TRIGGER "HistoricalEvaluationRun_no_update" BEFORE UPDATE ON "HistoricalEvaluationRun" BEGIN SELECT RAISE(ABORT, 'HistoricalEvaluationRun is append-only'); END;
CREATE TRIGGER "HistoricalEvaluationRun_no_delete" BEFORE DELETE ON "HistoricalEvaluationRun" BEGIN SELECT RAISE(ABORT, 'HistoricalEvaluationRun is append-only'); END;
CREATE TRIGGER "HistoricalEvaluationAttempt_no_update" BEFORE UPDATE ON "HistoricalEvaluationAttempt" BEGIN SELECT RAISE(ABORT, 'HistoricalEvaluationAttempt is append-only'); END;
CREATE TRIGGER "HistoricalEvaluationAttempt_no_delete" BEFORE DELETE ON "HistoricalEvaluationAttempt" BEGIN SELECT RAISE(ABORT, 'HistoricalEvaluationAttempt is append-only'); END;
CREATE TRIGGER "PatternEvaluation_no_update" BEFORE UPDATE ON "PatternEvaluation" BEGIN SELECT RAISE(ABORT, 'PatternEvaluation is append-only'); END;
CREATE TRIGGER "PatternEvaluation_no_delete" BEFORE DELETE ON "PatternEvaluation" BEGIN SELECT RAISE(ABORT, 'PatternEvaluation is append-only'); END;
CREATE TRIGGER "CalibrationBucket_no_update" BEFORE UPDATE ON "CalibrationBucket" BEGIN SELECT RAISE(ABORT, 'CalibrationBucket is append-only'); END;
CREATE TRIGGER "CalibrationBucket_no_delete" BEFORE DELETE ON "CalibrationBucket" BEGIN SELECT RAISE(ABORT, 'CalibrationBucket is append-only'); END;
CREATE TRIGGER "HistoricalAnalysisAuditEvent_no_update" BEFORE UPDATE ON "HistoricalAnalysisAuditEvent" BEGIN SELECT RAISE(ABORT, 'HistoricalAnalysisAuditEvent is append-only'); END;
CREATE TRIGGER "HistoricalAnalysisAuditEvent_no_delete" BEFORE DELETE ON "HistoricalAnalysisAuditEvent" BEGIN SELECT RAISE(ABORT, 'HistoricalAnalysisAuditEvent is append-only'); END;
