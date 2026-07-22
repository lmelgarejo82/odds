-- CreateTable
CREATE TABLE "ForebetCaptureAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestedDate" DATETIME NOT NULL,
    "requestedUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "capturedAt" DATETIME NOT NULL,
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "contentHash" TEXT,
    "parserVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "warning" TEXT,
    "errorCode" TEXT,
    "snapshotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForebetCaptureAttempt_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForebetCaptureSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForebetCaptureSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceArtifactId" TEXT NOT NULL,
    "requestedDate" DATETIME NOT NULL,
    "contentHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "evidencePath" TEXT NOT NULL,
    "rowsFound" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "rejectedRows" INTEGER NOT NULL,
    "duplicateRows" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForebetCaptureSnapshot_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForebetObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'FOREBET',
    "sportDate" DATETIME NOT NULL,
    "homeTeamRaw" TEXT NOT NULL,
    "awayTeamRaw" TEXT NOT NULL,
    "competitionRaw" TEXT,
    "countryRaw" TEXT,
    "categoryRaw" TEXT,
    "kickoffRaw" TEXT,
    "suggestedSide" TEXT NOT NULL,
    "probabilityUnder25" DECIMAL,
    "probabilityOver25" DECIMAL,
    "predictedHomeGoals" INTEGER,
    "predictedAwayGoals" INTEGER,
    "averageGoals" DECIMAL,
    "sourceOdds" DECIMAL,
    "sourceRowKey" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "parseStatus" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForebetObservation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForebetCaptureSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForebetRowRejection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sourceRowKey" TEXT,
    "reasonCode" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForebetRowRejection_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForebetCaptureSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForebetCaptureAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "requestedDate" DATETIME NOT NULL,
    "snapshotId" TEXT,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ForebetCaptureSnapshot_requestedDate_contentHash_parserVersion_key" ON "ForebetCaptureSnapshot"("requestedDate", "contentHash", "parserVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ForebetObservation_snapshotId_sourceRowKey_key" ON "ForebetObservation"("snapshotId", "sourceRowKey");

-- CreateIndex
CREATE UNIQUE INDEX "ForebetRowRejection_snapshotId_rowIndex_key" ON "ForebetRowRejection"("snapshotId", "rowIndex");
