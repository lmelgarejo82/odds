CREATE TABLE "ProspectiveShadowRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sportsDate" DATETIME NOT NULL,
  "forebetSnapshotId" TEXT NOT NULL,
  "statareaSnapshotId" TEXT NOT NULL,
  "matchRunId" TEXT NOT NULL,
  "matcherVersion" TEXT NOT NULL,
  "normalizerVersion" TEXT NOT NULL,
  "matcherConfigurationHash" TEXT NOT NULL,
  "registryHash" TEXT NOT NULL,
  "historicalAnalysisSpecHash" TEXT NOT NULL,
  "priorityPolicyHash" TEXT NOT NULL,
  "mode" TEXT NOT NULL CHECK ("mode" = 'PROSPECTIVE_SHADOW'),
  "status" TEXT NOT NULL CHECK ("status" = 'FROZEN'),
  "outcomeEvaluationEnabled" BOOLEAN NOT NULL DEFAULT 0 CHECK ("outcomeEvaluationEnabled" = 0),
  "priceEvaluationEnabled" BOOLEAN NOT NULL DEFAULT 0 CHECK ("priceEvaluationEnabled" = 0),
  "frozenBeforeOutcome" BOOLEAN NOT NULL DEFAULT 1 CHECK ("frozenBeforeOutcome" = 1),
  "frozenAt" DATETIME NOT NULL,
  "fixtureCount" INTEGER NOT NULL CHECK ("fixtureCount" > 0),
  "countsJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "runHash" TEXT NOT NULL,
  "exportPath" TEXT NOT NULL,
  "networkRequestCount" INTEGER NOT NULL DEFAULT 0 CHECK ("networkRequestCount" >= 0 AND "networkRequestCount" <= 2),
  "outcomeReadCount" INTEGER NOT NULL DEFAULT 0 CHECK ("outcomeReadCount" = 0),
  "quoteCaptureCount" INTEGER NOT NULL DEFAULT 0 CHECK ("quoteCaptureCount" = 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProspectiveShadowAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "prospectiveRunId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('CREATED','REUSED','FAILED')),
  "networkRequestCount" INTEGER NOT NULL DEFAULT 0 CHECK ("networkRequestCount" >= 0 AND "networkRequestCount" <= 2),
  "outcomeReadCount" INTEGER NOT NULL DEFAULT 0 CHECK ("outcomeReadCount" = 0),
  "quoteCaptureCount" INTEGER NOT NULL DEFAULT 0 CHECK ("quoteCaptureCount" = 0),
  "contextJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectiveShadowAttempt_prospectiveRunId_fkey" FOREIGN KEY ("prospectiveRunId") REFERENCES "ProspectiveShadowRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProspectiveSemanticProjection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "prospectiveRunId" TEXT NOT NULL,
  "rawRowId" TEXT NOT NULL,
  "sourceHomeWinPercent" DECIMAL,
  "sourceDrawPercent" DECIMAL,
  "sourceAwayWinPercent" DECIMAL,
  "sourceDoubleChance1XPercent" DECIMAL,
  "sourceDoubleChanceX2Percent" DECIMAL,
  "sourceDoubleChance12Percent" DECIMAL,
  "sourceOver25Percent" DECIMAL,
  "sourceUnder25Percent" DECIMAL,
  "ou25SemanticReady" BOOLEAN NOT NULL,
  "doubleChanceSemanticReady" BOOLEAN NOT NULL,
  "qualityStatus" TEXT NOT NULL CHECK ("qualityStatus" IN ('READY','READY_WITH_WARNINGS','INSUFFICIENT','REJECTED')),
  "warningsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectiveSemanticProjection_prospectiveRunId_fkey" FOREIGN KEY ("prospectiveRunId") REFERENCES "ProspectiveShadowRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProspectiveCandidateSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "prospectiveRunId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "family" TEXT NOT NULL CHECK ("family" IN ('DOUBLE_CHANCE','OU25','SAME_MATCH_COMBINATION')),
  "marketCode" TEXT NOT NULL,
  "componentsJson" TEXT NOT NULL,
  "signalScore" DECIMAL NOT NULL CHECK ("signalScore" >= 0 AND "signalScore" <= 40),
  "historicalEvidenceScore" DECIMAL NOT NULL CHECK ("historicalEvidenceScore" >= 0 AND "historicalEvidenceScore" <= 40),
  "dataQualityScore" DECIMAL NOT NULL CHECK ("dataQualityScore" >= 0 AND "dataQualityScore" <= 20),
  "finalPriorityScore" DECIMAL NOT NULL CHECK ("finalPriorityScore" >= 0 AND "finalPriorityScore" <= 100),
  "priorityClass" TEXT NOT NULL CHECK ("priorityClass" IN ('HIGH','INTERESTING','TRACK','DO_NOT_PRIORITIZE')),
  "blocked" BOOLEAN NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectiveCandidateSnapshot_prospectiveRunId_fkey" FOREIGN KEY ("prospectiveRunId") REFERENCES "ProspectiveShadowRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProspectiveFixtureAssessment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "prospectiveRunId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "sportsDate" DATETIME NOT NULL,
  "fixtureIdentityJson" TEXT NOT NULL,
  "dcCandidateId" TEXT,
  "ouCandidateId" TEXT,
  "combinationCandidateId" TEXT,
  "prePricePreferenceCandidateId" TEXT,
  "prePriceTopCandidateId" TEXT,
  "prePriceSecondCandidateId" TEXT,
  "prePriceSelectionStatus" TEXT NOT NULL CHECK ("prePriceSelectionStatus" IN ('PREFERRED','PROVISIONAL','NONE')),
  "prePriceScoreMargin" DECIMAL,
  "priceEvaluationStatus" TEXT NOT NULL CHECK ("priceEvaluationStatus" = 'NOT_CAPTURED'),
  "decisionFrozenAt" DATETIME NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "contractJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectiveFixtureAssessment_prospectiveRunId_fkey" FOREIGN KEY ("prospectiveRunId") REFERENCES "ProspectiveShadowRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "QuoteRequestPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "prospectiveRunId" TEXT NOT NULL,
  "fixtureAssessmentId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "sportsDate" DATETIME NOT NULL,
  "fixtureIdentityRawJson" TEXT NOT NULL,
  "homeTeamRaw" TEXT NOT NULL,
  "awayTeamRaw" TEXT NOT NULL,
  "competitionRaw" TEXT,
  "countryRaw" TEXT,
  "scheduledKickoffRaw" TEXT,
  "family" TEXT NOT NULL CHECK ("family" IN ('DOUBLE_CHANCE','OU25','SAME_MATCH_COMBINATION')),
  "internalMarketCode" TEXT NOT NULL,
  "componentsJson" TEXT NOT NULL,
  "bookmaker" TEXT NOT NULL CHECK ("bookmaker" = 'APOSTALA'),
  "bookmakerMarketCode" TEXT NOT NULL CHECK ("bookmakerMarketCode" = 'UNRESOLVED'),
  "bookmakerMarketLabel" TEXT NOT NULL CHECK ("bookmakerMarketLabel" = 'UNRESOLVED'),
  "prePricePriorityScore" DECIMAL NOT NULL CHECK ("prePricePriorityScore" >= 0 AND "prePricePriorityScore" <= 100),
  "prePricePriorityClass" TEXT NOT NULL CHECK ("prePricePriorityClass" IN ('HIGH','INTERESTING','TRACK','DO_NOT_PRIORITIZE')),
  "prePriceSelectionStatus" TEXT NOT NULL CHECK ("prePriceSelectionStatus" IN ('PREFERRED','PROVISIONAL','NONE')),
  "quoteRequired" BOOLEAN NOT NULL CHECK ("quoteRequired" = 1),
  "priceStatus" TEXT NOT NULL CHECK ("priceStatus" = 'NOT_CAPTURED'),
  "availableOdds" DECIMAL CHECK ("availableOdds" IS NULL),
  "marketValueStatus" TEXT NOT NULL CHECK ("marketValueStatus" = 'UNKNOWN'),
  "warningsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteRequestPlan_prospectiveRunId_fkey" FOREIGN KEY ("prospectiveRunId") REFERENCES "ProspectiveShadowRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "QuoteRequestPlan_fixtureAssessmentId_fkey" FOREIGN KEY ("fixtureAssessmentId") REFERENCES "ProspectiveFixtureAssessment" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "ProspectiveAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "prospectiveRunId" TEXT,
  "eventType" TEXT NOT NULL,
  "contextJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectiveAuditEvent_prospectiveRunId_fkey" FOREIGN KEY ("prospectiveRunId") REFERENCES "ProspectiveShadowRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "ProspectiveShadowRun_runHash_key" ON "ProspectiveShadowRun"("runHash");
CREATE UNIQUE INDEX "ProspectiveShadowRun_sportsDate_forebetSnapshotId_statareaSnapshotId_matcherVersion_normalizerVersion_matcherConfigurationHash_registryHash_priorityPolicyHash_mode_key" ON "ProspectiveShadowRun"("sportsDate", "forebetSnapshotId", "statareaSnapshotId", "matcherVersion", "normalizerVersion", "matcherConfigurationHash", "registryHash", "priorityPolicyHash", "mode");
CREATE INDEX "ProspectiveShadowRun_sportsDate_status_idx" ON "ProspectiveShadowRun"("sportsDate", "status");
CREATE INDEX "ProspectiveShadowAttempt_prospectiveRunId_status_idx" ON "ProspectiveShadowAttempt"("prospectiveRunId", "status");
CREATE UNIQUE INDEX "ProspectiveSemanticProjection_prospectiveRunId_rawRowId_key" ON "ProspectiveSemanticProjection"("prospectiveRunId", "rawRowId");
CREATE INDEX "ProspectiveSemanticProjection_prospectiveRunId_qualityStatus_idx" ON "ProspectiveSemanticProjection"("prospectiveRunId", "qualityStatus");
CREATE UNIQUE INDEX "ProspectiveCandidateSnapshot_prospectiveRunId_matchDecisionId_family_marketCode_key" ON "ProspectiveCandidateSnapshot"("prospectiveRunId", "matchDecisionId", "family", "marketCode");
CREATE INDEX "ProspectiveCandidateSnapshot_prospectiveRunId_family_priorityClass_idx" ON "ProspectiveCandidateSnapshot"("prospectiveRunId", "family", "priorityClass");
CREATE UNIQUE INDEX "ProspectiveFixtureAssessment_prospectiveRunId_matchDecisionId_key" ON "ProspectiveFixtureAssessment"("prospectiveRunId", "matchDecisionId");
CREATE INDEX "ProspectiveFixtureAssessment_prospectiveRunId_prePriceSelectionStatus_idx" ON "ProspectiveFixtureAssessment"("prospectiveRunId", "prePriceSelectionStatus");
CREATE UNIQUE INDEX "QuoteRequestPlan_prospectiveRunId_fixtureAssessmentId_family_key" ON "QuoteRequestPlan"("prospectiveRunId", "fixtureAssessmentId", "family");
CREATE INDEX "QuoteRequestPlan_prospectiveRunId_family_idx" ON "QuoteRequestPlan"("prospectiveRunId", "family");
CREATE INDEX "ProspectiveAuditEvent_eventType_createdAt_idx" ON "ProspectiveAuditEvent"("eventType", "createdAt");

CREATE TRIGGER "ProspectiveShadowRun_no_update" BEFORE UPDATE ON "ProspectiveShadowRun" BEGIN SELECT RAISE(ABORT, 'ProspectiveShadowRun is append-only'); END;
CREATE TRIGGER "ProspectiveShadowRun_no_delete" BEFORE DELETE ON "ProspectiveShadowRun" BEGIN SELECT RAISE(ABORT, 'ProspectiveShadowRun is append-only'); END;
CREATE TRIGGER "ProspectiveShadowAttempt_no_update" BEFORE UPDATE ON "ProspectiveShadowAttempt" BEGIN SELECT RAISE(ABORT, 'ProspectiveShadowAttempt is append-only'); END;
CREATE TRIGGER "ProspectiveShadowAttempt_no_delete" BEFORE DELETE ON "ProspectiveShadowAttempt" BEGIN SELECT RAISE(ABORT, 'ProspectiveShadowAttempt is append-only'); END;
CREATE TRIGGER "ProspectiveSemanticProjection_no_update" BEFORE UPDATE ON "ProspectiveSemanticProjection" BEGIN SELECT RAISE(ABORT, 'ProspectiveSemanticProjection is append-only'); END;
CREATE TRIGGER "ProspectiveSemanticProjection_no_delete" BEFORE DELETE ON "ProspectiveSemanticProjection" BEGIN SELECT RAISE(ABORT, 'ProspectiveSemanticProjection is append-only'); END;
CREATE TRIGGER "ProspectiveCandidateSnapshot_no_update" BEFORE UPDATE ON "ProspectiveCandidateSnapshot" BEGIN SELECT RAISE(ABORT, 'ProspectiveCandidateSnapshot is append-only'); END;
CREATE TRIGGER "ProspectiveCandidateSnapshot_no_delete" BEFORE DELETE ON "ProspectiveCandidateSnapshot" BEGIN SELECT RAISE(ABORT, 'ProspectiveCandidateSnapshot is append-only'); END;
CREATE TRIGGER "ProspectiveFixtureAssessment_no_update" BEFORE UPDATE ON "ProspectiveFixtureAssessment" BEGIN SELECT RAISE(ABORT, 'ProspectiveFixtureAssessment is append-only'); END;
CREATE TRIGGER "ProspectiveFixtureAssessment_no_delete" BEFORE DELETE ON "ProspectiveFixtureAssessment" BEGIN SELECT RAISE(ABORT, 'ProspectiveFixtureAssessment is append-only'); END;
CREATE TRIGGER "QuoteRequestPlan_no_update" BEFORE UPDATE ON "QuoteRequestPlan" BEGIN SELECT RAISE(ABORT, 'QuoteRequestPlan is append-only'); END;
CREATE TRIGGER "QuoteRequestPlan_no_delete" BEFORE DELETE ON "QuoteRequestPlan" BEGIN SELECT RAISE(ABORT, 'QuoteRequestPlan is append-only'); END;
CREATE TRIGGER "ProspectiveAuditEvent_no_update" BEFORE UPDATE ON "ProspectiveAuditEvent" BEGIN SELECT RAISE(ABORT, 'ProspectiveAuditEvent is append-only'); END;
CREATE TRIGGER "ProspectiveAuditEvent_no_delete" BEFORE DELETE ON "ProspectiveAuditEvent" BEGIN SELECT RAISE(ABORT, 'ProspectiveAuditEvent is append-only'); END;
