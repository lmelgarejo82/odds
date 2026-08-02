import type {
  RawEvidenceDescriptor,
  RawEvidenceStore,
} from "@/application/market-v2/capture/raw-evidence-store";
import type {
  CapturedFixture,
  PredictionSnapshot,
} from "@/domain/market-v2/capture/types";
import type { ProviderOutcomeResolution } from "@/domain/market-v2/outcome/outcome-repository";
import type {
  ApiFootballClientFailure,
  ApiFootballClientResult,
  ApiFootballEvidenceCandidate,
  ApiFootballFixturesQuery,
} from "./client";
import type {
  ApiFootballFixtureDto,
  ApiFootballFixtureEnvelope,
  ApiFootballPredictionDto,
  ApiFootballPredictionEnvelope,
} from "./contracts";
import type {
  ApiFootballFixtureMappingContext,
  ApiFootballMappingResult,
  ApiFootballPredictionMappingContext,
  ApiFootballResultMappingContext,
} from "./mappers";
import type {
  ApiFootballPersistenceDisposition,
  ApiFootballPersistencePort,
} from "@/infrastructure/market-v2/persistence/api-football-repositories";
import type {
  GovernedRequestExecutor,
  GovernedRequestInput,
  GovernedRequestResult,
} from "@/application/market-v2/api-football/governed-request-executor";

export type ApiFootballProviderClient = Readonly<{
  listFixtures(
    query: ApiFootballFixturesQuery,
  ): Promise<ApiFootballClientResult<ApiFootballFixtureEnvelope>>;
  getPrediction(
    providerFixtureId: string,
  ): Promise<ApiFootballClientResult<ApiFootballPredictionEnvelope>>;
  getFixtureResult(
    providerFixtureId: string,
  ): Promise<ApiFootballClientResult<ApiFootballFixtureEnvelope>>;
}>;

export type ApiFootballProviderMappers = Readonly<{
  fixture(
    dto: ApiFootballFixtureDto,
    context: ApiFootballFixtureMappingContext,
  ): ApiFootballMappingResult<CapturedFixture>;
  prediction(
    dto: ApiFootballPredictionDto,
    context: ApiFootballPredictionMappingContext,
  ): ApiFootballMappingResult<PredictionSnapshot>;
  result(
    dto: ApiFootballFixtureDto,
    context: ApiFootballResultMappingContext,
  ): ApiFootballMappingResult<ProviderOutcomeResolution>;
}>;

export type ApiFootballProviderFailureClassification =
  | "CLIENT_FAILURE"
  | "EVIDENCE_FAILURE"
  | "MAPPING_FAILURE"
  | "PERSISTENCE_FAILURE"
  | "BINDING_REQUIRED"
  | "RESPONSE_CARDINALITY_INVALID"
  | "IDENTITY_MISMATCH"
  | "CHRONOLOGY_FAILURE"
  | "REQUEST_FAILURE"
  | "BUDGET_EXHAUSTED"
  | "CIRCUIT_OPEN"
  | "AUDIT_FAILURE";

export type ApiFootballProviderResult<T> =
  | Readonly<{
      ok: true;
      data: T;
      evidence: RawEvidenceDescriptor;
      persistenceDisposition: ApiFootballPersistenceDisposition;
    }>
  | Readonly<{
      ok: false;
      classification: ApiFootballProviderFailureClassification;
      sanitizedCode: string;
      evidence?: RawEvidenceDescriptor;
      conflict: boolean;
      rawStatusCode?: string;
    }>;

export type ApiFootballExplicitFixtureBinding = Readonly<{
  providerKey: "api-football";
  canonicalFixtureId: string;
  providerFixtureId: string;
  providerCompetitionId: string;
  season: string;
  homeProviderTeamId: string;
  homeName: string;
  awayProviderTeamId: string;
  awayName: string;
  kickoffUtc: string;
  sourceTimezone: "UTC";
}>;

export type ApiFootballGovernedRequestContext = Readonly<{
  executor: GovernedRequestExecutor;
  request: GovernedRequestInput;
}>;

type ApiFootballGovernanceState = Readonly<{
  governanceStatus: GovernedRequestResult<unknown>["status"];
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: string;
}>;

export type ApiFootballGovernedProviderResult<T> =
  | (ApiFootballGovernanceState & Readonly<{
      ok: true;
      data: T;
      evidence: RawEvidenceDescriptor;
      persistenceDisposition: ApiFootballPersistenceDisposition;
    }>)
  | (ApiFootballGovernanceState & Readonly<{
      ok: false;
      classification: ApiFootballProviderFailureClassification;
      sanitizedCode: string;
      evidence?: RawEvidenceDescriptor;
      conflict: boolean;
      rawStatusCode?: string;
      completedPersistenceDisposition?: ApiFootballPersistenceDisposition;
    }>);

export type GovernedSelectedFixtureInput = Readonly<{
  governance: ApiFootballGovernedRequestContext;
  binding: ApiFootballExplicitFixtureBinding;
}>;

export type GovernedPredictionInput = Readonly<{
  governance: ApiFootballGovernedRequestContext;
  binding: ApiFootballExplicitFixtureBinding;
  parserVersion: string;
  policyVersion: string;
}>;

export type GovernedOutcomeInput = Readonly<{
  governance: ApiFootballGovernedRequestContext;
  binding: ApiFootballExplicitFixtureBinding;
}>;

export type CaptureFixturesContext = Readonly<{
  mappingContext: ApiFootballFixtureMappingContext;
  canonicalFixtureBindings: Readonly<Record<string, string>>;
}>;
export type CaptureResultContext = Readonly<{
  mappingContext: ApiFootballResultMappingContext;
  canonicalFixtureId: string;
}>;

function providerFailure(
  classification: ApiFootballProviderFailureClassification,
  sanitizedCode: string,
  details: Readonly<{
    evidence?: RawEvidenceDescriptor;
    conflict?: boolean;
    rawStatusCode?: string;
  }> = {},
): ApiFootballProviderResult<never> {
  return Object.freeze({
    ok: false,
    classification,
    sanitizedCode,
    conflict: details.conflict ?? false,
    ...(details.evidence === undefined ? {} : { evidence: details.evidence }),
    ...(details.rawStatusCode === undefined ? {} : { rawStatusCode: details.rawStatusCode }),
  });
}

function sameName(actual: string, expected: string): boolean {
  return actual.trim().normalize("NFC") === expected.trim().normalize("NFC");
}

function exactFixtureBinding(
  fixture: CapturedFixture,
  binding: ApiFootballExplicitFixtureBinding,
): boolean {
  return fixture.providerKey === binding.providerKey &&
    fixture.providerFixtureId === binding.providerFixtureId &&
    fixture.competition.providerCompetitionId === binding.providerCompetitionId &&
    fixture.season === binding.season &&
    fixture.home.providerTeamId === binding.homeProviderTeamId &&
    sameName(fixture.home.name, binding.homeName) &&
    fixture.away.providerTeamId === binding.awayProviderTeamId &&
    sameName(fixture.away.name, binding.awayName) &&
    Date.parse(fixture.sourceDate) === Date.parse(binding.kickoffUtc) &&
    fixture.sourceTimezone === binding.sourceTimezone;
}

export class ApiFootballProvider {
  readonly providerKey = "api-football" as const;
  readonly #client: ApiFootballProviderClient;
  readonly #rawEvidenceStore: RawEvidenceStore;
  readonly #mappers: ApiFootballProviderMappers;
  readonly #persistence: ApiFootballPersistencePort;

  constructor(dependencies: Readonly<{
    client: ApiFootballProviderClient;
    rawEvidenceStore: RawEvidenceStore;
    mappers: ApiFootballProviderMappers;
    persistence: ApiFootballPersistencePort;
  }>) {
    this.#client = dependencies.client;
    this.#rawEvidenceStore = dependencies.rawEvidenceStore;
    this.#mappers = dependencies.mappers;
    this.#persistence = dependencies.persistence;
  }

  async captureFixtures(
    query: ApiFootballFixturesQuery,
    context: CaptureFixturesContext,
  ): Promise<ApiFootballProviderResult<readonly CapturedFixture[]>> {
    const clientResult = await this.#client.listFixtures(query);
    if (!clientResult.ok) return this.#clientFailure(clientResult);
    const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
    if (!evidence.ok) return evidence.failure;

    const captured: CapturedFixture[] = [];
    let disposition: ApiFootballPersistenceDisposition = "REPLAYED";
    for (const dto of clientResult.payload.response) {
      const mapped = this.#mappers.fixture(dto, {
        ...context.mappingContext,
        capturedAtUtc: evidence.descriptor.capturedAtUtc,
      });
      if (!mapped.ok) {
        return providerFailure("MAPPING_FAILURE", mapped.error.classification, {
          evidence: evidence.descriptor,
        });
      }
      const canonicalFixtureId = context.canonicalFixtureBindings[mapped.data.providerFixtureId];
      if (canonicalFixtureId === undefined || canonicalFixtureId.length === 0) {
        return providerFailure("BINDING_REQUIRED", "CANONICAL_FIXTURE_BINDING_REQUIRED", {
          evidence: evidence.descriptor,
        });
      }
      const persisted = await this.#persistence.persistFixtureCapture({
        fixture: mapped.data,
        canonicalFixtureId,
        evidence: evidence.descriptor,
      });
      if (!persisted.ok) {
        return providerFailure("PERSISTENCE_FAILURE", persisted.error.sanitizedCode, {
          evidence: evidence.descriptor,
          conflict: persisted.disposition === "CONFLICT",
        });
      }
      if (persisted.disposition === "CREATED") disposition = "CREATED";
      captured.push(mapped.data);
    }
    return Object.freeze({
      ok: true,
      data: Object.freeze(captured),
      evidence: evidence.descriptor,
      persistenceDisposition: disposition,
    });
  }

  async capturePrediction(
    providerFixtureId: string,
    context: ApiFootballPredictionMappingContext,
  ): Promise<ApiFootballProviderResult<PredictionSnapshot>> {
    const clientResult = await this.#client.getPrediction(providerFixtureId);
    if (!clientResult.ok) return this.#clientFailure(clientResult);
    const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
    if (!evidence.ok) return evidence.failure;
    if (clientResult.payload.response.length !== 1) {
      return providerFailure("RESPONSE_CARDINALITY_INVALID", "PREDICTION_ROW_REQUIRED", {
        evidence: evidence.descriptor,
      });
    }
    const mapped = this.#mappers.prediction(clientResult.payload.response[0], {
      ...context,
      capturedAtUtc: evidence.descriptor.capturedAtUtc,
      requestedProviderFixtureId: providerFixtureId,
      contentHash: evidence.descriptor.contentHash,
    });
    if (!mapped.ok) {
      return providerFailure("MAPPING_FAILURE", mapped.error.classification, {
        evidence: evidence.descriptor,
      });
    }
    const persisted = await this.#persistence.persistPredictionCapture({
      snapshot: mapped.data,
      evidence: evidence.descriptor,
    });
    if (!persisted.ok) {
      return providerFailure("PERSISTENCE_FAILURE", persisted.error.sanitizedCode, {
        evidence: evidence.descriptor,
        conflict: persisted.disposition === "CONFLICT",
      });
    }
    return Object.freeze({
      ok: true,
      data: mapped.data,
      evidence: evidence.descriptor,
      persistenceDisposition: persisted.disposition,
    });
  }

  async captureResult(
    providerFixtureId: string,
    context: CaptureResultContext,
  ): Promise<ApiFootballProviderResult<ProviderOutcomeResolution>> {
    const clientResult = await this.#client.getFixtureResult(providerFixtureId);
    if (!clientResult.ok) return this.#clientFailure(clientResult);
    const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
    if (!evidence.ok) return evidence.failure;
    if (clientResult.payload.response.length !== 1) {
      return providerFailure("RESPONSE_CARDINALITY_INVALID", "RESULT_ROW_REQUIRED", {
        evidence: evidence.descriptor,
      });
    }
    const mapped = this.#mappers.result(
      clientResult.payload.response[0],
      {
        ...context.mappingContext,
        capturedAtUtc: evidence.descriptor.capturedAtUtc,
        requestedProviderFixtureId: providerFixtureId,
      },
    );
    if (!mapped.ok) {
      return providerFailure("MAPPING_FAILURE", mapped.error.classification, {
        evidence: evidence.descriptor,
      });
    }
    const persisted = await this.#persistence.persistOutcomeCapture({
      resolution: mapped.data,
      canonicalFixtureId: context.canonicalFixtureId,
      evidence: evidence.descriptor,
    });
    if (!persisted.ok) {
      return providerFailure("PERSISTENCE_FAILURE", persisted.error.sanitizedCode, {
        evidence: evidence.descriptor,
        conflict: persisted.disposition === "CONFLICT",
      });
    }
    return Object.freeze({
      ok: true,
      data: mapped.data,
      evidence: evidence.descriptor,
      persistenceDisposition: persisted.disposition,
    });
  }

  async captureSelectedFixtureGoverned(
    input: GovernedSelectedFixtureInput,
  ): Promise<ApiFootballGovernedProviderResult<CapturedFixture>> {
    return this.#executeGoverned(
      input.governance,
      "fixtures-by-date",
      () => this.#client.listFixtures({
        date: input.binding.kickoffUtc.slice(0, 10),
        timezone: "UTC",
      }),
      async (clientResult) => {
        const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
        if (!evidence.ok) return evidence.failure;
        const selected = clientResult.payload.response.filter(
          (row) => String(row.fixture.id) === input.binding.providerFixtureId,
        );
        if (selected.length !== 1) {
          return providerFailure(
            "RESPONSE_CARDINALITY_INVALID",
            selected.length === 0 ? "FIXTURE_NOT_FOUND" : "FIXTURE_AMBIGUOUS",
            { evidence: evidence.descriptor },
          );
        }
        const mapped = this.#mappers.fixture(selected[0], {
          capturedAtUtc: evidence.descriptor.capturedAtUtc,
          providerKey: "api-football",
        });
        if (!mapped.ok) {
          return providerFailure("MAPPING_FAILURE", mapped.error.classification, {
            evidence: evidence.descriptor,
            rawStatusCode: mapped.error.rawStatusCode,
          });
        }
        if (!exactFixtureBinding(mapped.data, input.binding)) {
          return providerFailure("IDENTITY_MISMATCH", "EXPLICIT_FIXTURE_BINDING_MISMATCH", {
            evidence: evidence.descriptor,
            rawStatusCode: mapped.data.rawStatusCode,
          });
        }
        const persisted = await this.#persistence.persistFixtureCapture({
          fixture: mapped.data,
          canonicalFixtureId: input.binding.canonicalFixtureId,
          evidence: evidence.descriptor,
        });
        if (!persisted.ok) {
          return providerFailure("PERSISTENCE_FAILURE", persisted.error.sanitizedCode, {
            evidence: evidence.descriptor,
            conflict: persisted.disposition === "CONFLICT",
            rawStatusCode: mapped.data.rawStatusCode,
          });
        }
        return Object.freeze({
          ok: true,
          data: mapped.data,
          evidence: evidence.descriptor,
          persistenceDisposition: persisted.disposition,
        });
      },
    );
  }

  async capturePrematchPredictionGoverned(
    input: GovernedPredictionInput,
  ): Promise<ApiFootballGovernedProviderResult<PredictionSnapshot>> {
    return this.#executeGoverned(
      input.governance,
      "prediction-by-fixture",
      () => this.#client.getPrediction(input.binding.providerFixtureId),
      async (clientResult) => {
        const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
        if (!evidence.ok) return evidence.failure;
        if (clientResult.payload.response.length !== 1) {
          return providerFailure("RESPONSE_CARDINALITY_INVALID", "PREDICTION_ROW_REQUIRED", {
            evidence: evidence.descriptor,
          });
        }
        const mapped = this.#mappers.prediction(clientResult.payload.response[0], {
          capturedAtUtc: evidence.descriptor.capturedAtUtc,
          requestedProviderFixtureId: input.binding.providerFixtureId,
          expectedKickoffUtc: input.binding.kickoffUtc,
          expectedHomeProviderTeamId: input.binding.homeProviderTeamId,
          expectedHomeName: input.binding.homeName,
          expectedAwayProviderTeamId: input.binding.awayProviderTeamId,
          expectedAwayName: input.binding.awayName,
          contentHash: evidence.descriptor.contentHash,
          parserVersion: input.parserVersion,
          policyVersion: input.policyVersion,
        });
        if (!mapped.ok) {
          return providerFailure("MAPPING_FAILURE", mapped.error.classification, {
            evidence: evidence.descriptor,
          });
        }
        if (!mapped.data.predictionCapturedBeforeKickoff) {
          return providerFailure("CHRONOLOGY_FAILURE", "POST_KICKOFF_PREDICTION_BLOCKED", {
            evidence: evidence.descriptor,
          });
        }
        const persisted = await this.#persistence.persistPredictionCapture({
          snapshot: mapped.data,
          evidence: evidence.descriptor,
        });
        if (!persisted.ok) {
          return providerFailure("PERSISTENCE_FAILURE", persisted.error.sanitizedCode, {
            evidence: evidence.descriptor,
            conflict: persisted.disposition === "CONFLICT",
          });
        }
        return Object.freeze({
          ok: true,
          data: mapped.data,
          evidence: evidence.descriptor,
          persistenceDisposition: persisted.disposition,
        });
      },
    );
  }

  async captureOutcomeGoverned(
    input: GovernedOutcomeInput,
  ): Promise<ApiFootballGovernedProviderResult<ProviderOutcomeResolution>> {
    return this.#executeGoverned(
      input.governance,
      "fixture-result-by-id",
      () => this.#client.getFixtureResult(input.binding.providerFixtureId),
      async (clientResult) => {
        const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
        if (!evidence.ok) return evidence.failure;
        if (clientResult.payload.response.length !== 1) {
          return providerFailure("RESPONSE_CARDINALITY_INVALID", "RESULT_ROW_REQUIRED", {
            evidence: evidence.descriptor,
          });
        }
        const mapped = this.#mappers.result(clientResult.payload.response[0], {
          capturedAtUtc: evidence.descriptor.capturedAtUtc,
          requestedProviderFixtureId: input.binding.providerFixtureId,
          expectedLeagueProviderId: input.binding.providerCompetitionId,
          expectedSeason: input.binding.season,
          expectedHomeProviderTeamId: input.binding.homeProviderTeamId,
          expectedHomeName: input.binding.homeName,
          expectedAwayProviderTeamId: input.binding.awayProviderTeamId,
          expectedAwayName: input.binding.awayName,
          expectedKickoffUtc: input.binding.kickoffUtc,
        });
        if (!mapped.ok) {
          return providerFailure("MAPPING_FAILURE", mapped.error.classification, {
            evidence: evidence.descriptor,
            rawStatusCode: mapped.error.rawStatusCode,
          });
        }
        const persisted = await this.#persistence.persistOutcomeCapture({
          resolution: mapped.data,
          canonicalFixtureId: input.binding.canonicalFixtureId,
          evidence: evidence.descriptor,
        });
        if (!persisted.ok) {
          return providerFailure("PERSISTENCE_FAILURE", persisted.error.sanitizedCode, {
            evidence: evidence.descriptor,
            conflict: persisted.disposition === "CONFLICT",
            rawStatusCode: mapped.data.providerTerminalStatusRaw,
          });
        }
        return Object.freeze({
          ok: true,
          data: mapped.data,
          evidence: evidence.descriptor,
          persistenceDisposition: persisted.disposition,
        });
      },
    );
  }

  async #executeGoverned<Envelope, Data>(
    governance: ApiFootballGovernedRequestContext,
    expectedEndpoint: GovernedRequestInput["endpointKey"],
    clientOperation: () => Promise<ApiFootballClientResult<Envelope>>,
    process: (
      result: Extract<ApiFootballClientResult<Envelope>, { ok: true }>,
    ) => Promise<ApiFootballProviderResult<Data>>,
  ): Promise<ApiFootballGovernedProviderResult<Data>> {
    if (governance.request.endpointKey !== expectedEndpoint) {
      return this.#governedFailure(
        governance,
        "REQUEST_FAILURE",
        "GOVERNED_ENDPOINT_MISMATCH",
      );
    }
    let downstream: ApiFootballProviderResult<Data> | undefined;
    let clientFailureCode: string | undefined;
    const governed = await governance.executor.execute(
      governance.request,
      async () => {
        const clientResult = await clientOperation();
        if (!clientResult.ok) {
          clientFailureCode = clientResult.error.classification;
          if (clientResult.evidenceCandidate !== undefined) {
            const evidence = await this.#publishEvidence(clientResult.evidenceCandidate);
            if (!evidence.ok) downstream = evidence.failure;
          }
          return clientResult;
        }
        downstream = await process(clientResult);
        return Object.freeze({
          ok: true,
          payload: downstream,
          metadata: clientResult.metadata,
        });
      },
    );
    const state = Object.freeze({
      governanceStatus: governed.status,
      attemptsUsed: governed.attemptsUsed,
      remainingBudget: governed.remainingBudget,
      circuitState: governed.circuitState,
      ...(governed.circuitReason === undefined ? {} : {
        circuitReason: governed.circuitReason,
      }),
    });
    if (governed.status === "SUCCESS" || governed.status === "SUCCESS_RUN_BLOCKED") {
      const capture = governed.value;
      return capture.ok
        ? Object.freeze({ ...state, ...capture })
        : Object.freeze({ ...state, ...capture });
    }
    const completedPersistenceDisposition = downstream?.ok
      ? downstream.persistenceDisposition
      : undefined;
    const evidence = downstream === undefined
      ? undefined
      : downstream.evidence;
    const classification: ApiFootballProviderFailureClassification =
      governed.status === "BUDGET_EXHAUSTED"
        ? "BUDGET_EXHAUSTED"
        : governed.status === "CIRCUIT_OPEN"
          ? "CIRCUIT_OPEN"
          : governed.status === "AUDIT_FAILED"
            ? "AUDIT_FAILURE"
            : downstream !== undefined && !downstream.ok
              ? downstream.classification
              : clientFailureCode === undefined
                ? "REQUEST_FAILURE"
                : "CLIENT_FAILURE";
    return Object.freeze({
      ...state,
      ok: false,
      classification,
      sanitizedCode: governed.status === "AUDIT_FAILED"
        ? "AUDIT_PERSISTENCE_FAILURE"
        : downstream !== undefined && !downstream.ok
          ? downstream.sanitizedCode
          : clientFailureCode ?? governed.classification,
      conflict: downstream !== undefined && !downstream.ok
        ? downstream.conflict
        : false,
      ...(evidence === undefined ? {} : { evidence }),
      ...(downstream !== undefined && !downstream.ok && downstream.rawStatusCode !== undefined
        ? { rawStatusCode: downstream.rawStatusCode }
        : {}),
      ...(completedPersistenceDisposition === undefined
        ? {}
        : { completedPersistenceDisposition }),
    });
  }

  #governedFailure<Data>(
    governance: ApiFootballGovernedRequestContext,
    classification: ApiFootballProviderFailureClassification,
    sanitizedCode: string,
  ): ApiFootballGovernedProviderResult<Data> {
    const budget = governance.executor.dependencies.budget.inspect();
    const circuit = governance.executor.dependencies.circuitBreaker.inspect();
    return Object.freeze({
      ok: false,
      classification,
      sanitizedCode,
      conflict: false,
      governanceStatus: "FAILED",
      attemptsUsed: budget.startedAttempts,
      remainingBudget: budget.remainingAttempts,
      circuitState: circuit.state,
      ...(circuit.reason === undefined ? {} : { circuitReason: circuit.reason }),
    });
  }

  async #clientFailure(
    result: ApiFootballClientFailure,
  ): Promise<ApiFootballProviderResult<never>> {
    if (result.evidenceCandidate === undefined) {
      return providerFailure("CLIENT_FAILURE", result.error.classification);
    }
    const evidence = await this.#publishEvidence(result.evidenceCandidate);
    if (!evidence.ok) return evidence.failure;
    return providerFailure("CLIENT_FAILURE", result.error.classification, {
      evidence: evidence.descriptor,
    });
  }

  async #publishEvidence(candidate: ApiFootballEvidenceCandidate): Promise<
    | Readonly<{ ok: true; descriptor: RawEvidenceDescriptor }>
    | Readonly<{ ok: false; failure: ApiFootballProviderResult<never> }>
  > {
    const published = await this.#rawEvidenceStore.publish({
      providerKey: "api-football",
      endpointKey: candidate.endpointKey,
      capturedAtUtc: candidate.capturedAtUtc,
      mediaType: candidate.mediaType,
      bytes: candidate.rawBytes,
      sourceReference: `api-football:${candidate.endpointKey}:${candidate.capturedAtUtc}`,
    });
    if (!published.ok) {
      return Object.freeze({
        ok: false,
        failure: providerFailure(
          "EVIDENCE_FAILURE",
          published.error.sanitizedCode,
          { conflict: published.disposition === "CONFLICT" },
        ),
      });
    }
    return Object.freeze({ ok: true, descriptor: published.descriptor });
  }
}
