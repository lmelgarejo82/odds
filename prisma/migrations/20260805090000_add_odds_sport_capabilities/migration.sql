CREATE TABLE "OddsSportCatalogSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "capturedAtUtc" DATETIME NOT NULL,
  "contentHash" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "OddsSportCatalogEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "snapshotId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "group" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL,
  "hasOutrights" BOOLEAN NOT NULL,
  "capturedAtUtc" DATETIME NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OddsSportCatalogEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OddsSportCatalogSnapshot" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "OddsSportCapability" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "sportKey" TEXT NOT NULL,
  "catalogActive" BOOLEAN NOT NULL,
  "eventsEndpointValidated" BOOLEAN NOT NULL,
  "h2hStatus" TEXT NOT NULL CHECK ("h2hStatus" IN ('UNKNOWN','SUPPORTED','UNSUPPORTED','TEMPORARILY_EMPTY')),
  "totalsStatus" TEXT NOT NULL CHECK ("totalsStatus" IN ('UNKNOWN','SUPPORTED','UNSUPPORTED','TEMPORARILY_EMPTY')),
  "regionsValidatedJson" TEXT NOT NULL,
  "lastHttpStatus" INTEGER,
  "lastProviderErrorCode" TEXT,
  "lastValidatedAt" DATETIME NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "catalogEvidenceReference" TEXT NOT NULL,
  "eventsEvidenceReference" TEXT,
  "h2hEvidenceReference" TEXT,
  "policyVersion" TEXT NOT NULL,
  "createdAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "OddsSportCatalogSnapshot_provider_capturedAtUtc_idx" ON "OddsSportCatalogSnapshot"("provider", "capturedAtUtc");
CREATE UNIQUE INDEX "OddsSportCatalogSnapshot_contentHash_capturedAtUtc_key" ON "OddsSportCatalogSnapshot"("contentHash", "capturedAtUtc");
CREATE UNIQUE INDEX "OddsSportCatalogEntry_snapshotId_key_key" ON "OddsSportCatalogEntry"("snapshotId", "key");
CREATE INDEX "OddsSportCatalogEntry_key_capturedAtUtc_idx" ON "OddsSportCatalogEntry"("key", "capturedAtUtc");
CREATE UNIQUE INDEX "OddsSportCapability_provider_sportKey_lastValidatedAt_policyVersion_key" ON "OddsSportCapability"("provider", "sportKey", "lastValidatedAt", "policyVersion");
CREATE INDEX "OddsSportCapability_provider_sportKey_lastValidatedAt_idx" ON "OddsSportCapability"("provider", "sportKey", "lastValidatedAt");

CREATE TRIGGER "OddsSportCatalogSnapshot_no_update" BEFORE UPDATE ON "OddsSportCatalogSnapshot" BEGIN SELECT RAISE(ABORT, 'OddsSportCatalogSnapshot is append-only'); END;
CREATE TRIGGER "OddsSportCatalogSnapshot_no_delete" BEFORE DELETE ON "OddsSportCatalogSnapshot" BEGIN SELECT RAISE(ABORT, 'OddsSportCatalogSnapshot is append-only'); END;
CREATE TRIGGER "OddsSportCatalogEntry_no_update" BEFORE UPDATE ON "OddsSportCatalogEntry" BEGIN SELECT RAISE(ABORT, 'OddsSportCatalogEntry is append-only'); END;
CREATE TRIGGER "OddsSportCatalogEntry_no_delete" BEFORE DELETE ON "OddsSportCatalogEntry" BEGIN SELECT RAISE(ABORT, 'OddsSportCatalogEntry is append-only'); END;
CREATE TRIGGER "OddsSportCapability_no_update" BEFORE UPDATE ON "OddsSportCapability" BEGIN SELECT RAISE(ABORT, 'OddsSportCapability is append-only'); END;
CREATE TRIGGER "OddsSportCapability_no_delete" BEFORE DELETE ON "OddsSportCapability" BEGIN SELECT RAISE(ABORT, 'OddsSportCapability is append-only'); END;
