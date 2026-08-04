ALTER TABLE "DailyAnalysisRun" ADD COLUMN "selectionPolicyVersion" TEXT;
ALTER TABLE "DailyRecommendation" ADD COLUMN "automaticCategory" TEXT NOT NULL DEFAULT 'PASS';

CREATE TABLE "DailySettlementRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAtUtc" DATETIME NOT NULL,
  "completedAtUtc" DATETIME NOT NULL,
  "eligibleFixtures" INTEGER NOT NULL,
  "requestsBudget" INTEGER NOT NULL,
  "requestsMade" INTEGER NOT NULL,
  "evidenceCreated" INTEGER NOT NULL,
  "outcomesCreated" INTEGER NOT NULL,
  "pendingFixtures" INTEGER NOT NULL,
  "warningsJson" TEXT NOT NULL,
  "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DailySettlementEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "settlementRunId" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "endpointKey" TEXT NOT NULL,
  "capturedAtUtc" DATETIME NOT NULL,
  "contentHash" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "mediaType" TEXT NOT NULL,
  "storageReference" TEXT NOT NULL,
  "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailySettlementEvidence_settlementRunId_fkey" FOREIGN KEY ("settlementRunId") REFERENCES "DailySettlementRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DailySettlementEvidence_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "DailyOutcome" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "settlementRunId" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "sourceEvidenceId" TEXT NOT NULL,
  "providerFixtureId" TEXT NOT NULL,
  "observedAtUtc" DATETIME NOT NULL,
  "providerTerminalStatus" TEXT NOT NULL CHECK ("providerTerminalStatus" IN ('FT','AET','PEN')),
  "result1X2" TEXT NOT NULL CHECK ("result1X2" IN ('HOME','DRAW','AWAY')),
  "regulationHomeScore" INTEGER NOT NULL,
  "regulationAwayScore" INTEGER NOT NULL,
  "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyOutcome_settlementRunId_fkey" FOREIGN KEY ("settlementRunId") REFERENCES "DailySettlementRun" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DailyOutcome_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DailyOutcome_sourceEvidenceId_fkey" FOREIGN KEY ("sourceEvidenceId") REFERENCES "DailySettlementEvidence" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "DailySettlementRun_completedAtUtc_idx" ON "DailySettlementRun"("completedAtUtc");
CREATE UNIQUE INDEX "DailySettlementEvidence_run_fixture_hash_key" ON "DailySettlementEvidence"("settlementRunId", "fixtureId", "contentHash");
CREATE INDEX "DailySettlementEvidence_fixture_captured_idx" ON "DailySettlementEvidence"("fixtureId", "capturedAtUtc");
CREATE UNIQUE INDEX "DailyOutcome_fixture_evidence_key" ON "DailyOutcome"("fixtureId", "sourceEvidenceId");
CREATE INDEX "DailyOutcome_fixture_observed_idx" ON "DailyOutcome"("fixtureId", "observedAtUtc");
CREATE INDEX "DailyOutcome_result_idx" ON "DailyOutcome"("result1X2");

CREATE TRIGGER "DailySettlementRun_no_update" BEFORE UPDATE ON "DailySettlementRun" BEGIN SELECT RAISE(ABORT, 'DailySettlementRun is append-only'); END;
CREATE TRIGGER "DailySettlementRun_no_delete" BEFORE DELETE ON "DailySettlementRun" BEGIN SELECT RAISE(ABORT, 'DailySettlementRun is append-only'); END;
CREATE TRIGGER "DailySettlementEvidence_no_update" BEFORE UPDATE ON "DailySettlementEvidence" BEGIN SELECT RAISE(ABORT, 'DailySettlementEvidence is append-only'); END;
CREATE TRIGGER "DailySettlementEvidence_no_delete" BEFORE DELETE ON "DailySettlementEvidence" BEGIN SELECT RAISE(ABORT, 'DailySettlementEvidence is append-only'); END;
CREATE TRIGGER "DailyOutcome_no_update" BEFORE UPDATE ON "DailyOutcome" BEGIN SELECT RAISE(ABORT, 'DailyOutcome is append-only'); END;
CREATE TRIGGER "DailyOutcome_no_delete" BEFORE DELETE ON "DailyOutcome" BEGIN SELECT RAISE(ABORT, 'DailyOutcome is append-only'); END;
