CREATE TABLE "MarketPriorityPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" = 'FROZEN'),
  "datasetId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "semanticRegistryHash" TEXT NOT NULL,
  "historicalAnalysisSpecHash" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "developmentEvidenceWindow" TEXT NOT NULL,
  "independentValidationStatus" TEXT NOT NULL,
  "prospectiveValidationRequired" BOOLEAN NOT NULL CHECK ("prospectiveValidationRequired" = 1),
  "priorityPolicyHash" TEXT NOT NULL,
  "canonicalPolicyJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MarketPriorityAssessmentRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyId" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL,
  "historicalEvaluationRunId" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "assessmentMode" TEXT NOT NULL CHECK ("assessmentMode" = 'RETROSPECTIVE_POLICY_DESIGN'),
  "outcomeEvaluationEnabled" BOOLEAN NOT NULL CHECK ("outcomeEvaluationEnabled" = 0),
  "status" TEXT NOT NULL CHECK ("status" = 'COMPLETED'),
  "fixtureCount" INTEGER NOT NULL CHECK ("fixtureCount" >= 0),
  "candidateCount" INTEGER NOT NULL CHECK ("candidateCount" >= 0),
  "familyDecisionCount" INTEGER NOT NULL CHECK ("familyDecisionCount" >= 0),
  "finalDecisionCount" INTEGER NOT NULL CHECK ("finalDecisionCount" >= 0),
  "candidateSetHash" TEXT NOT NULL,
  "familyDecisionSetHash" TEXT NOT NULL,
  "finalDecisionSetHash" TEXT NOT NULL,
  "assessmentHash" TEXT NOT NULL,
  "countsJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "networkRequestCount" INTEGER NOT NULL DEFAULT 0 CHECK ("networkRequestCount" = 0),
  "outcomeReadCount" INTEGER NOT NULL DEFAULT 0 CHECK ("outcomeReadCount" = 0),
  "exportPath" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketPriorityAssessmentRun_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "MarketPriorityPolicy" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "MarketPriorityAssessmentAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyId" TEXT NOT NULL,
  "assessmentRunId" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('CREATED','REUSED','FAILED')),
  "contextJson" TEXT NOT NULL,
  "networkRequestCount" INTEGER NOT NULL DEFAULT 0 CHECK ("networkRequestCount" = 0),
  "outcomeReadCount" INTEGER NOT NULL DEFAULT 0 CHECK ("outcomeReadCount" = 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketPriorityAssessmentAttempt_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "MarketPriorityPolicy" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MarketPriorityAssessmentAttempt_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "MarketPriorityAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "FixtureMarketCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentRunId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "sportsDate" DATETIME NOT NULL,
  "homeTeam" TEXT NOT NULL,
  "awayTeam" TEXT NOT NULL,
  "family" TEXT NOT NULL CHECK ("family" IN ('DOUBLE_CHANCE','OU25','SAME_MATCH_COMBINATION')),
  "marketCode" TEXT NOT NULL,
  "historicalPatternCode" TEXT,
  "matchingQualityClass" TEXT NOT NULL CHECK ("matchingQualityClass" IN ('EXACT','CONSERVATIVE','APPROXIMATE')),
  "strengthClass" TEXT,
  "confluenceCode" TEXT,
  "sourceEvidenceJson" TEXT NOT NULL,
  "signalScore" DECIMAL NOT NULL CHECK ("signalScore" >= 0 AND "signalScore" <= 40),
  "historicalEvidenceScore" DECIMAL NOT NULL CHECK ("historicalEvidenceScore" >= 0 AND "historicalEvidenceScore" <= 40),
  "dataQualityScore" DECIMAL NOT NULL CHECK ("dataQualityScore" >= 0 AND "dataQualityScore" <= 20),
  "rawPriorityScore" DECIMAL NOT NULL CHECK ("rawPriorityScore" >= 0 AND "rawPriorityScore" <= 100),
  "finalPriorityScore" DECIMAL NOT NULL CHECK ("finalPriorityScore" >= 0 AND "finalPriorityScore" <= 100),
  "priorityClass" TEXT NOT NULL CHECK ("priorityClass" IN ('HIGH','INTERESTING','TRACK','DO_NOT_PRIORITIZE')),
  "validationN" INTEGER NOT NULL CHECK ("validationN" >= 0),
  "validationHitRate" DECIMAL,
  "validationWilsonLower" DECIMAL,
  "stabilityClass" TEXT,
  "validationLift" DECIMAL,
  "maxCountryShare" DECIMAL,
  "maxCompetitionShare" DECIMAL,
  "blocked" BOOLEAN NOT NULL,
  "blockersJson" TEXT NOT NULL,
  "capsJson" TEXT NOT NULL,
  "reasonsJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "priceStatus" TEXT NOT NULL CHECK ("priceStatus" = 'NOT_EVALUATED'),
  "availableOdds" DECIMAL CHECK ("availableOdds" IS NULL),
  "marketValueStatus" TEXT NOT NULL CHECK ("marketValueStatus" = 'UNKNOWN'),
  "breakEvenComparisonStatus" TEXT NOT NULL CHECK ("breakEvenComparisonStatus" = 'NOT_AVAILABLE'),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixtureMarketCandidate_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "MarketPriorityAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "FixtureFamilyDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentRunId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "family" TEXT NOT NULL CHECK ("family" IN ('DOUBLE_CHANCE','OU25','SAME_MATCH_COMBINATION')),
  "chosenCandidateId" TEXT,
  "reasonCode" TEXT NOT NULL,
  "alternativesJson" TEXT NOT NULL,
  "tieBreakJson" TEXT NOT NULL,
  "blockersJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "priceStatus" TEXT NOT NULL CHECK ("priceStatus" = 'NOT_EVALUATED'),
  "availableOdds" DECIMAL CHECK ("availableOdds" IS NULL),
  "marketValueStatus" TEXT NOT NULL CHECK ("marketValueStatus" = 'UNKNOWN'),
  "breakEvenComparisonStatus" TEXT NOT NULL CHECK ("breakEvenComparisonStatus" = 'NOT_AVAILABLE'),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixtureFamilyDecision_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "MarketPriorityAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "FixturePreferredLineDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentRunId" TEXT NOT NULL,
  "matchDecisionId" TEXT NOT NULL,
  "selectionStatus" TEXT NOT NULL CHECK ("selectionStatus" IN ('PREFERRED','PROVISIONAL','NONE')),
  "selectedCandidateId" TEXT,
  "selectedMarketCode" TEXT,
  "selectedLineCount" INTEGER NOT NULL CHECK ("selectedLineCount" IN (0,1)),
  "topCandidateId" TEXT,
  "secondCandidateId" TEXT,
  "marginToSecond" DECIMAL,
  "reasonCode" TEXT NOT NULL,
  "reasonsJson" TEXT NOT NULL,
  "capsJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "priceStatus" TEXT NOT NULL CHECK ("priceStatus" = 'NOT_EVALUATED'),
  "availableOdds" DECIMAL CHECK ("availableOdds" IS NULL),
  "marketValueStatus" TEXT NOT NULL CHECK ("marketValueStatus" = 'UNKNOWN'),
  "breakEvenComparisonStatus" TEXT NOT NULL CHECK ("breakEvenComparisonStatus" = 'NOT_AVAILABLE'),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("selectionStatus" = 'NONE' AND "selectedLineCount" = 0 AND "selectedCandidateId" IS NULL AND "selectedMarketCode" IS NULL) OR ("selectionStatus" <> 'NONE' AND "selectedLineCount" = 1 AND "selectedCandidateId" IS NOT NULL AND "selectedMarketCode" IS NOT NULL)),
  CONSTRAINT "FixturePreferredLineDecision_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "MarketPriorityAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "MarketPriorityAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyId" TEXT,
  "assessmentRunId" TEXT,
  "eventType" TEXT NOT NULL,
  "contextJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketPriorityAuditEvent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "MarketPriorityPolicy" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MarketPriorityAuditEvent_assessmentRunId_fkey" FOREIGN KEY ("assessmentRunId") REFERENCES "MarketPriorityAssessmentRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "MarketPriorityPolicy_code_version_key" ON "MarketPriorityPolicy" ("code", "version");
CREATE UNIQUE INDEX "MarketPriorityPolicy_priorityPolicyHash_key" ON "MarketPriorityPolicy" ("priorityPolicyHash");
CREATE INDEX "MarketPriorityPolicy_dataset_spec_idx" ON "MarketPriorityPolicy" ("datasetId", "historicalAnalysisSpecHash");
CREATE UNIQUE INDEX "MarketPriorityAssessmentRun_identity_key" ON "MarketPriorityAssessmentRun" ("policyId", "datasetId", "historicalEvaluationRunId");
CREATE UNIQUE INDEX "MarketPriorityAssessmentRun_assessmentHash_key" ON "MarketPriorityAssessmentRun" ("assessmentHash");
CREATE INDEX "MarketPriorityAssessmentRun_status_created_idx" ON "MarketPriorityAssessmentRun" ("status", "createdAt");
CREATE INDEX "MarketPriorityAssessmentAttempt_policy_status_idx" ON "MarketPriorityAssessmentAttempt" ("policyId", "status");
CREATE UNIQUE INDEX "FixtureMarketCandidate_identity_key" ON "FixtureMarketCandidate" ("assessmentRunId", "matchDecisionId", "family", "marketCode");
CREATE INDEX "FixtureMarketCandidate_run_family_class_idx" ON "FixtureMarketCandidate" ("assessmentRunId", "family", "priorityClass");
CREATE UNIQUE INDEX "FixtureFamilyDecision_identity_key" ON "FixtureFamilyDecision" ("assessmentRunId", "matchDecisionId", "family");
CREATE INDEX "FixtureFamilyDecision_run_reason_idx" ON "FixtureFamilyDecision" ("assessmentRunId", "reasonCode");
CREATE UNIQUE INDEX "FixturePreferredLineDecision_identity_key" ON "FixturePreferredLineDecision" ("assessmentRunId", "matchDecisionId");
CREATE INDEX "FixturePreferredLineDecision_run_status_idx" ON "FixturePreferredLineDecision" ("assessmentRunId", "selectionStatus");
CREATE INDEX "MarketPriorityAuditEvent_type_created_idx" ON "MarketPriorityAuditEvent" ("eventType", "createdAt");

CREATE TRIGGER "MarketPriorityPolicy_no_update" BEFORE UPDATE ON "MarketPriorityPolicy" BEGIN SELECT RAISE(ABORT, 'MarketPriorityPolicy is append-only'); END;
CREATE TRIGGER "MarketPriorityPolicy_no_delete" BEFORE DELETE ON "MarketPriorityPolicy" BEGIN SELECT RAISE(ABORT, 'MarketPriorityPolicy is append-only'); END;
CREATE TRIGGER "MarketPriorityAssessmentRun_no_update" BEFORE UPDATE ON "MarketPriorityAssessmentRun" BEGIN SELECT RAISE(ABORT, 'MarketPriorityAssessmentRun is append-only'); END;
CREATE TRIGGER "MarketPriorityAssessmentRun_no_delete" BEFORE DELETE ON "MarketPriorityAssessmentRun" BEGIN SELECT RAISE(ABORT, 'MarketPriorityAssessmentRun is append-only'); END;
CREATE TRIGGER "MarketPriorityAssessmentAttempt_no_update" BEFORE UPDATE ON "MarketPriorityAssessmentAttempt" BEGIN SELECT RAISE(ABORT, 'MarketPriorityAssessmentAttempt is append-only'); END;
CREATE TRIGGER "MarketPriorityAssessmentAttempt_no_delete" BEFORE DELETE ON "MarketPriorityAssessmentAttempt" BEGIN SELECT RAISE(ABORT, 'MarketPriorityAssessmentAttempt is append-only'); END;
CREATE TRIGGER "FixtureMarketCandidate_no_update" BEFORE UPDATE ON "FixtureMarketCandidate" BEGIN SELECT RAISE(ABORT, 'FixtureMarketCandidate is append-only'); END;
CREATE TRIGGER "FixtureMarketCandidate_no_delete" BEFORE DELETE ON "FixtureMarketCandidate" BEGIN SELECT RAISE(ABORT, 'FixtureMarketCandidate is append-only'); END;
CREATE TRIGGER "FixtureFamilyDecision_no_update" BEFORE UPDATE ON "FixtureFamilyDecision" BEGIN SELECT RAISE(ABORT, 'FixtureFamilyDecision is append-only'); END;
CREATE TRIGGER "FixtureFamilyDecision_no_delete" BEFORE DELETE ON "FixtureFamilyDecision" BEGIN SELECT RAISE(ABORT, 'FixtureFamilyDecision is append-only'); END;
CREATE TRIGGER "FixturePreferredLineDecision_no_update" BEFORE UPDATE ON "FixturePreferredLineDecision" BEGIN SELECT RAISE(ABORT, 'FixturePreferredLineDecision is append-only'); END;
CREATE TRIGGER "FixturePreferredLineDecision_no_delete" BEFORE DELETE ON "FixturePreferredLineDecision" BEGIN SELECT RAISE(ABORT, 'FixturePreferredLineDecision is append-only'); END;
CREATE TRIGGER "MarketPriorityAuditEvent_no_update" BEFORE UPDATE ON "MarketPriorityAuditEvent" BEGIN SELECT RAISE(ABORT, 'MarketPriorityAuditEvent is append-only'); END;
CREATE TRIGGER "MarketPriorityAuditEvent_no_delete" BEFORE DELETE ON "MarketPriorityAuditEvent" BEGIN SELECT RAISE(ABORT, 'MarketPriorityAuditEvent is append-only'); END;
