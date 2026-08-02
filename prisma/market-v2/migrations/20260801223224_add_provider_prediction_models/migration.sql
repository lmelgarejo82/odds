CREATE TABLE "Provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stableKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProviderFixtureIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "providerFixtureId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "providerCompetitionId" TEXT,
    "providerHomeTeamId" TEXT,
    "providerAwayTeamId" TEXT,
    "season" TEXT,
    "round" TEXT,
    "sourceDateRaw" TEXT,
    "sourceTimestamp" TEXT,
    "sourceTimezone" TEXT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderFixtureIdentity_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProviderFixtureIdentity_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PredictionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerFixtureIdentityId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "capturedAtUtc" DATETIME NOT NULL,
    "predictionCapturedBeforeKickoff" BOOLEAN NOT NULL,
    "predictedWinnerProviderTeamId" TEXT,
    "predictedWinnerName" TEXT,
    "winnerComment" TEXT,
    "advice" TEXT,
    "underOverRaw" TEXT,
    "providerInternalTimestampRaw" TEXT,
    "probabilityTotalRaw" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PredictionSnapshot_providerFixtureIdentityId_fkey" FOREIGN KEY ("providerFixtureIdentityId") REFERENCES "ProviderFixtureIdentity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PredictionSnapshot_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PredictionSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PredictionProbability" (
    "predictionSnapshotId" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "rawPercentage" TEXT NOT NULL,
    "normalizedProbability" DECIMAL NOT NULL,
    PRIMARY KEY ("predictionSnapshotId", "selection"),
    CONSTRAINT "PredictionProbability_predictionSnapshotId_fkey" FOREIGN KEY ("predictionSnapshotId") REFERENCES "PredictionSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ProviderRequestAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "endpointKey" TEXT NOT NULL,
    "requestKeyHash" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAtUtc" DATETIME NOT NULL,
    "finishedAtUtc" DATETIME,
    "httpStatus" INTEGER,
    "classification" TEXT NOT NULL,
    "sanitizedErrorCode" TEXT,
    "dailyLimit" INTEGER,
    "dailyRemaining" INTEGER,
    "minuteLimit" INTEGER,
    "minuteRemaining" INTEGER,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderRequestAudit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProviderRequestAudit_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "Outcome" ADD COLUMN "providerTerminalStatusRaw" TEXT;
ALTER TABLE "Outcome" ADD COLUMN "result1X2Scope" TEXT;
ALTER TABLE "Outcome" ADD COLUMN "regulationHomeScore" INTEGER;
ALTER TABLE "Outcome" ADD COLUMN "regulationAwayScore" INTEGER;
ALTER TABLE "Outcome" ADD COLUMN "extraTimeHomeScore" INTEGER;
ALTER TABLE "Outcome" ADD COLUMN "extraTimeAwayScore" INTEGER;
ALTER TABLE "Outcome" ADD COLUMN "penaltyHomeScore" INTEGER;
ALTER TABLE "Outcome" ADD COLUMN "penaltyAwayScore" INTEGER;
ALTER TABLE "Outcome" ADD COLUMN "shootoutWinner" TEXT;

CREATE UNIQUE INDEX "Provider_stableKey_key" ON "Provider"("stableKey");
CREATE INDEX "ProviderFixtureIdentity_fixtureId_idx" ON "ProviderFixtureIdentity"("fixtureId");
CREATE INDEX "ProviderFixtureIdentity_providerId_providerCompetitionId_idx" ON "ProviderFixtureIdentity"("providerId", "providerCompetitionId");
CREATE UNIQUE INDEX "ProviderFixtureIdentity_providerId_providerFixtureId_key" ON "ProviderFixtureIdentity"("providerId", "providerFixtureId");
CREATE INDEX "PredictionSnapshot_sourceArtifactId_idx" ON "PredictionSnapshot"("sourceArtifactId");
CREATE INDEX "PredictionSnapshot_importBatchId_idx" ON "PredictionSnapshot"("importBatchId");
CREATE INDEX "PredictionSnapshot_contentHash_idx" ON "PredictionSnapshot"("contentHash");
CREATE UNIQUE INDEX "PredictionSnapshot_providerFixtureIdentityId_capturedAtUtc_key" ON "PredictionSnapshot"("providerFixtureIdentityId", "capturedAtUtc");
CREATE INDEX "ProviderRequestAudit_providerId_startedAtUtc_idx" ON "ProviderRequestAudit"("providerId", "startedAtUtc");
CREATE INDEX "ProviderRequestAudit_importBatchId_idx" ON "ProviderRequestAudit"("importBatchId");
CREATE UNIQUE INDEX "ProviderRequestAudit_requestKeyHash_attemptNumber_key" ON "ProviderRequestAudit"("requestKeyHash", "attemptNumber");

CREATE TRIGGER "market_v2_ProviderFixtureIdentity_no_update" BEFORE UPDATE ON "ProviderFixtureIdentity"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: ProviderFixtureIdentity UPDATE rejected'); END;
CREATE TRIGGER "market_v2_ProviderFixtureIdentity_no_delete" BEFORE DELETE ON "ProviderFixtureIdentity"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: ProviderFixtureIdentity DELETE rejected'); END;

CREATE TRIGGER "market_v2_PredictionSnapshot_no_update" BEFORE UPDATE ON "PredictionSnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: PredictionSnapshot UPDATE rejected'); END;
CREATE TRIGGER "market_v2_PredictionSnapshot_no_delete" BEFORE DELETE ON "PredictionSnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: PredictionSnapshot DELETE rejected'); END;

CREATE TRIGGER "market_v2_PredictionProbability_no_update" BEFORE UPDATE ON "PredictionProbability"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: PredictionProbability UPDATE rejected'); END;
CREATE TRIGGER "market_v2_PredictionProbability_no_delete" BEFORE DELETE ON "PredictionProbability"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: PredictionProbability DELETE rejected'); END;

CREATE TRIGGER "market_v2_ProviderRequestAudit_no_update" BEFORE UPDATE ON "ProviderRequestAudit"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: ProviderRequestAudit UPDATE rejected'); END;
CREATE TRIGGER "market_v2_ProviderRequestAudit_no_delete" BEFORE DELETE ON "ProviderRequestAudit"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: ProviderRequestAudit DELETE rejected'); END;
