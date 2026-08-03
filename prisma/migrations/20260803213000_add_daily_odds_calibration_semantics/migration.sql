ALTER TABLE "DailyAnalysisRun" ADD COLUMN "derivedFromRunId" TEXT;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "oddsResponseReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "oddsEventsReceived" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "oddsFixturesMatched" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "oddsMarketsMatched" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "usableOddsAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "marketEvaluationsCreated" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "oddsDiagnosticsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "historicalDatasetFound" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyAnalysisRun" ADD COLUMN "historicalMarketsCalibrated" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "bookmakerCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "consensusOdds" DECIMAL;
ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "datasetVersion" TEXT;
ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "calibrationStatus" TEXT NOT NULL DEFAULT 'MISSING_HISTORY';
ALTER TABLE "DailyMarketEvaluation" ADD COLUMN "matchingJson" TEXT NOT NULL DEFAULT '{}';
