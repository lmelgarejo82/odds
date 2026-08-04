ALTER TABLE "DailyAnalysisRun" ADD COLUMN "aliasRegistryVersion" TEXT;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "matcherVersion" TEXT;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "fixturesMatchedExact" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "fixturesMatchedAlias" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "fixturesUnmatched" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "fixturesAmbiguous" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "usableOddsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "h2hMarketsMatched" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "totals25MarketsMatched" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "doubleChanceOffered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "offeredOddsStatus" TEXT NOT NULL DEFAULT 'OFFERED_ODDS_UNAVAILABLE';
ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "unsupportedMarketKeysJson" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "DailyRecommendation" ADD COLUMN "modelSuggestedMarket" TEXT;
ALTER TABLE "DailyRecommendation" ADD COLUMN "bestPricedMarket" TEXT;

CREATE TABLE "ProviderTeamAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKey" TEXT NOT NULL,
    "canonicalTeamId" TEXT NOT NULL,
    "providerAliasRaw" TEXT NOT NULL,
    "providerAliasNormalized" TEXT NOT NULL,
    "canonicalNameAtApproval" TEXT NOT NULL,
    "countryScope" TEXT,
    "competitionScope" TEXT,
    "scopeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('PROPOSED', 'APPROVED', 'REJECTED')),
    "approvalMethod" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "registryVersion" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderTeamAlias_canonicalTeamId_fkey" FOREIGN KEY ("canonicalTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProviderTeamAlias_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "DailyRawEvidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProviderTeamAlias_decision_key" ON "ProviderTeamAlias"("providerKey", "providerAliasNormalized", "scopeKey", "canonicalTeamId", "status", "registryVersion");
CREATE INDEX "ProviderTeamAlias_lookup_idx" ON "ProviderTeamAlias"("providerKey", "providerAliasNormalized", "scopeKey", "status");
CREATE INDEX "ProviderTeamAlias_canonicalTeamId_status_idx" ON "ProviderTeamAlias"("canonicalTeamId", "status");

CREATE TRIGGER "ProviderTeamAlias_no_update" BEFORE UPDATE ON "ProviderTeamAlias" BEGIN SELECT RAISE(ABORT, 'ProviderTeamAlias is append-only'); END;
CREATE TRIGGER "ProviderTeamAlias_no_delete" BEFORE DELETE ON "ProviderTeamAlias" BEGIN SELECT RAISE(ABORT, 'ProviderTeamAlias is append-only'); END;
