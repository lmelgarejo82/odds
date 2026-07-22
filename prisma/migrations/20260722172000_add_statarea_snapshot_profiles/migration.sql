-- Additive R3 presentation metadata. Existing snapshots and historical events are preserved.
ALTER TABLE "HistoricalDatasetDay" ADD COLUMN "statareaProfileId" TEXT;
ALTER TABLE "HistoricalDatasetDay" ADD COLUMN "statareaSourcePresentation" TEXT;
ALTER TABLE "HistoricalImportTask" ADD COLUMN "sourcePresentation" TEXT;

CREATE TABLE "StatareaSnapshotProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "sourcePresentation" TEXT NOT NULL,
    "endpointTemplate" TEXT NOT NULL,
    "requestedUrl" TEXT NOT NULL,
    "finalUrl" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "capturePolicyVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatareaSnapshotProfile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StatareaCaptureSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "HistoricalDatasetCapturePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourcePresentation" TEXT NOT NULL,
    "endpointTemplate" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "minimumPauseMs" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "maxBytes" INTEGER NOT NULL,
    "maxRedirects" INTEGER NOT NULL,
    "maxTechnicalRetries" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricalDatasetCapturePolicy_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StatareaSnapshotProfile_snapshotId_key" ON "StatareaSnapshotProfile"("snapshotId");
CREATE UNIQUE INDEX "HistoricalDatasetCapturePolicy_datasetId_version_key" ON "HistoricalDatasetCapturePolicy"("datasetId", "version");

CREATE TRIGGER "StatareaSnapshotProfile_no_update" BEFORE UPDATE ON "StatareaSnapshotProfile" BEGIN SELECT RAISE(ABORT, 'StatareaSnapshotProfile is append-only'); END;
CREATE TRIGGER "StatareaSnapshotProfile_no_delete" BEFORE DELETE ON "StatareaSnapshotProfile" BEGIN SELECT RAISE(ABORT, 'StatareaSnapshotProfile is append-only'); END;
CREATE TRIGGER "HistoricalDatasetCapturePolicy_no_update" BEFORE UPDATE ON "HistoricalDatasetCapturePolicy" BEGIN SELECT RAISE(ABORT, 'HistoricalDatasetCapturePolicy is append-only'); END;
CREATE TRIGGER "HistoricalDatasetCapturePolicy_no_delete" BEFORE DELETE ON "HistoricalDatasetCapturePolicy" BEGIN SELECT RAISE(ABORT, 'HistoricalDatasetCapturePolicy is append-only'); END;
