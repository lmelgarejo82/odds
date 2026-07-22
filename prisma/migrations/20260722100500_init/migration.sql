-- CreateTable
CREATE TABLE "SourceArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "requestedDate" DATETIME NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "captureMethod" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FootballMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalKey" TEXT NOT NULL,
    "sportDate" DATETIME NOT NULL,
    "kickoffText" TEXT NOT NULL,
    "kickoffUtc" DATETIME,
    "country" TEXT NOT NULL,
    "competition" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ForebetOuSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "probabilityUnder25" DECIMAL NOT NULL,
    "probabilityOver25" DECIMAL NOT NULL,
    "prediction" TEXT NOT NULL,
    "predictedHomeGoals" DECIMAL NOT NULL,
    "predictedAwayGoals" DECIMAL NOT NULL,
    "averageGoals" DECIMAL NOT NULL,
    "sourceOdds" TEXT,
    "sourceRowHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForebetOuSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ForebetOuSnapshot_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatareaSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "homeProbability" DECIMAL NOT NULL,
    "drawProbability" DECIMAL NOT NULL,
    "awayProbability" DECIMAL NOT NULL,
    "halftimeHomeProbability" DECIMAL NOT NULL,
    "halftimeDrawProbability" DECIMAL NOT NULL,
    "halftimeAwayProbability" DECIMAL NOT NULL,
    "over15Value" DECIMAL NOT NULL,
    "over25Value" DECIMAL NOT NULL,
    "over35Value" DECIMAL NOT NULL,
    "btsValue" DECIMAL NOT NULL,
    "otsValue" DECIMAL NOT NULL,
    "tip" TEXT NOT NULL,
    "sourceRowHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatareaSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StatareaSnapshot_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrossSourceMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "forebetMatchId" TEXT,
    "statareaMatchId" TEXT,
    "status" TEXT NOT NULL,
    "matchingMethod" TEXT NOT NULL,
    "matchingScore" DECIMAL NOT NULL,
    "matchingDetailsJson" TEXT NOT NULL,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrossSourceMatch_forebetMatchId_fkey" FOREIGN KEY ("forebetMatchId") REFERENCES "FootballMatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrossSourceMatch_statareaMatchId_fkey" FOREIGN KEY ("statareaMatchId") REFERENCES "FootballMatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "homeGoals" INTEGER NOT NULL,
    "awayGoals" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "correctsResultId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MatchResult_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "SourceArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MatchResult_correctsResultId_fkey" FOREIGN KEY ("correctsResultId") REFERENCES "MatchResult" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "configurationJson" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnalysisSpecification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "configurationJson" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "HistoricalAnalysisReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "specificationId" TEXT NOT NULL,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "sourceDataHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricalAnalysisReport_specificationId_fkey" FOREIGN KEY ("specificationId") REFERENCES "AnalysisSpecification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyRanking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rankingDate" DATETIME NOT NULL,
    "analysisSpecificationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "sourceDataHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyRanking_analysisSpecificationId_fkey" FOREIGN KEY ("analysisSpecificationId") REFERENCES "AnalysisSpecification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyRankedCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dailyRankingId" TEXT NOT NULL,
    "crossSourceMatchId" TEXT NOT NULL,
    "suggestedSide" TEXT NOT NULL,
    "priorityScore" INTEGER NOT NULL,
    "signalScore" INTEGER NOT NULL,
    "historicalEvidenceScore" INTEGER NOT NULL,
    "dataQualityScore" INTEGER NOT NULL,
    "evidenceGrade" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "explanationHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyRankedCandidate_dailyRankingId_fkey" FOREIGN KEY ("dailyRankingId") REFERENCES "DailyRanking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyRankedCandidate_crossSourceMatchId_fkey" FOREIGN KEY ("crossSourceMatchId") REFERENCES "CrossSourceMatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackedObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rankedCandidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "capturedAt" DATETIME NOT NULL,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedObservation_rankedCandidateId_fkey" FOREIGN KEY ("rankedCandidateId") REFERENCES "DailyRankedCandidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceArtifact_contentHash_key" ON "SourceArtifact"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "FootballMatch_canonicalKey_key" ON "FootballMatch"("canonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ForebetOuSnapshot_sourceRowHash_key" ON "ForebetOuSnapshot"("sourceRowHash");

-- CreateIndex
CREATE UNIQUE INDEX "StatareaSnapshot_sourceRowHash_key" ON "StatareaSnapshot"("sourceRowHash");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_resultHash_key" ON "MatchResult"("resultHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchConfiguration_configurationHash_key" ON "ResearchConfiguration"("configurationHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchConfiguration_code_version_key" ON "ResearchConfiguration"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSpecification_configurationHash_key" ON "AnalysisSpecification"("configurationHash");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSpecification_code_version_key" ON "AnalysisSpecification"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalAnalysisReport_reportId_key" ON "HistoricalAnalysisReport"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalAnalysisReport_payloadHash_key" ON "HistoricalAnalysisReport"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRanking_rankingDate_analysisSpecificationId_sourceDataHash_key" ON "DailyRanking"("rankingDate", "analysisSpecificationId", "sourceDataHash");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRankedCandidate_explanationHash_key" ON "DailyRankedCandidate"("explanationHash");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRankedCandidate_dailyRankingId_rank_key" ON "DailyRankedCandidate"("dailyRankingId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventType_entityType_entityId_key" ON "AuditEvent"("eventType", "entityType", "entityId");
