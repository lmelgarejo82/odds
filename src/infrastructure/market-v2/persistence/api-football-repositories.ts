import { createHash } from "node:crypto";
import type { RawEvidenceDescriptor } from "@/application/market-v2/capture/raw-evidence-store";
import type {
  CapturedFixture,
  PredictionSelectionKey,
  PredictionSelections,
  PredictionSnapshot,
} from "@/domain/market-v2/capture/types";
import type { ProviderOutcomeResolution } from "@/domain/market-v2/outcome/outcome-repository";
import type {
  ProviderRequestAuditAppendResult,
  ProviderRequestAuditRecord,
  ProviderRequestAuditRepository,
  ProviderRequestClassification,
} from "@/domain/market-v2/audit/provider-request-audit-repository";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";

export type ApiFootballPersistenceDisposition = "CREATED" | "REPLAYED";
export type ApiFootballPersistenceError = Readonly<{
  classification: "CONFLICT" | "FAILED" | "NOT_FOUND";
  retryable: false;
  sanitizedCode: string;
}>;
export type ApiFootballPersistenceResult<T> =
  | Readonly<{
      ok: true;
      disposition: ApiFootballPersistenceDisposition;
      value: T;
    }>
  | Readonly<{
      ok: false;
      disposition: "CONFLICT" | "FAILED";
      error: ApiFootballPersistenceError;
    }>;

export type PersistedProvider = Readonly<{
  id: string;
  stableKey: "api-football";
  displayName: "API-Football";
}>;
export type PersistedSourceArtifact = Readonly<{
  id: string;
  descriptor: RawEvidenceDescriptor;
}>;
export type PersistedFixtureBinding = Readonly<{
  id: string;
  providerId: string;
  providerFixtureId: string;
  fixtureId: string;
}>;
export type PersistedPrediction = Readonly<{
  id: string;
  snapshot: PredictionSnapshot;
}>;
export type PersistedOutcome = Readonly<{
  id: string;
  fixtureId: string;
  resolution: ProviderOutcomeResolution;
  contentHash: string;
}>;

export type PersistFixtureCaptureInput = Readonly<{
  fixture: CapturedFixture;
  canonicalFixtureId: string;
  evidence: RawEvidenceDescriptor;
}>;
export type PersistPredictionCaptureInput = Readonly<{
  snapshot: PredictionSnapshot;
  evidence: RawEvidenceDescriptor;
}>;
export type PersistOutcomeCaptureInput = Readonly<{
  resolution: ProviderOutcomeResolution;
  canonicalFixtureId: string;
  evidence: RawEvidenceDescriptor;
}>;

export interface ApiFootballPersistencePort {
  persistFixtureCapture(
    input: PersistFixtureCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedFixtureBinding>>;
  persistPredictionCapture(
    input: PersistPredictionCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedPrediction>>;
  persistOutcomeCapture(
    input: PersistOutcomeCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedOutcome>>;
}

export type PrismaProviderRow = Readonly<{
  id: string;
  stableKey: string;
  displayName: string;
}>;
export type PrismaSourceArtifactRow = Readonly<{
  id: string;
  sourceName: string;
  sourceReference: string;
  sha256: string;
  capturedAtUtc: Date | string;
  mediaType: string | null;
  byteSize: bigint | null;
}>;
export type PrismaProviderFixtureIdentityRow = Readonly<{
  id: string;
  providerId: string;
  providerFixtureId: string;
  fixtureId: string;
  providerCompetitionId: string | null;
  providerHomeTeamId: string | null;
  providerAwayTeamId: string | null;
  season: string | null;
  round: string | null;
  sourceDateRaw: string | null;
  sourceTimestamp: string | null;
  sourceTimezone: string | null;
}>;
export type PrismaPredictionProbabilityRow = Readonly<{
  predictionSnapshotId: string;
  selection: PredictionSelectionKey;
  rawPercentage: string;
  normalizedProbability: string | Readonly<{ toString(): string }>;
}>;
export type PrismaPredictionSnapshotRow = Readonly<{
  id: string;
  providerFixtureIdentityId: string;
  sourceArtifactId: string;
  capturedAtUtc: Date | string;
  predictionCapturedBeforeKickoff: boolean;
  predictedWinnerProviderTeamId: string | null;
  predictedWinnerName: string | null;
  winnerComment: string | null;
  advice: string | null;
  underOverRaw: string | null;
  providerInternalTimestampRaw: string | null;
  probabilityTotalRaw: string;
  contentHash: string;
  parserVersion: string;
  policyVersion: string;
  probabilities: readonly PrismaPredictionProbabilityRow[];
}>;
export type PrismaOutcomeRow = Readonly<{
  id: string;
  fixtureId: string;
  observedAtUtc: Date | string;
  homeScore: number;
  awayScore: number;
  result1X2: "HOME" | "DRAW" | "AWAY";
  providerTerminalStatusRaw: string | null;
  result1X2Scope: "REGULATION_TIME" | null;
  regulationHomeScore: number | null;
  regulationAwayScore: number | null;
  extraTimeHomeScore: number | null;
  extraTimeAwayScore: number | null;
  penaltyHomeScore: number | null;
  penaltyAwayScore: number | null;
  shootoutWinner: "HOME" | "AWAY" | null;
  status: "PROVISIONAL" | "CONFIRMED" | "CORRECTED" | "VOID";
  sourceArtifactId: string;
  supersedesOutcomeId: string | null;
  contentHash: string;
}>;

export type PrismaProviderRequestAuditRow = Readonly<{
  id: string;
  providerId: string;
  importBatchId: string | null;
  endpointKey: string;
  requestKeyHash: string;
  correlationId: string;
  attemptNumber: number;
  startedAtUtc: Date | string;
  finishedAtUtc: Date | string | null;
  httpStatus: number | null;
  classification: ProviderRequestClassification;
  sanitizedErrorCode: string | null;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  minuteLimit: number | null;
  minuteRemaining: number | null;
}>;

type PrismaProviderDelegate = Readonly<{
  findUnique(args: Readonly<{
    where: Readonly<{ stableKey: string }>;
  }>): Promise<PrismaProviderRow | null>;
  create(args: Readonly<{
    data: Readonly<{ id: string; stableKey: string; displayName: string }>;
  }>): Promise<PrismaProviderRow>;
}>;

export interface ApiFootballAuditPrismaClient {
  readonly provider: PrismaProviderDelegate;
  readonly providerRequestAudit: Readonly<{
    findUnique(args: Readonly<{
      where: Readonly<{
        requestKeyHash_attemptNumber: Readonly<{
          requestKeyHash: string;
          attemptNumber: number;
        }>;
      }>;
    }>): Promise<PrismaProviderRequestAuditRow | null>;
    create(args: Readonly<{
      data: Readonly<{
        id: string;
        providerId: string;
        importBatchId: string | null;
        endpointKey: string;
        requestKeyHash: string;
        correlationId: string;
        attemptNumber: number;
        startedAtUtc: Date;
        finishedAtUtc: Date | null;
        httpStatus: number | null;
        classification: ProviderRequestClassification;
        sanitizedErrorCode: string | null;
        dailyLimit: number | null;
        dailyRemaining: number | null;
        minuteLimit: number | null;
        minuteRemaining: number | null;
      }>;
    }>): Promise<PrismaProviderRequestAuditRow>;
  }>;
}

export interface ApiFootballPrismaClient {
  readonly provider: PrismaProviderDelegate;
  readonly sourceArtifact: Readonly<{
    findFirst(args: Readonly<{
      where: Readonly<{ sourceName: string; sourceReference: string }>;
    }>): Promise<PrismaSourceArtifactRow | null>;
    create(args: Readonly<{ data: Readonly<{
      id: string;
      sourceName: string;
      sourceReference: string;
      sha256: string;
      capturedAtUtc: Date;
      mediaType: string;
      byteSize: bigint;
    }> }>): Promise<PrismaSourceArtifactRow>;
  }>;
  readonly providerFixtureIdentity: Readonly<{
    findUnique(args: Readonly<{ where: Readonly<{
      providerId_providerFixtureId: Readonly<{ providerId: string; providerFixtureId: string }>;
    }> }>): Promise<PrismaProviderFixtureIdentityRow | null>;
    create(args: Readonly<{ data: Readonly<{
      id: string;
      providerId: string;
      providerFixtureId: string;
      fixtureId: string;
      providerCompetitionId: string;
      providerHomeTeamId: string;
      providerAwayTeamId: string;
      season: string;
      round: string;
      sourceDateRaw: string;
      sourceTimestamp: string;
      sourceTimezone: string;
    }> }>): Promise<PrismaProviderFixtureIdentityRow>;
  }>;
  readonly predictionSnapshot: Readonly<{
    findUnique(args: Readonly<{ where: Readonly<{
      providerFixtureIdentityId_capturedAtUtc: Readonly<{
        providerFixtureIdentityId: string;
        capturedAtUtc: Date;
      }>;
    }>;
      include: Readonly<{ probabilities: true }>;
    }>): Promise<PrismaPredictionSnapshotRow | null>;
    findMany(args: Readonly<{
      where: Readonly<{
        providerFixtureIdentityId: string;
        capturedAtUtc?: Readonly<{ lt: Date }>;
      }>;
      orderBy: Readonly<{ capturedAtUtc: "asc" | "desc" }>;
      take?: number;
      include: Readonly<{ probabilities: true }>;
    }>): Promise<readonly PrismaPredictionSnapshotRow[]>;
    create(args: Readonly<{ data: Readonly<{
      id: string;
      providerFixtureIdentityId: string;
      sourceArtifactId: string;
      capturedAtUtc: Date;
      predictionCapturedBeforeKickoff: boolean;
      predictedWinnerProviderTeamId: string | null;
      predictedWinnerName: string | null;
      winnerComment: string | null;
      advice: string | null;
      underOverRaw: string | null;
      providerInternalTimestampRaw: string | null;
      probabilityTotalRaw: string;
      contentHash: string;
      parserVersion: string;
      policyVersion: string;
    }> }>): Promise<Omit<PrismaPredictionSnapshotRow, "probabilities">>;
  }>;
  readonly predictionProbability: Readonly<{
    create(args: Readonly<{ data: Readonly<{
      predictionSnapshotId: string;
      selection: PredictionSelectionKey;
      rawPercentage: string;
      normalizedProbability: string;
    }> }>): Promise<PrismaPredictionProbabilityRow>;
  }>;
  readonly outcome: Readonly<{
    findFirst(args: Readonly<{ where: Readonly<{
      fixtureId: string;
      contentHash?: string;
      observedAtUtc?: Date;
    }> }>): Promise<PrismaOutcomeRow | null>;
    create(args: Readonly<{ data: Readonly<{
      id: string;
      fixtureId: string;
      observedAtUtc: Date;
      homeScore: number;
      awayScore: number;
      result1X2: "HOME" | "DRAW" | "AWAY";
      providerTerminalStatusRaw: string;
      result1X2Scope: "REGULATION_TIME";
      regulationHomeScore: number;
      regulationAwayScore: number;
      extraTimeHomeScore: number | null;
      extraTimeAwayScore: number | null;
      penaltyHomeScore: number | null;
      penaltyAwayScore: number | null;
      shootoutWinner: "HOME" | "AWAY" | null;
      status: "CONFIRMED";
      sourceArtifactId: string;
      contentHash: string;
    }> }>): Promise<PrismaOutcomeRow>;
  }>;
  $transaction<T>(operation: (transaction: ApiFootballPrismaClient) => Promise<T>): Promise<T>;
}

function stableId(prefix: string, components: readonly string[]): string {
  const digest = createHash("sha256").update(components.join("\u0000")).digest("hex");
  return `${prefix}:${digest.slice(0, 32)}`;
}

function created<T>(value: T): ApiFootballPersistenceResult<T> {
  return Object.freeze({ ok: true, disposition: "CREATED", value });
}

function replayed<T>(value: T): ApiFootballPersistenceResult<T> {
  return Object.freeze({ ok: true, disposition: "REPLAYED", value });
}

function rejected<T>(
  classification: ApiFootballPersistenceError["classification"],
  sanitizedCode: string,
): ApiFootballPersistenceResult<T> {
  return Object.freeze({
    ok: false,
    disposition: classification === "CONFLICT" ? "CONFLICT" : "FAILED",
    error: Object.freeze({ classification, retryable: false, sanitizedCode }),
  });
}

function instant(value: Date | string): string {
  return new Date(value).toISOString();
}

function isUniquenessConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Readonly<{ code?: unknown; message?: unknown }>;
  return candidate.code === "P2002" ||
    (typeof candidate.message === "string" && candidate.message.includes("UNIQUE constraint failed"));
}

function sameArtifact(row: PrismaSourceArtifactRow, evidence: RawEvidenceDescriptor): boolean {
  return row.sourceName === evidence.providerKey &&
    row.sourceReference === evidence.storageReference &&
    row.sha256 === evidence.contentHash &&
    row.mediaType === evidence.mediaType &&
    row.byteSize !== null && BigInt(row.byteSize) === BigInt(evidence.byteLength);
}

function sameBinding(
  row: PrismaProviderFixtureIdentityRow,
  fixture: CapturedFixture,
  canonicalFixtureId: string,
): boolean {
  return row.fixtureId === canonicalFixtureId &&
    row.providerCompetitionId === fixture.competition.providerCompetitionId &&
    row.providerHomeTeamId === fixture.home.providerTeamId &&
    row.providerAwayTeamId === fixture.away.providerTeamId &&
    row.season === fixture.season &&
    row.round === fixture.round &&
    row.sourceDateRaw === fixture.sourceDate &&
    row.sourceTimestamp === fixture.sourceTimestamp &&
    row.sourceTimezone === fixture.sourceTimezone;
}

function snapshotFromRow(row: PrismaPredictionSnapshotRow): PredictionSnapshot {
  const bySelection = new Map(row.probabilities.map((entry) => [entry.selection, entry]));
  const selection = <Key extends PredictionSelectionKey>(key: Key) => {
    const entry = bySelection.get(key);
    if (entry === undefined) throw new Error("PREDICTION_PROBABILITY_INCOMPLETE");
    return Object.freeze({
      selection: key,
      rawPercentage: entry.rawPercentage,
      normalizedProbability: entry.normalizedProbability.toString(),
    });
  };
  const selections: PredictionSelections = Object.freeze([
    selection("HOME"),
    selection("DRAW"),
    selection("AWAY"),
  ]);
  return Object.freeze({
    providerKey: "api-football",
    providerFixtureId: "",
    capturedAtUtc: instant(row.capturedAtUtc),
    predictionCapturedBeforeKickoff: row.predictionCapturedBeforeKickoff,
    selections,
    probabilityTotalRaw: row.probabilityTotalRaw,
    predictedWinnerProviderTeamId: row.predictedWinnerProviderTeamId,
    predictedWinnerName: row.predictedWinnerName,
    winnerComment: row.winnerComment,
    advice: row.advice,
    underOverRaw: row.underOverRaw,
    providerInternalTimestamp: row.providerInternalTimestampRaw,
    contentHash: row.contentHash,
    parserVersion: row.parserVersion,
    policyVersion: row.policyVersion,
  });
}

function samePrediction(row: PrismaPredictionSnapshotRow, snapshot: PredictionSnapshot): boolean {
  const mapped = snapshotFromRow(row);
  return instant(row.capturedAtUtc) === instant(snapshot.capturedAtUtc) &&
    mapped.predictionCapturedBeforeKickoff === snapshot.predictionCapturedBeforeKickoff &&
    mapped.probabilityTotalRaw === snapshot.probabilityTotalRaw &&
    mapped.predictedWinnerProviderTeamId === snapshot.predictedWinnerProviderTeamId &&
    mapped.predictedWinnerName === snapshot.predictedWinnerName &&
    mapped.winnerComment === snapshot.winnerComment &&
    mapped.advice === snapshot.advice &&
    mapped.underOverRaw === snapshot.underOverRaw &&
    mapped.providerInternalTimestamp === snapshot.providerInternalTimestamp &&
    mapped.contentHash === snapshot.contentHash &&
    mapped.parserVersion === snapshot.parserVersion &&
    mapped.policyVersion === snapshot.policyVersion &&
    mapped.selections.every((entry, index) =>
      entry.selection === snapshot.selections[index].selection &&
      entry.rawPercentage === snapshot.selections[index].rawPercentage &&
      entry.normalizedProbability === snapshot.selections[index].normalizedProbability,
    );
}

function sameOutcome(
  row: PrismaOutcomeRow,
  resolution: ProviderOutcomeResolution,
  sourceArtifactId: string,
): boolean {
  return row.homeScore === resolution.goalsHomeScore &&
    row.awayScore === resolution.goalsAwayScore &&
    row.result1X2 === resolution.result1X2 &&
    row.providerTerminalStatusRaw === resolution.providerTerminalStatusRaw &&
    row.result1X2Scope === resolution.result1X2Scope &&
    row.regulationHomeScore === resolution.regulationHomeScore &&
    row.regulationAwayScore === resolution.regulationAwayScore &&
    row.extraTimeHomeScore === resolution.extraTimeHomeScore &&
    row.extraTimeAwayScore === resolution.extraTimeAwayScore &&
    row.penaltyHomeScore === resolution.penaltyHomeScore &&
    row.penaltyAwayScore === resolution.penaltyAwayScore &&
    row.shootoutWinner === resolution.shootoutWinner &&
    row.sourceArtifactId === sourceArtifactId;
}

async function ensureStableProvider(
  client: Readonly<{ provider: PrismaProviderDelegate }>,
): Promise<ApiFootballPersistenceResult<PersistedProvider>> {
  const existing = await client.provider.findUnique({ where: { stableKey: "api-football" } });
  if (existing !== null) {
    return existing.displayName === "API-Football"
      ? replayed(Object.freeze({
          id: existing.id,
          stableKey: "api-football",
          displayName: "API-Football",
        }))
      : rejected("CONFLICT", "PROVIDER_DEFINITION_CONFLICT");
  }
  const row = await client.provider.create({
    data: { id: "provider:api-football", stableKey: "api-football", displayName: "API-Football" },
  });
  return created(Object.freeze({
    id: row.id,
    stableKey: "api-football",
    displayName: "API-Football",
  }));
}

function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function sameRequestAudit(
  row: PrismaProviderRequestAuditRow,
  providerId: string,
  record: ProviderRequestAuditRecord,
): boolean {
  return row.providerId === providerId &&
    row.importBatchId === nullable(record.importBatchId) &&
    row.endpointKey === record.endpointKey &&
    row.requestKeyHash === record.requestKeyHash &&
    row.correlationId === record.correlationId &&
    row.attemptNumber === record.attemptNumber &&
    instant(row.startedAtUtc) === record.startedAtUtc &&
    (row.finishedAtUtc === null ? null : instant(row.finishedAtUtc)) ===
      nullable(record.finishedAtUtc) &&
    row.httpStatus === nullable(record.httpStatus) &&
    row.classification === record.classification &&
    row.sanitizedErrorCode === nullable(record.sanitizedErrorCode) &&
    row.dailyLimit === nullable(record.dailyLimit) &&
    row.dailyRemaining === nullable(record.dailyRemaining) &&
    row.minuteLimit === nullable(record.minuteLimit) &&
    row.minuteRemaining === nullable(record.minuteRemaining);
}

function validAuditInteger(value: number | null | undefined): boolean {
  return value === undefined || value === null ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647);
}

function validAuditRecord(record: ProviderRequestAuditRecord): boolean {
  const finished = nullable(record.finishedAtUtc);
  return record.providerKey === "api-football" &&
    /^(fixtures-by-date|fixtures-by-competition-window|prediction-by-fixture|fixture-result-by-id)$/u
      .test(record.endpointKey) &&
    /^[0-9a-f]{64}$/u.test(record.requestKeyHash) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.correlationId) &&
    (record.importBatchId === undefined || record.importBatchId === null ||
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.importBatchId)) &&
    Number.isSafeInteger(record.attemptNumber) && record.attemptNumber > 0 &&
    isNormalizedUtcTimestamp(record.startedAtUtc) &&
    (finished === null ||
      (isNormalizedUtcTimestamp(finished) && finished >= record.startedAtUtc)) &&
    (record.httpStatus === undefined || record.httpStatus === null ||
      (Number.isSafeInteger(record.httpStatus) && record.httpStatus >= 100 &&
        record.httpStatus <= 599)) &&
    (record.sanitizedErrorCode === undefined || record.sanitizedErrorCode === null ||
      /^[A-Z][A-Z0-9_]{0,127}$/u.test(record.sanitizedErrorCode)) &&
    validAuditInteger(record.dailyLimit) &&
    validAuditInteger(record.dailyRemaining) &&
    validAuditInteger(record.minuteLimit) &&
    validAuditInteger(record.minuteRemaining);
}

function auditAccepted(
  disposition: "CREATED" | "REPLAYED",
): ProviderRequestAuditAppendResult {
  return Object.freeze({ ok: true, disposition });
}

function auditRejected(
  classification: "CONFLICT" | "FAILED",
  sanitizedCode: string,
): ProviderRequestAuditAppendResult {
  return Object.freeze({
    ok: false,
    disposition: classification,
    error: Object.freeze({ classification, retryable: false, sanitizedCode }),
  });
}

export class PrismaProviderRequestAuditRepository
implements ProviderRequestAuditRepository {
  constructor(readonly prisma: ApiFootballAuditPrismaClient) {}

  async append(record: ProviderRequestAuditRecord): Promise<ProviderRequestAuditAppendResult> {
    if (!validAuditRecord(record)) {
      return auditRejected("FAILED", "PROVIDER_REQUEST_AUDIT_INVALID");
    }
    try {
      const provider = await ensureStableProvider(this.prisma);
      if (!provider.ok) {
        return auditRejected(
          provider.disposition === "CONFLICT" ? "CONFLICT" : "FAILED",
          "PROVIDER_REQUEST_AUDIT_PROVIDER_FAILED",
        );
      }
      const existing = await this.#find(record);
      if (existing !== null) {
        return sameRequestAudit(existing, provider.value.id, record)
          ? auditAccepted("REPLAYED")
          : auditRejected("CONFLICT", "PROVIDER_REQUEST_AUDIT_CONFLICT");
      }
      await this.prisma.providerRequestAudit.create({
        data: {
          id: stableId("provider-request-audit", [
            record.requestKeyHash,
            String(record.attemptNumber),
          ]),
          providerId: provider.value.id,
          importBatchId: nullable(record.importBatchId),
          endpointKey: record.endpointKey,
          requestKeyHash: record.requestKeyHash,
          correlationId: record.correlationId,
          attemptNumber: record.attemptNumber,
          startedAtUtc: new Date(record.startedAtUtc),
          finishedAtUtc: record.finishedAtUtc === undefined || record.finishedAtUtc === null
            ? null
            : new Date(record.finishedAtUtc),
          httpStatus: nullable(record.httpStatus),
          classification: record.classification,
          sanitizedErrorCode: nullable(record.sanitizedErrorCode),
          dailyLimit: nullable(record.dailyLimit),
          dailyRemaining: nullable(record.dailyRemaining),
          minuteLimit: nullable(record.minuteLimit),
          minuteRemaining: nullable(record.minuteRemaining),
        },
      });
      return auditAccepted("CREATED");
    } catch (error) {
      if (isUniquenessConflict(error)) {
        try {
          const provider = await this.prisma.provider.findUnique({
            where: { stableKey: "api-football" },
          });
          const existing = await this.#find(record);
          if (provider !== null && existing !== null) {
            return sameRequestAudit(existing, provider.id, record)
              ? auditAccepted("REPLAYED")
              : auditRejected("CONFLICT", "PROVIDER_REQUEST_AUDIT_CONFLICT");
          }
        } catch {
          return auditRejected("FAILED", "PROVIDER_REQUEST_AUDIT_READ_FAILED");
        }
        return auditRejected("CONFLICT", "PROVIDER_REQUEST_AUDIT_UNIQUENESS_CONFLICT");
      }
      return auditRejected("FAILED", "PROVIDER_REQUEST_AUDIT_WRITE_FAILED");
    }
  }

  #find(record: ProviderRequestAuditRecord): Promise<PrismaProviderRequestAuditRow | null> {
    return this.prisma.providerRequestAudit.findUnique({
      where: {
        requestKeyHash_attemptNumber: {
          requestKeyHash: record.requestKeyHash,
          attemptNumber: record.attemptNumber,
        },
      },
    });
  }
}

export class PrismaApiFootballRepositories implements ApiFootballPersistencePort {
  constructor(readonly prisma: ApiFootballPrismaClient) {}

  async ensureProvider(): Promise<ApiFootballPersistenceResult<PersistedProvider>> {
    try {
      return await this.#ensureProvider(this.prisma);
    } catch (error) {
      return isUniquenessConflict(error)
        ? rejected("CONFLICT", "PROVIDER_UNIQUENESS_CONFLICT")
        : rejected("FAILED", "PROVIDER_WRITE_FAILED");
    }
  }

  async registerSourceArtifact(
    evidence: RawEvidenceDescriptor,
  ): Promise<ApiFootballPersistenceResult<PersistedSourceArtifact>> {
    try {
      return await this.#registerSourceArtifact(this.prisma, evidence);
    } catch (error) {
      return isUniquenessConflict(error)
        ? rejected("CONFLICT", "SOURCE_ARTIFACT_UNIQUENESS_CONFLICT")
        : rejected("FAILED", "SOURCE_ARTIFACT_WRITE_FAILED");
    }
  }

  async persistFixtureCapture(
    input: PersistFixtureCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedFixtureBinding>> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const provider = await this.#ensureProvider(transaction);
        if (!provider.ok) return provider;
        const artifact = await this.#registerSourceArtifact(transaction, input.evidence);
        if (!artifact.ok) return artifact;
        const existing = await transaction.providerFixtureIdentity.findUnique({
          where: {
            providerId_providerFixtureId: {
              providerId: provider.value.id,
              providerFixtureId: input.fixture.providerFixtureId,
            },
          },
        });
        if (existing !== null) {
          const value = Object.freeze({
            id: existing.id,
            providerId: existing.providerId,
            providerFixtureId: existing.providerFixtureId,
            fixtureId: existing.fixtureId,
          });
          return sameBinding(existing, input.fixture, input.canonicalFixtureId)
            ? replayed(value)
            : rejected<PersistedFixtureBinding>("CONFLICT", "FIXTURE_BINDING_CONFLICT");
        }
        const row = await transaction.providerFixtureIdentity.create({
          data: {
            id: stableId("provider-fixture", [provider.value.id, input.fixture.providerFixtureId]),
            providerId: provider.value.id,
            providerFixtureId: input.fixture.providerFixtureId,
            fixtureId: input.canonicalFixtureId,
            providerCompetitionId: input.fixture.competition.providerCompetitionId,
            providerHomeTeamId: input.fixture.home.providerTeamId,
            providerAwayTeamId: input.fixture.away.providerTeamId,
            season: input.fixture.season,
            round: input.fixture.round,
            sourceDateRaw: input.fixture.sourceDate,
            sourceTimestamp: input.fixture.sourceTimestamp,
            sourceTimezone: input.fixture.sourceTimezone,
          },
        });
        return created(Object.freeze({
          id: row.id,
          providerId: row.providerId,
          providerFixtureId: row.providerFixtureId,
          fixtureId: row.fixtureId,
        }));
      });
    } catch (error) {
      return isUniquenessConflict(error)
        ? rejected("CONFLICT", "FIXTURE_BINDING_UNIQUENESS_CONFLICT")
        : rejected("FAILED", "FIXTURE_BINDING_WRITE_FAILED");
    }
  }

  async persistPredictionCapture(
    input: PersistPredictionCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedPrediction>> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const provider = await this.#ensureProvider(transaction);
        if (!provider.ok) return provider;
        const artifact = await this.#registerSourceArtifact(transaction, input.evidence);
        if (!artifact.ok) return artifact;
        const identity = await transaction.providerFixtureIdentity.findUnique({
          where: {
            providerId_providerFixtureId: {
              providerId: provider.value.id,
              providerFixtureId: input.snapshot.providerFixtureId,
            },
          },
        });
        if (identity === null) {
          return rejected<PersistedPrediction>("NOT_FOUND", "FIXTURE_BINDING_REQUIRED");
        }
        const capturedAtUtc = new Date(input.snapshot.capturedAtUtc);
        const existing = await transaction.predictionSnapshot.findUnique({
          where: {
            providerFixtureIdentityId_capturedAtUtc: {
              providerFixtureIdentityId: identity.id,
              capturedAtUtc,
            },
          },
          include: { probabilities: true },
        });
        if (existing !== null) {
          return samePrediction(existing, input.snapshot) &&
            existing.sourceArtifactId === artifact.value.id
            ? replayed(Object.freeze({ id: existing.id, snapshot: input.snapshot }))
            : rejected<PersistedPrediction>("CONFLICT", "PREDICTION_CAPTURE_CONFLICT");
        }
        const id = stableId("prediction", [identity.id, input.snapshot.capturedAtUtc]);
        await transaction.predictionSnapshot.create({
          data: {
            id,
            providerFixtureIdentityId: identity.id,
            sourceArtifactId: artifact.value.id,
            capturedAtUtc,
            predictionCapturedBeforeKickoff: input.snapshot.predictionCapturedBeforeKickoff,
            predictedWinnerProviderTeamId: input.snapshot.predictedWinnerProviderTeamId,
            predictedWinnerName: input.snapshot.predictedWinnerName,
            winnerComment: input.snapshot.winnerComment,
            advice: input.snapshot.advice,
            underOverRaw: input.snapshot.underOverRaw,
            providerInternalTimestampRaw: input.snapshot.providerInternalTimestamp,
            probabilityTotalRaw: input.snapshot.probabilityTotalRaw,
            contentHash: input.snapshot.contentHash,
            parserVersion: input.snapshot.parserVersion,
            policyVersion: input.snapshot.policyVersion,
          },
        });
        for (const probability of input.snapshot.selections) {
          await transaction.predictionProbability.create({
            data: {
              predictionSnapshotId: id,
              selection: probability.selection,
              rawPercentage: probability.rawPercentage,
              normalizedProbability: probability.normalizedProbability,
            },
          });
        }
        return created(Object.freeze({ id, snapshot: input.snapshot }));
      });
    } catch (error) {
      return isUniquenessConflict(error)
        ? rejected("CONFLICT", "PREDICTION_UNIQUENESS_CONFLICT")
        : rejected("FAILED", "PREDICTION_WRITE_FAILED");
    }
  }

  async persistOutcomeCapture(
    input: PersistOutcomeCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedOutcome>> {
    if (input.resolution.goalsHomeScore === null || input.resolution.goalsAwayScore === null) {
      return rejected("FAILED", "FINAL_GOALS_REQUIRED");
    }
    const goalsHomeScore = input.resolution.goalsHomeScore;
    const goalsAwayScore = input.resolution.goalsAwayScore;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const provider = await this.#ensureProvider(transaction);
        if (!provider.ok) return provider;
        const artifact = await this.#registerSourceArtifact(transaction, input.evidence);
        if (!artifact.ok) return artifact;
        const exact = await transaction.outcome.findFirst({
          where: { fixtureId: input.canonicalFixtureId, contentHash: input.evidence.contentHash },
        });
        if (exact !== null) {
          const value = Object.freeze({
            id: exact.id,
            fixtureId: exact.fixtureId,
            resolution: input.resolution,
            contentHash: exact.contentHash,
          });
          return sameOutcome(exact, input.resolution, artifact.value.id)
            ? replayed(value)
            : rejected<PersistedOutcome>("CONFLICT", "OUTCOME_REPLAY_CONFLICT");
        }
        const sameObservation = await transaction.outcome.findFirst({
          where: {
            fixtureId: input.canonicalFixtureId,
            observedAtUtc: new Date(input.resolution.capturedAtUtc),
          },
        });
        if (sameObservation !== null) {
          return rejected<PersistedOutcome>("CONFLICT", "OUTCOME_CAPTURE_CONFLICT");
        }
        const row = await transaction.outcome.create({
          data: {
            id: stableId("outcome", [input.canonicalFixtureId, input.evidence.contentHash]),
            fixtureId: input.canonicalFixtureId,
            observedAtUtc: new Date(input.resolution.capturedAtUtc),
            homeScore: goalsHomeScore,
            awayScore: goalsAwayScore,
            result1X2: input.resolution.result1X2,
            providerTerminalStatusRaw: input.resolution.providerTerminalStatusRaw,
            result1X2Scope: input.resolution.result1X2Scope,
            regulationHomeScore: input.resolution.regulationHomeScore,
            regulationAwayScore: input.resolution.regulationAwayScore,
            extraTimeHomeScore: input.resolution.extraTimeHomeScore,
            extraTimeAwayScore: input.resolution.extraTimeAwayScore,
            penaltyHomeScore: input.resolution.penaltyHomeScore,
            penaltyAwayScore: input.resolution.penaltyAwayScore,
            shootoutWinner: input.resolution.shootoutWinner,
            status: "CONFIRMED",
            sourceArtifactId: artifact.value.id,
            contentHash: input.evidence.contentHash,
          },
        });
        return created(Object.freeze({
          id: row.id,
          fixtureId: row.fixtureId,
          resolution: input.resolution,
          contentHash: row.contentHash,
        }));
      });
    } catch (error) {
      return isUniquenessConflict(error)
        ? rejected("CONFLICT", "OUTCOME_UNIQUENESS_CONFLICT")
        : rejected("FAILED", "OUTCOME_WRITE_FAILED");
    }
  }

  async listPredictions(
    providerFixtureId: string,
  ): Promise<readonly PredictionSnapshot[]> {
    const identity = await this.#findIdentity(providerFixtureId);
    if (identity === null) return [];
    const rows = await this.prisma.predictionSnapshot.findMany({
      where: { providerFixtureIdentityId: identity.id },
      orderBy: { capturedAtUtc: "asc" },
      include: { probabilities: true },
    });
    return Object.freeze(rows.map((row) => Object.freeze({
      ...snapshotFromRow(row),
      providerFixtureId,
    })));
  }

  async findLatestPredictionBeforeKickoff(
    providerFixtureId: string,
    kickoffAtUtc: string,
  ): Promise<PredictionSnapshot | null> {
    const identity = await this.#findIdentity(providerFixtureId);
    if (identity === null) return null;
    const rows = await this.prisma.predictionSnapshot.findMany({
      where: {
        providerFixtureIdentityId: identity.id,
        capturedAtUtc: { lt: new Date(kickoffAtUtc) },
      },
      orderBy: { capturedAtUtc: "desc" },
      take: 1,
      include: { probabilities: true },
    });
    const row = rows[0];
    return row === undefined
      ? null
      : Object.freeze({ ...snapshotFromRow(row), providerFixtureId });
  }

  async #findIdentity(providerFixtureId: string): Promise<PrismaProviderFixtureIdentityRow | null> {
    const provider = await this.prisma.provider.findUnique({ where: { stableKey: "api-football" } });
    if (provider === null) return null;
    return this.prisma.providerFixtureIdentity.findUnique({
      where: {
        providerId_providerFixtureId: { providerId: provider.id, providerFixtureId },
      },
    });
  }

  async #ensureProvider(
    client: ApiFootballPrismaClient,
  ): Promise<ApiFootballPersistenceResult<PersistedProvider>> {
    return ensureStableProvider(client);
  }

  async #registerSourceArtifact(
    client: ApiFootballPrismaClient,
    evidence: RawEvidenceDescriptor,
  ): Promise<ApiFootballPersistenceResult<PersistedSourceArtifact>> {
    const existing = await client.sourceArtifact.findFirst({
      where: { sourceName: evidence.providerKey, sourceReference: evidence.storageReference },
    });
    if (existing !== null) {
      return sameArtifact(existing, evidence)
        ? replayed(Object.freeze({ id: existing.id, descriptor: evidence }))
        : rejected("CONFLICT", "SOURCE_ARTIFACT_CONFLICT");
    }
    const row = await client.sourceArtifact.create({
      data: {
        id: stableId("source-artifact", [
          evidence.providerKey,
          evidence.storageReference,
          evidence.contentHash,
        ]),
        sourceName: evidence.providerKey,
        sourceReference: evidence.storageReference,
        sha256: evidence.contentHash,
        capturedAtUtc: new Date(evidence.capturedAtUtc),
        mediaType: evidence.mediaType,
        byteSize: BigInt(evidence.byteLength),
      },
    });
    return created(Object.freeze({ id: row.id, descriptor: evidence }));
  }
}
