-- AlterTable
ALTER TABLE "MatchRun" ADD COLUMN "datasetId" TEXT;

-- CreateTable
CREATE TABLE "HistoricalDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dateFrom" DATETIME NOT NULL,
    "dateTo" DATETIME NOT NULL,
    "discoveryFrom" DATETIME NOT NULL,
    "discoveryTo" DATETIME NOT NULL,
    "validationFrom" DATETIME NOT NULL,
    "validationTo" DATETIME NOT NULL,
    "capturePolicyVersion" TEXT NOT NULL,
    "matcherVersion" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "matcherConfigurationHash" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "HistoricalDatasetDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "sportsDate" DATETIME NOT NULL,
    "partition" TEXT NOT NULL,
    "forebetSnapshotId" TEXT NOT NULL,
    "forebetSha256" TEXT NOT NULL,
    "statareaSnapshotId" TEXT NOT NULL,
    "statareaSha256" TEXT NOT NULL,
    "forebetParserVersion" TEXT NOT NULL,
    "statareaParserVersion" TEXT NOT NULL,
    "matchRunId" TEXT NOT NULL,
    "sourceCountsJson" TEXT NOT NULL,
    "matchCountsJson" TEXT NOT NULL,
    "qualityStatus" TEXT NOT NULL,
    "selectionReasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricalDatasetDay_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HistoricalImportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "requestedDatesJson" TEXT NOT NULL,
    "initialCompletedDates" INTEGER NOT NULL,
    "networkRequestCount" INTEGER NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricalImportRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HistoricalImportTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importRunId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sportsDate" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "attemptId" TEXT,
    "snapshotId" TEXT,
    "state" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "HistoricalDatasetState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completedDates" INTEGER NOT NULL,
    "failedDates" INTEGER NOT NULL,
    "manifestHash" TEXT,
    "manifestExportPath" TEXT,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "HistoricalAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "importRunId" TEXT,
    "eventType" TEXT NOT NULL,
    "sportsDate" DATETIME,
    "source" TEXT,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDataset_code_version_key" ON "HistoricalDataset"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDatasetDay_datasetId_sportsDate_key" ON "HistoricalDatasetDay"("datasetId", "sportsDate");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDatasetDay_datasetId_forebetSnapshotId_key" ON "HistoricalDatasetDay"("datasetId", "forebetSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDatasetDay_datasetId_statareaSnapshotId_key" ON "HistoricalDatasetDay"("datasetId", "statareaSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDatasetDay_datasetId_matchRunId_key" ON "HistoricalDatasetDay"("datasetId", "matchRunId");

CREATE TRIGGER "HistoricalDataset_no_update" BEFORE UPDATE ON "HistoricalDataset" BEGIN SELECT RAISE(ABORT, 'HistoricalDataset is append-only'); END;
CREATE TRIGGER "HistoricalDataset_no_delete" BEFORE DELETE ON "HistoricalDataset" BEGIN SELECT RAISE(ABORT, 'HistoricalDataset is append-only'); END;
CREATE TRIGGER "HistoricalDatasetDay_no_update" BEFORE UPDATE ON "HistoricalDatasetDay" BEGIN SELECT RAISE(ABORT, 'HistoricalDatasetDay is append-only'); END;
CREATE TRIGGER "HistoricalDatasetDay_no_delete" BEFORE DELETE ON "HistoricalDatasetDay" BEGIN SELECT RAISE(ABORT, 'HistoricalDatasetDay is append-only'); END;
CREATE TRIGGER "HistoricalImportRun_no_update" BEFORE UPDATE ON "HistoricalImportRun" BEGIN SELECT RAISE(ABORT, 'HistoricalImportRun is append-only'); END;
CREATE TRIGGER "HistoricalImportRun_no_delete" BEFORE DELETE ON "HistoricalImportRun" BEGIN SELECT RAISE(ABORT, 'HistoricalImportRun is append-only'); END;
CREATE TRIGGER "HistoricalImportTask_no_update" BEFORE UPDATE ON "HistoricalImportTask" BEGIN SELECT RAISE(ABORT, 'HistoricalImportTask is append-only'); END;
CREATE TRIGGER "HistoricalImportTask_no_delete" BEFORE DELETE ON "HistoricalImportTask" BEGIN SELECT RAISE(ABORT, 'HistoricalImportTask is append-only'); END;
CREATE TRIGGER "HistoricalDatasetState_no_update" BEFORE UPDATE ON "HistoricalDatasetState" BEGIN SELECT RAISE(ABORT, 'HistoricalDatasetState is append-only'); END;
CREATE TRIGGER "HistoricalDatasetState_no_delete" BEFORE DELETE ON "HistoricalDatasetState" BEGIN SELECT RAISE(ABORT, 'HistoricalDatasetState is append-only'); END;
CREATE TRIGGER "HistoricalAuditEvent_no_update" BEFORE UPDATE ON "HistoricalAuditEvent" BEGIN SELECT RAISE(ABORT, 'HistoricalAuditEvent is append-only'); END;
CREATE TRIGGER "HistoricalAuditEvent_no_delete" BEFORE DELETE ON "HistoricalAuditEvent" BEGIN SELECT RAISE(ABORT, 'HistoricalAuditEvent is append-only'); END;
