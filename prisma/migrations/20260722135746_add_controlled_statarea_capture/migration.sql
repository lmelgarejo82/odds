-- CreateTable
CREATE TABLE "StatareaCaptureAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestedDate" DATETIME NOT NULL,
    "requestedUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "hostname" TEXT,
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
    CONSTRAINT "StatareaCaptureAttempt_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StatareaCaptureSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatareaCaptureSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestedDate" DATETIME NOT NULL,
    "contentHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "evidencePath" TEXT NOT NULL,
    "exportPath" TEXT NOT NULL,
    "rawHeadersJson" TEXT NOT NULL,
    "semanticRegistryJson" TEXT NOT NULL,
    "rowsFound" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "rejectedRows" INTEGER NOT NULL,
    "duplicateRows" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StatareaRawRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'STATAREA',
    "requestedDate" DATETIME NOT NULL,
    "rowDateRaw" TEXT,
    "kickoffRaw" TEXT,
    "competitionRaw" TEXT,
    "countryRaw" TEXT,
    "categoryRaw" TEXT,
    "homeTeamRaw" TEXT NOT NULL,
    "awayTeamRaw" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "rowTextRaw" TEXT,
    "rawColumnsJson" TEXT NOT NULL,
    "structuralAttributesJson" TEXT NOT NULL,
    "sourceRowKey" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "parseStatus" TEXT NOT NULL,
    "semanticStatus" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatareaRawRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StatareaCaptureSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatareaRowRejection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sourceRowKey" TEXT,
    "reasonCode" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatareaRowRejection_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StatareaCaptureSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatareaCaptureAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "requestedDate" DATETIME NOT NULL,
    "snapshotId" TEXT,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "StatareaCaptureSnapshot_requestedDate_contentHash_parserVersion_key" ON "StatareaCaptureSnapshot"("requestedDate", "contentHash", "parserVersion");

-- CreateIndex
CREATE UNIQUE INDEX "StatareaRawRow_snapshotId_sourceRowKey_key" ON "StatareaRawRow"("snapshotId", "sourceRowKey");

-- CreateIndex
CREATE UNIQUE INDEX "StatareaRowRejection_snapshotId_rowIndex_key" ON "StatareaRowRejection"("snapshotId", "rowIndex");
