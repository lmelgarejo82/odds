import { PrismaClient } from "@prisma/client";
import { HISTORY_CODE, HISTORY_VERSION } from "../src/domain/history/constants";

const prisma = new PrismaClient();
const date = (value: Date) => value.toISOString().slice(0, 10);

async function main() {
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({
    where: { code_version: { code: HISTORY_CODE, version: HISTORY_VERSION } },
  });
  const days = await prisma.historicalDatasetDay.findMany({
    where: { datasetId: dataset.id },
    orderBy: { sportsDate: "asc" },
  });
  const [selectedForebet, selectedStatarea, selectedRuns] = await Promise.all([
    prisma.forebetCaptureSnapshot.findMany({
      where: { id: { in: days.map((dayValue) => dayValue.forebetSnapshotId) } },
      include: { attempts: { orderBy: { capturedAt: "asc" } } },
    }),
    prisma.statareaCaptureSnapshot.findMany({
      where: { id: { in: days.map((dayValue) => dayValue.statareaSnapshotId) } },
      include: { attempts: { orderBy: { capturedAt: "asc" } }, profile: true },
    }),
    prisma.matchRun.findMany({ where: { id: { in: days.map((dayValue) => dayValue.matchRunId) } } }),
  ]);
  const forebetById = new Map(selectedForebet.map((snapshot) => [snapshot.id, snapshot]));
  const statareaById = new Map(selectedStatarea.map((snapshot) => [snapshot.id, snapshot]));
  const runById = new Map(selectedRuns.map((run) => [run.id, run]));
  const [
    latestState,
    forebetSnapshots,
    forebetRows,
    forebetRejections,
    forebetAttempts,
    statareaSnapshots,
    statareaRows,
    statareaRejections,
    statareaAttempts,
    modernProfiles,
    legacyProfiles,
    matchRuns,
    historicalMatchRuns,
    tasks,
    importRuns,
    auditEvents,
  ] = await Promise.all([
    prisma.historicalDatasetState.findFirst({
      where: { datasetId: dataset.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.forebetCaptureSnapshot.count(),
    prisma.forebetObservation.count(),
    prisma.forebetRowRejection.count(),
    prisma.forebetCaptureAttempt.count(),
    prisma.statareaCaptureSnapshot.count(),
    prisma.statareaRawRow.count(),
    prisma.statareaRowRejection.count(),
    prisma.statareaCaptureAttempt.count(),
    prisma.statareaSnapshotProfile.count({ where: { sourcePresentation: "MODERN" } }),
    prisma.statareaSnapshotProfile.count({ where: { sourcePresentation: "LEGACY_OFFICIAL" } }),
    prisma.matchRun.count(),
    prisma.matchRun.count({ where: { runType: "HISTORICAL_DATASET" } }),
    prisma.historicalImportTask.groupBy({ by: ["source", "state"], _count: true }),
    prisma.historicalImportRun.findMany({
      where: { datasetId: dataset.id },
      select: { id: true, startedAt: true, initialCompletedDates: true, networkRequestCount: true },
      orderBy: { startedAt: "asc" },
    }),
    prisma.historicalAuditEvent.groupBy({ by: ["eventType"], _count: true }),
  ]);
  const modernFailuresJulyOne = await prisma.statareaCaptureAttempt.findMany({
    where: {
      requestedDate: new Date("2026-07-01T00:00:00.000Z"),
      parserVersion: "statarea-daily-raw/1.0.0",
      status: "FAILED",
    },
    select: { id: true, errorCode: true, contentHash: true },
    orderBy: { capturedAt: "asc" },
  });
  console.log(
    JSON.stringify(
      {
        dataset: {
          id: dataset.id,
          code: dataset.code,
          version: dataset.version,
          latestState,
        },
        counts: {
          forebetSnapshots,
          forebetRows,
          forebetRejections,
          forebetAttempts,
          statareaSnapshots,
          statareaRows,
          statareaRejections,
          statareaAttempts,
          modernProfiles,
          legacyProfiles,
          matchRuns,
          historicalMatchRuns,
          days: days.length,
        },
        modernFailuresJulyOne,
        tasks,
        importRuns,
        auditEvents,
        days: days.map((dayValue) => {
          const forebet = forebetById.get(dayValue.forebetSnapshotId)!;
          const statarea = statareaById.get(dayValue.statareaSnapshotId)!;
          const run = runById.get(dayValue.matchRunId)!;
          return ({
          sportsDate: date(dayValue.sportsDate),
          partition: dayValue.partition,
          qualityStatus: dayValue.qualityStatus,
          forebet: {
            id: dayValue.forebetSnapshotId,
            hash: dayValue.forebetSha256,
            bytes: forebet.attempts.find(
              (attempt) => attempt.snapshotId === dayValue.forebetSnapshotId,
            )?.byteSize,
            parserVersion: dayValue.forebetParserVersion,
            rows: forebet.validRows,
            rejected: forebet.rejectedRows,
            warnings: forebet.warningCount,
          },
          statarea: {
            id: dayValue.statareaSnapshotId,
            profileId: dayValue.statareaProfileId,
            sourcePresentation: dayValue.statareaSourcePresentation,
            endpoint: statarea.profile?.finalUrl,
            hash: dayValue.statareaSha256,
            bytes: statarea.attempts.find(
              (attempt) => attempt.snapshotId === dayValue.statareaSnapshotId,
            )?.byteSize,
            parserVersion: dayValue.statareaParserVersion,
            rows: statarea.validRows,
            rejected: statarea.rejectedRows,
            warnings: statarea.warningCount,
          },
          matchRun: {
            id: dayValue.matchRunId,
            matched: run.matchedCount,
            ambiguous: run.ambiguousCount,
            onlyForebet: run.onlyForebetCount,
            onlyStatarea: run.onlyStatareaCount,
            conflict: run.conflictCount,
            exact: run.exactCount,
            conservative: run.conservativeCount,
            approximate: run.approximateCount,
            matcherVersion: run.matcherVersion,
            normalizerVersion: run.normalizerVersion,
            configurationHash: run.configurationHash,
          },
        })}),
      },
      null,
      2,
    ),
  );
}

void main().finally(() => prisma.$disconnect());
