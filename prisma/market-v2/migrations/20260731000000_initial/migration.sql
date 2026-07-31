-- Market V2 is an independent schema. Apply only with
-- --schema prisma/market-v2/schema.prisma and never against a legacy database.

CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "startedAtUtc" DATETIME NOT NULL,
    "completedAtUtc" DATETIME,
    "status" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SourceArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importBatchId" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "capturedAtUtc" DATETIME NOT NULL,
    "mediaType" TEXT,
    "byteSize" BIGINT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceArtifact_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TeamAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "validFromUtc" DATETIME,
    "validToUtc" DATETIME,
    "sourceArtifactId" TEXT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamAlias_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeamAlias_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "localTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "competitionKey" TEXT NOT NULL,
    "kickoffAtUtc" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Fixture_localTeamId_fkey" FOREIGN KEY ("localTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Fixture_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ForebetSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "capturedAtUtc" DATETIME NOT NULL,
    "homeProbability" DECIMAL NOT NULL,
    "drawProbability" DECIMAL NOT NULL,
    "awayProbability" DECIMAL NOT NULL,
    "predictedScore" TEXT,
    "sourceArtifactId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForebetSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ForebetSnapshot_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Bookmaker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stableKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MarketDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stableKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "parameters" TEXT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MarketSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketDefinitionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "parameters" TEXT,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSelection_marketDefinitionId_fkey" FOREIGN KEY ("marketDefinitionId") REFERENCES "MarketDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OddsCaptureRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importBatchId" TEXT,
    "sourceName" TEXT NOT NULL,
    "startedAtUtc" DATETIME NOT NULL,
    "completedAtUtc" DATETIME,
    "status" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OddsCaptureRun_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "OddsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "bookmakerId" TEXT NOT NULL,
    "marketSelectionId" TEXT NOT NULL,
    "oddsCaptureRunId" TEXT NOT NULL,
    "capturedAtUtc" DATETIME NOT NULL,
    "decimalOdds" DECIMAL NOT NULL,
    "rawOdds" TEXT,
    "lineValue" DECIMAL,
    "marketStatus" TEXT NOT NULL,
    "isInPlay" BOOLEAN NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OddsSnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OddsSnapshot_bookmakerId_fkey" FOREIGN KEY ("bookmakerId") REFERENCES "Bookmaker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OddsSnapshot_marketSelectionId_fkey" FOREIGN KEY ("marketSelectionId") REFERENCES "MarketSelection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OddsSnapshot_oddsCaptureRunId_fkey" FOREIGN KEY ("oddsCaptureRunId") REFERENCES "OddsCaptureRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OddsSnapshot_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MarketProbabilitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "marketSelectionId" TEXT NOT NULL,
    "marginRemovalMethod" TEXT NOT NULL,
    "overround" DECIMAL NOT NULL,
    "probability" DECIMAL NOT NULL,
    "calculatedAtUtc" DATETIME NOT NULL,
    "version" TEXT NOT NULL,
    "inputSetHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketProbabilitySnapshot_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketProbabilitySnapshot_marketSelectionId_fkey" FOREIGN KEY ("marketSelectionId") REFERENCES "MarketSelection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MarketProbabilityInput" (
    "marketProbabilitySnapshotId" TEXT NOT NULL,
    "oddsSnapshotId" TEXT NOT NULL,
    "inputOrdinal" INTEGER NOT NULL,
    PRIMARY KEY ("marketProbabilitySnapshotId", "oddsSnapshotId"),
    CONSTRAINT "MarketProbabilityInput_marketProbabilitySnapshotId_fkey" FOREIGN KEY ("marketProbabilitySnapshotId") REFERENCES "MarketProbabilitySnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketProbabilityInput_oddsSnapshotId_fkey" FOREIGN KEY ("oddsSnapshotId") REFERENCES "OddsSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PreMatchDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "decidedAtUtc" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "selectedOddsSnapshotId" TEXT,
    "estimatedProbability" DECIMAL,
    "breakEvenProbability" DECIMAL,
    "estimatedEdge" DECIMAL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreMatchDecision_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PreMatchDecision_selectedOddsSnapshotId_fkey" FOREIGN KEY ("selectedOddsSnapshotId") REFERENCES "OddsSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "observedAtUtc" DATETIME NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "result1X2" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "supersedesOutcomeId" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Outcome_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Outcome_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Outcome_supersedesOutcomeId_fkey" FOREIGN KEY ("supersedesOutcomeId") REFERENCES "Outcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "preMatchDecisionId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "unitProfitLoss" DECIMAL NOT NULL,
    "settledAtUtc" DATETIME NOT NULL,
    "settlementPolicyVersion" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Settlement_preMatchDecisionId_fkey" FOREIGN KEY ("preMatchDecisionId") REFERENCES "PreMatchDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Settlement_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAtUtc" DATETIME NOT NULL,
    "completedAtUtc" DATETIME,
    "status" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DecisionEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationRunId" TEXT NOT NULL,
    "preMatchDecisionId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "resultCode" TEXT NOT NULL,
    "metricsJson" TEXT,
    "evaluatedAtUtc" DATETIME NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DecisionEvaluation_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DecisionEvaluation_preMatchDecisionId_fkey" FOREIGN KEY ("preMatchDecisionId") REFERENCES "PreMatchDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DecisionEvaluation_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ImportBatch_sourceType_startedAtUtc_idx" ON "ImportBatch"("sourceType", "startedAtUtc");
CREATE INDEX "SourceArtifact_importBatchId_idx" ON "SourceArtifact"("importBatchId");
CREATE UNIQUE INDEX "SourceArtifact_sourceName_sourceReference_sha256_key" ON "SourceArtifact"("sourceName", "sourceReference", "sha256");
CREATE UNIQUE INDEX "Team_canonicalKey_key" ON "Team"("canonicalKey");
CREATE INDEX "TeamAlias_teamId_idx" ON "TeamAlias"("teamId");
CREATE INDEX "TeamAlias_sourceArtifactId_idx" ON "TeamAlias"("sourceArtifactId");
CREATE UNIQUE INDEX "TeamAlias_sourceName_alias_validFromUtc_key" ON "TeamAlias"("sourceName", "alias", "validFromUtc");
CREATE INDEX "Fixture_competitionKey_kickoffAtUtc_idx" ON "Fixture"("competitionKey", "kickoffAtUtc");
CREATE INDEX "Fixture_localTeamId_idx" ON "Fixture"("localTeamId");
CREATE INDEX "Fixture_awayTeamId_idx" ON "Fixture"("awayTeamId");
CREATE INDEX "Fixture_sourceArtifactId_idx" ON "Fixture"("sourceArtifactId");
CREATE INDEX "ForebetSnapshot_fixtureId_capturedAtUtc_idx" ON "ForebetSnapshot"("fixtureId", "capturedAtUtc");
CREATE INDEX "ForebetSnapshot_sourceArtifactId_idx" ON "ForebetSnapshot"("sourceArtifactId");
CREATE UNIQUE INDEX "ForebetSnapshot_fixtureId_contentHash_key" ON "ForebetSnapshot"("fixtureId", "contentHash");
CREATE UNIQUE INDEX "Bookmaker_stableKey_key" ON "Bookmaker"("stableKey");
CREATE UNIQUE INDEX "MarketDefinition_stableKey_version_key" ON "MarketDefinition"("stableKey", "version");
CREATE INDEX "MarketSelection_marketDefinitionId_idx" ON "MarketSelection"("marketDefinitionId");
CREATE UNIQUE INDEX "MarketSelection_marketDefinitionId_stableKey_key" ON "MarketSelection"("marketDefinitionId", "stableKey");
CREATE INDEX "OddsCaptureRun_sourceName_startedAtUtc_idx" ON "OddsCaptureRun"("sourceName", "startedAtUtc");
CREATE INDEX "OddsCaptureRun_importBatchId_idx" ON "OddsCaptureRun"("importBatchId");
CREATE INDEX "OddsSnapshot_fixtureId_capturedAtUtc_idx" ON "OddsSnapshot"("fixtureId", "capturedAtUtc");
CREATE INDEX "OddsSnapshot_bookmakerId_idx" ON "OddsSnapshot"("bookmakerId");
CREATE INDEX "OddsSnapshot_marketSelectionId_idx" ON "OddsSnapshot"("marketSelectionId");
CREATE INDEX "OddsSnapshot_sourceArtifactId_idx" ON "OddsSnapshot"("sourceArtifactId");
CREATE UNIQUE INDEX "OddsSnapshot_oddsCaptureRunId_contentHash_key" ON "OddsSnapshot"("oddsCaptureRunId", "contentHash");
CREATE INDEX "MarketProbabilitySnapshot_fixtureId_calculatedAtUtc_idx" ON "MarketProbabilitySnapshot"("fixtureId", "calculatedAtUtc");
CREATE INDEX "MarketProbabilitySnapshot_marketSelectionId_idx" ON "MarketProbabilitySnapshot"("marketSelectionId");
CREATE UNIQUE INDEX "MarketProbabilitySnapshot_fixtureId_marketSelectionId_version_inputSetHash_key" ON "MarketProbabilitySnapshot"("fixtureId", "marketSelectionId", "version", "inputSetHash");
CREATE INDEX "MarketProbabilityInput_oddsSnapshotId_idx" ON "MarketProbabilityInput"("oddsSnapshotId");
CREATE UNIQUE INDEX "MarketProbabilityInput_marketProbabilitySnapshotId_inputOrdinal_key" ON "MarketProbabilityInput"("marketProbabilitySnapshotId", "inputOrdinal");
CREATE INDEX "PreMatchDecision_fixtureId_decidedAtUtc_idx" ON "PreMatchDecision"("fixtureId", "decidedAtUtc");
CREATE INDEX "PreMatchDecision_selectedOddsSnapshotId_idx" ON "PreMatchDecision"("selectedOddsSnapshotId");
CREATE UNIQUE INDEX "PreMatchDecision_fixtureId_policyVersion_inputHash_key" ON "PreMatchDecision"("fixtureId", "policyVersion", "inputHash");
CREATE INDEX "Outcome_fixtureId_observedAtUtc_idx" ON "Outcome"("fixtureId", "observedAtUtc");
CREATE INDEX "Outcome_sourceArtifactId_idx" ON "Outcome"("sourceArtifactId");
CREATE INDEX "Outcome_supersedesOutcomeId_idx" ON "Outcome"("supersedesOutcomeId");
CREATE UNIQUE INDEX "Outcome_fixtureId_contentHash_key" ON "Outcome"("fixtureId", "contentHash");
CREATE INDEX "Settlement_outcomeId_idx" ON "Settlement"("outcomeId");
CREATE UNIQUE INDEX "Settlement_preMatchDecisionId_outcomeId_settlementPolicyVersion_key" ON "Settlement"("preMatchDecisionId", "outcomeId", "settlementPolicyVersion");
CREATE INDEX "DecisionEvaluation_preMatchDecisionId_idx" ON "DecisionEvaluation"("preMatchDecisionId");
CREATE INDEX "DecisionEvaluation_outcomeId_idx" ON "DecisionEvaluation"("outcomeId");
CREATE UNIQUE INDEX "DecisionEvaluation_evaluationRunId_preMatchDecisionId_outcomeId_key" ON "DecisionEvaluation"("evaluationRunId", "preMatchDecisionId", "outcomeId");

-- SQLite-enforced append-only barriers. Corrections are new rows, never mutations.
CREATE TRIGGER "market_v2_SourceArtifact_no_update" BEFORE UPDATE ON "SourceArtifact"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: SourceArtifact UPDATE rejected'); END;
CREATE TRIGGER "market_v2_SourceArtifact_no_delete" BEFORE DELETE ON "SourceArtifact"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: SourceArtifact DELETE rejected'); END;

CREATE TRIGGER "market_v2_ForebetSnapshot_no_update" BEFORE UPDATE ON "ForebetSnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: ForebetSnapshot UPDATE rejected'); END;
CREATE TRIGGER "market_v2_ForebetSnapshot_no_delete" BEFORE DELETE ON "ForebetSnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: ForebetSnapshot DELETE rejected'); END;

CREATE TRIGGER "market_v2_OddsSnapshot_no_update" BEFORE UPDATE ON "OddsSnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: OddsSnapshot UPDATE rejected'); END;
CREATE TRIGGER "market_v2_OddsSnapshot_no_delete" BEFORE DELETE ON "OddsSnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: OddsSnapshot DELETE rejected'); END;

CREATE TRIGGER "market_v2_MarketProbabilitySnapshot_no_update" BEFORE UPDATE ON "MarketProbabilitySnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: MarketProbabilitySnapshot UPDATE rejected'); END;
CREATE TRIGGER "market_v2_MarketProbabilitySnapshot_no_delete" BEFORE DELETE ON "MarketProbabilitySnapshot"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: MarketProbabilitySnapshot DELETE rejected'); END;

CREATE TRIGGER "market_v2_MarketProbabilityInput_no_update" BEFORE UPDATE ON "MarketProbabilityInput"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: MarketProbabilityInput UPDATE rejected'); END;
CREATE TRIGGER "market_v2_MarketProbabilityInput_no_delete" BEFORE DELETE ON "MarketProbabilityInput"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: MarketProbabilityInput DELETE rejected'); END;

CREATE TRIGGER "market_v2_PreMatchDecision_no_update" BEFORE UPDATE ON "PreMatchDecision"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: PreMatchDecision UPDATE rejected'); END;
CREATE TRIGGER "market_v2_PreMatchDecision_no_delete" BEFORE DELETE ON "PreMatchDecision"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: PreMatchDecision DELETE rejected'); END;

CREATE TRIGGER "market_v2_Outcome_no_update" BEFORE UPDATE ON "Outcome"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: Outcome UPDATE rejected'); END;
CREATE TRIGGER "market_v2_Outcome_no_delete" BEFORE DELETE ON "Outcome"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: Outcome DELETE rejected'); END;

CREATE TRIGGER "market_v2_Settlement_no_update" BEFORE UPDATE ON "Settlement"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: Settlement UPDATE rejected'); END;
CREATE TRIGGER "market_v2_Settlement_no_delete" BEFORE DELETE ON "Settlement"
BEGIN SELECT RAISE(ABORT, 'MARKET_V2_APPEND_ONLY: Settlement DELETE rejected'); END;
