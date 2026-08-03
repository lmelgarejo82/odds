-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stableKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sportsDate" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "competitionKey" TEXT NOT NULL,
    "competitionName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "round" TEXT NOT NULL,
    "kickoffAtUtc" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "sourceTimezone" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Fixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderFixtureIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "providerFixtureId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "providerCompetitionId" TEXT NOT NULL,
    "providerHomeTeamId" TEXT NOT NULL,
    "providerAwayTeamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "sourceDateRaw" TEXT NOT NULL,
    "sourceTimezone" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderFixtureIdentity_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProviderFixtureIdentity_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sportsDate" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scoringPolicyVersion" TEXT NOT NULL,
    "startedAtUtc" DATETIME NOT NULL,
    "completedAtUtc" DATETIME NOT NULL,
    "historicalCalibrationAvailable" BOOLEAN NOT NULL,
    "historicalDatasetHash" TEXT,
    "oddsAvailable" BOOLEAN NOT NULL,
    "marketValueCalculated" BOOLEAN NOT NULL,
    "fixturesDiscovered" INTEGER NOT NULL,
    "fixturesEligible" INTEGER NOT NULL,
    "fixturesDeepAnalyzed" INTEGER NOT NULL,
    "fixturesExcluded" INTEGER NOT NULL,
    "recommendations" INTEGER NOT NULL,
    "apiFootballBudget" INTEGER NOT NULL,
    "apiFootballRequests" INTEGER NOT NULL,
    "oddsBudget" INTEGER NOT NULL,
    "oddsRequests" INTEGER NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailyFixtureCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "deepAnalyzed" BOOLEAN NOT NULL,
    "discoveryOrdinal" INTEGER NOT NULL,
    "dataQuality" DECIMAL NOT NULL,
    "predictionJson" TEXT,
    "reasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyFixtureCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyAnalysisRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyFixtureCandidate_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyMarketEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "evaluationStatus" TEXT NOT NULL,
    "modelProbability" DECIMAL,
    "fairOdds" DECIMAL,
    "bestMarketOdds" DECIMAL,
    "marketImpliedProbability" DECIMAL,
    "marketMargin" DECIMAL,
    "noVigProbability" DECIMAL,
    "edge" DECIMAL,
    "expectedValue" DECIMAL,
    "bookmakerDispersion" DECIMAL,
    "historicalSample" INTEGER NOT NULL,
    "historicalHitRate" DECIMAL,
    "historicalBrierScore" DECIMAL,
    "wilsonLower95" DECIMAL,
    "wilsonUpper95" DECIMAL,
    "reasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyMarketEvaluation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "DailyFixtureCandidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "marketEvaluationId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "market" TEXT NOT NULL,
    "recommendationStatus" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL,
    "scoreTotal" DECIMAL NOT NULL,
    "modelConfidenceScore" DECIMAL NOT NULL,
    "historicalCalibrationScore" DECIMAL NOT NULL,
    "marketValueScore" DECIMAL NOT NULL,
    "contextualAgreementScore" DECIMAL NOT NULL,
    "dataQualityScore" DECIMAL NOT NULL,
    "penaltiesTotal" DECIMAL NOT NULL,
    "explanationJson" TEXT NOT NULL,
    "risksJson" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyRecommendation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "DailyFixtureCandidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyRecommendation_marketEvaluationId_fkey" FOREIGN KEY ("marketEvaluationId") REFERENCES "DailyMarketEvaluation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyExclusion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "providerFixtureId" TEXT,
    "fixtureLabel" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyExclusion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyAnalysisRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyRawEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "capturedAtUtc" DATETIME NOT NULL,
    "contentHash" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "storageReference" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyRawEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyAnalysisRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyProviderRequestAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAtUtc" DATETIME NOT NULL,
    "finishedAtUtc" DATETIME NOT NULL,
    "httpStatus" INTEGER,
    "classification" TEXT NOT NULL,
    "sanitizedErrorCode" TEXT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyProviderRequestAudit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DailyAnalysisRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyProviderRequestAudit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_stableKey_key" ON "Provider"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "Team_canonicalKey_key" ON "Team"("canonicalKey");

-- CreateIndex
CREATE INDEX "Fixture_sportsDate_kickoffAtUtc_idx" ON "Fixture"("sportsDate", "kickoffAtUtc");

-- CreateIndex
CREATE INDEX "Fixture_competitionKey_idx" ON "Fixture"("competitionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderFixtureIdentity_providerId_providerFixtureId_key" ON "ProviderFixtureIdentity"("providerId", "providerFixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderFixtureIdentity_providerId_fixtureId_key" ON "ProviderFixtureIdentity"("providerId", "fixtureId");

-- CreateIndex
CREATE INDEX "DailyAnalysisRun_sportsDate_completedAtUtc_idx" ON "DailyAnalysisRun"("sportsDate", "completedAtUtc");

-- CreateIndex
CREATE INDEX "DailyFixtureCandidate_runId_eligible_deepAnalyzed_idx" ON "DailyFixtureCandidate"("runId", "eligible", "deepAnalyzed");

-- CreateIndex
CREATE UNIQUE INDEX "DailyFixtureCandidate_runId_fixtureId_key" ON "DailyFixtureCandidate"("runId", "fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketEvaluation_candidateId_market_key" ON "DailyMarketEvaluation"("candidateId", "market");

-- CreateIndex
CREATE INDEX "DailyRecommendation_rank_classification_idx" ON "DailyRecommendation"("rank", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecommendation_candidateId_market_key" ON "DailyRecommendation"("candidateId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecommendation_candidateId_rank_key" ON "DailyRecommendation"("candidateId", "rank");

-- CreateIndex
CREATE INDEX "DailyExclusion_runId_reasonCode_idx" ON "DailyExclusion"("runId", "reasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRawEvidence_runId_providerKey_endpointKey_contentHash_key" ON "DailyRawEvidence"("runId", "providerKey", "endpointKey", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DailyProviderRequestAudit_runId_providerId_endpointKey_attemptNumber_key" ON "DailyProviderRequestAudit"("runId", "providerId", "endpointKey", "attemptNumber");

-- RedefineIndex
DROP INDEX "HistoricalAnalysisAuditEvent_type_created_idx";
CREATE INDEX "HistoricalAnalysisAuditEvent_eventType_createdAt_idx" ON "HistoricalAnalysisAuditEvent"("eventType", "createdAt");

-- RedefineIndex
DROP INDEX "MarketPriorityPolicy_dataset_spec_idx";
CREATE INDEX "MarketPriorityPolicy_datasetId_historicalAnalysisSpecHash_idx" ON "MarketPriorityPolicy"("datasetId", "historicalAnalysisSpecHash");

CREATE TRIGGER "Provider_no_update" BEFORE UPDATE ON "Provider" BEGIN SELECT RAISE(ABORT, 'Provider is append-only'); END;
CREATE TRIGGER "Provider_no_delete" BEFORE DELETE ON "Provider" BEGIN SELECT RAISE(ABORT, 'Provider is append-only'); END;
CREATE TRIGGER "Team_no_update" BEFORE UPDATE ON "Team" BEGIN SELECT RAISE(ABORT, 'Team is append-only'); END;
CREATE TRIGGER "Team_no_delete" BEFORE DELETE ON "Team" BEGIN SELECT RAISE(ABORT, 'Team is append-only'); END;
CREATE TRIGGER "Fixture_no_update" BEFORE UPDATE ON "Fixture" BEGIN SELECT RAISE(ABORT, 'Fixture is append-only'); END;
CREATE TRIGGER "Fixture_no_delete" BEFORE DELETE ON "Fixture" BEGIN SELECT RAISE(ABORT, 'Fixture is append-only'); END;
CREATE TRIGGER "ProviderFixtureIdentity_no_update" BEFORE UPDATE ON "ProviderFixtureIdentity" BEGIN SELECT RAISE(ABORT, 'ProviderFixtureIdentity is append-only'); END;
CREATE TRIGGER "ProviderFixtureIdentity_no_delete" BEFORE DELETE ON "ProviderFixtureIdentity" BEGIN SELECT RAISE(ABORT, 'ProviderFixtureIdentity is append-only'); END;
CREATE TRIGGER "DailyAnalysisRun_no_update" BEFORE UPDATE ON "DailyAnalysisRun" BEGIN SELECT RAISE(ABORT, 'DailyAnalysisRun is append-only'); END;
CREATE TRIGGER "DailyAnalysisRun_no_delete" BEFORE DELETE ON "DailyAnalysisRun" BEGIN SELECT RAISE(ABORT, 'DailyAnalysisRun is append-only'); END;
CREATE TRIGGER "DailyFixtureCandidate_no_update" BEFORE UPDATE ON "DailyFixtureCandidate" BEGIN SELECT RAISE(ABORT, 'DailyFixtureCandidate is append-only'); END;
CREATE TRIGGER "DailyFixtureCandidate_no_delete" BEFORE DELETE ON "DailyFixtureCandidate" BEGIN SELECT RAISE(ABORT, 'DailyFixtureCandidate is append-only'); END;
CREATE TRIGGER "DailyMarketEvaluation_no_update" BEFORE UPDATE ON "DailyMarketEvaluation" BEGIN SELECT RAISE(ABORT, 'DailyMarketEvaluation is append-only'); END;
CREATE TRIGGER "DailyMarketEvaluation_no_delete" BEFORE DELETE ON "DailyMarketEvaluation" BEGIN SELECT RAISE(ABORT, 'DailyMarketEvaluation is append-only'); END;
CREATE TRIGGER "DailyRecommendation_no_update" BEFORE UPDATE ON "DailyRecommendation" BEGIN SELECT RAISE(ABORT, 'DailyRecommendation is append-only'); END;
CREATE TRIGGER "DailyRecommendation_no_delete" BEFORE DELETE ON "DailyRecommendation" BEGIN SELECT RAISE(ABORT, 'DailyRecommendation is append-only'); END;
CREATE TRIGGER "DailyExclusion_no_update" BEFORE UPDATE ON "DailyExclusion" BEGIN SELECT RAISE(ABORT, 'DailyExclusion is append-only'); END;
CREATE TRIGGER "DailyExclusion_no_delete" BEFORE DELETE ON "DailyExclusion" BEGIN SELECT RAISE(ABORT, 'DailyExclusion is append-only'); END;
CREATE TRIGGER "DailyRawEvidence_no_update" BEFORE UPDATE ON "DailyRawEvidence" BEGIN SELECT RAISE(ABORT, 'DailyRawEvidence is append-only'); END;
CREATE TRIGGER "DailyRawEvidence_no_delete" BEFORE DELETE ON "DailyRawEvidence" BEGIN SELECT RAISE(ABORT, 'DailyRawEvidence is append-only'); END;
CREATE TRIGGER "DailyProviderRequestAudit_no_update" BEFORE UPDATE ON "DailyProviderRequestAudit" BEGIN SELECT RAISE(ABORT, 'DailyProviderRequestAudit is append-only'); END;
CREATE TRIGGER "DailyProviderRequestAudit_no_delete" BEFORE DELETE ON "DailyProviderRequestAudit" BEGIN SELECT RAISE(ABORT, 'DailyProviderRequestAudit is append-only'); END;
