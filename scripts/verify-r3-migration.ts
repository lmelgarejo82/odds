import { PrismaClient } from "@prisma/client";
import {
  ensureLegacyRecoveryPolicy,
  ensureModernStatareaProfiles,
} from "../src/application/statarea-profiles";
import { HISTORY_CODE, HISTORY_VERSION } from "../src/domain/history/constants";

const prisma = new PrismaClient();

async function mustReject(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if (
      (error instanceof Error && error.message.includes("append-only")) ||
      (typeof error === "object" && error !== null && "code" in error && error.code === "P2003")
    )
      return true;
    throw error;
  }
  throw new Error(`${label}_WAS_NOT_REJECTED`);
}

async function main() {
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({
    where: { code_version: { code: HISTORY_CODE, version: HISTORY_VERSION } },
  });
  const before = {
    snapshots: await prisma.statareaCaptureSnapshot.count(),
    attempts: await prisma.statareaCaptureAttempt.count(),
    rows: await prisma.statareaRawRow.count(),
    profiles: await prisma.statareaSnapshotProfile.count(),
    policies: await prisma.historicalDatasetCapturePolicy.count(),
  };
  const modernProfilesCreated = await ensureModernStatareaProfiles(prisma);
  const modernProfilesCreatedOnReplay = await ensureModernStatareaProfiles(prisma);
  const policyCreated = await ensureLegacyRecoveryPolicy(prisma, dataset.id);
  const policyCreatedOnReplay = await ensureLegacyRecoveryPolicy(prisma, dataset.id);
  const profile = await prisma.statareaSnapshotProfile.findFirstOrThrow();
  const policy = await prisma.historicalDatasetCapturePolicy.findFirstOrThrow({
    where: { datasetId: dataset.id },
  });
  const profileUpdateRejected = await mustReject("PROFILE_UPDATE", () =>
    prisma.statareaSnapshotProfile.update({
      where: { id: profile.id },
      data: { finalUrl: `${profile.finalUrl}#forbidden` },
    }),
  );
  const profileDeleteRejected = await mustReject("PROFILE_DELETE", () =>
    prisma.statareaSnapshotProfile.delete({ where: { id: profile.id } }),
  );
  const policyUpdateRejected = await mustReject("POLICY_UPDATE", () =>
    prisma.historicalDatasetCapturePolicy.update({
      where: { id: policy.id },
      data: { maxBytes: policy.maxBytes + 1 },
    }),
  );
  const policyDeleteRejected = await mustReject("POLICY_DELETE", () =>
    prisma.historicalDatasetCapturePolicy.delete({ where: { id: policy.id } }),
  );
  const datasetDay = await prisma.historicalDatasetDay.findFirst({ where: { datasetId: dataset.id } });
  const datasetDayUpdateRejected = datasetDay
    ? await mustReject("DATASET_DAY_UPDATE", () =>
        prisma.historicalDatasetDay.update({
          where: { id: datasetDay.id },
          data: { warningsJson: '["forbidden"]' },
        }),
      )
    : null;
  const datasetDayDeleteRejected = datasetDay
    ? await mustReject("DATASET_DAY_DELETE", () =>
        prisma.historicalDatasetDay.delete({ where: { id: datasetDay.id } }),
      )
    : null;
  const auditEvent = await prisma.historicalAuditEvent.findFirst({ where: { datasetId: dataset.id } });
  const auditDeleteRejected = auditEvent
    ? await mustReject("AUDIT_DELETE", () =>
        prisma.historicalAuditEvent.delete({ where: { id: auditEvent.id } }),
      )
    : null;
  const after = {
    snapshots: await prisma.statareaCaptureSnapshot.count(),
    attempts: await prisma.statareaCaptureAttempt.count(),
    rows: await prisma.statareaRawRow.count(),
    profiles: await prisma.statareaSnapshotProfile.count(),
    policies: await prisma.historicalDatasetCapturePolicy.count(),
  };
  if (
    before.snapshots !== after.snapshots ||
    before.attempts !== after.attempts ||
    before.rows !== after.rows ||
    modernProfilesCreatedOnReplay !== 0 ||
    policyCreatedOnReplay
  ) {
    throw new Error("R3_MIGRATION_IDEMPOTENCY_OR_PRESERVATION_FAILED");
  }
  console.log(
    JSON.stringify(
      {
        before,
        after,
        modernProfilesCreated,
        modernProfilesCreatedOnReplay,
        policyCreated,
        policyCreatedOnReplay,
        profileUpdateRejected,
        profileDeleteRejected,
        policyUpdateRejected,
        policyDeleteRejected,
        datasetDayUpdateRejected,
        datasetDayDeleteRejected,
        auditDeleteRejected,
      },
      null,
      2,
    ),
  );
}

void main().finally(() => prisma.$disconnect());
