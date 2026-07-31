import type { CaptureProvider } from "./capture-provider";
import { assertProviderCapabilities } from "./capture-provider";
import { contextWithAttempt } from "./capture-run";
import type { RateLimitPolicy } from "./rate-limit-policy";
import type { RetryPolicy, Sleeper } from "./retry-policy";
import { CaptureError, asCaptureError } from "@/domain/market-v2/capture/errors";
import { createRawEvidence } from "@/domain/market-v2/capture/evidence";
import { ObservationDeduplicator } from "@/domain/market-v2/capture/deduplication";
import type { DeduplicationInput } from "@/domain/market-v2/capture/deduplication";
import type { ProviderCapability } from "@/domain/market-v2/capture/stages";
import type {
  CaptureClock,
  CaptureData,
  CaptureRunContext,
  CaptureRunResult,
  ClosingObservation,
  ForebetObservation,
  OddsObservation,
  OutcomeObservation,
  ProviderCapture,
  RawCaptureEvidence,
  SyntheticFixture,
} from "@/domain/market-v2/capture/types";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";
import type {
  AppendOnlyEvidenceStore,
  EvidencePublishDisposition,
} from "@/infrastructure/market-v2/capture/evidence-store";

type EvidenceBound = Readonly<{ source_artifact_reference: string; content_hash: string }>;

type MutableMetrics = {
  discoveredFixtures: number;
  attemptedCaptures: number;
  successfulCaptures: number;
  duplicateCaptures: number;
  conflictedCaptures: number;
  failedCaptures: number;
  retryCount: number;
  rateLimitedCount: number;
  evidenceIds: string[];
  warningCodes: string[];
  errorCodes: CaptureError["code"][];
};

type ExecutedCapture<T> = Readonly<{
  providerCapture: ProviderCapture<T>;
  evidence: RawCaptureEvidence;
  disposition: EvidencePublishDisposition;
}>;

function attachEvidence<T extends object>(draft: T, evidence: RawCaptureEvidence): T & EvidenceBound {
  return Object.freeze({
    ...draft,
    source_artifact_reference: evidence.sourceReference,
    content_hash: evidence.sha256,
  });
}

function assertUtc(value: string, label: string): void {
  if (!isNormalizedUtcTimestamp(value)) throw new Error(`${label} requires UTC Z`);
}

function validateFixture(fixture: SyntheticFixture, context: CaptureRunContext): void {
  assertUtc(fixture.kickoff_at_utc, "fixture kickoff");
  assertUtc(fixture.captured_at_utc, "fixture capture");
  if (!fixture.source_fixture_id.startsWith("SYNTH_")) throw new Error("fixture must be synthetic");
  if (!context.allowedCompetitionKeys.includes(fixture.competition_key)) {
    throw new Error("fixture is outside the configured universe");
  }
  if (!fixture.home_team_raw.startsWith("Synthetic ") || !fixture.away_team_raw.startsWith("Synthetic ")) {
    throw new Error("fixture team labels must be synthetic");
  }
}

function validateForebet(observation: ForebetObservation, fixture: SyntheticFixture): void {
  assertUtc(observation.captured_at_utc, "Forebet capture");
  const probabilities = [
    observation.home_probability,
    observation.draw_probability,
    observation.away_probability,
  ];
  if (probabilities.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Forebet probabilities must use the 0-1 scale");
  }
  if (Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) > 0.01) {
    throw new Error("Forebet probabilities must sum to one");
  }
  if (observation.captured_at_utc >= fixture.kickoff_at_utc) {
    throw new Error("Forebet capture must be before kickoff");
  }
}

function validateOdds(observation: OddsObservation, fixture: SyntheticFixture): void {
  assertUtc(observation.captured_at_utc, "odds capture");
  if (observation.decimal_odds <= 1) throw new Error("decimal odds must be greater than one");
  if (observation.market_status !== "ACTIVE") throw new Error("odds market must be active");
  if (observation.is_in_play) throw new Error("in-play odds are not accepted");
  if (observation.captured_at_utc >= fixture.kickoff_at_utc) {
    throw new Error("odds capture must be before kickoff");
  }
}

function validateClosing(observation: ClosingObservation, fixture: SyntheticFixture): void {
  assertUtc(observation.captured_at_utc, "closing capture");
  const seconds = (Date.parse(fixture.kickoff_at_utc) - Date.parse(observation.captured_at_utc)) / 1000;
  if (seconds <= 0 || Math.abs(seconds - observation.seconds_before_kickoff) > 1) {
    throw new Error("closing chronology is inconsistent");
  }
}

function validateOutcome(observation: OutcomeObservation, fixture: SyntheticFixture): void {
  assertUtc(observation.observed_at_utc, "outcome observation");
  if (observation.observed_at_utc <= fixture.kickoff_at_utc) {
    throw new Error("outcome must be observed after kickoff");
  }
  const result =
    observation.home_score > observation.away_score
      ? "HOME"
      : observation.away_score > observation.home_score
        ? "AWAY"
        : "DRAW";
  if (result !== observation.result_1x2) throw new Error("outcome score and result disagree");
}

function deduplicationInput(
  value: SyntheticFixture | ForebetObservation | OddsObservation | ClosingObservation | OutcomeObservation,
  evidenceAlreadyPublished: boolean,
): DeduplicationInput {
  if ("source_fixture_id" in value && "kickoff_at_utc" in value) {
    return {
      kind: "FIXTURE",
      recordId: value.source_fixture_id,
      logicalIdentity: {
        sourceFixtureId: value.source_fixture_id,
        kickoffAtUtc: value.kickoff_at_utc,
        capturedAtUtc: value.captured_at_utc,
      },
      contentHash: value.content_hash,
      evidenceAlreadyPublished,
    };
  }
  if ("forebet_snapshot_id" in value) {
    return {
      kind: "FOREBET",
      recordId: value.forebet_snapshot_id,
      logicalIdentity: {
        fixtureId: value.source_fixture_id,
        capturedAtUtc: value.captured_at_utc,
      },
      contentHash: value.content_hash,
      evidenceAlreadyPublished,
    };
  }
  if ("odds_snapshot_id" in value) {
    return {
      kind: "ODDS",
      recordId: value.odds_snapshot_id,
      logicalIdentity: {
        fixtureId: value.source_fixture_id,
        marketKey: value.market_key,
        selectionKey: value.selection_key,
        capturedAtUtc: value.captured_at_utc,
      },
      contentHash: value.content_hash,
      evidenceAlreadyPublished,
    };
  }
  if ("closing_snapshot_id" in value) {
    return {
      kind: "CLOSING",
      recordId: value.closing_snapshot_id,
      logicalIdentity: {
        fixtureId: value.fixture_id,
        marketKey: value.market_key,
        selectionKey: value.selection_key,
        capturedAtUtc: value.captured_at_utc,
      },
      contentHash: value.content_hash,
      evidenceAlreadyPublished,
    };
  }
  return {
    kind: "OUTCOME",
    recordId: value.outcome_id,
    logicalIdentity: {
      fixtureId: value.fixture_id,
      observedAtUtc: value.observed_at_utc,
      supersedesOutcomeId: value.supersedes_outcome_id,
    },
    contentHash: value.content_hash,
    evidenceAlreadyPublished,
  };
}

export class CaptureOrchestrator {
  readonly #deduplicator = new ObservationDeduplicator();

  constructor(
    readonly evidenceStore: AppendOnlyEvidenceStore,
    readonly clock: CaptureClock,
    readonly retryPolicy: RetryPolicy,
    readonly sleeper: Sleeper,
    readonly rateLimitPolicy: RateLimitPolicy,
  ) {}

  async run(
    context: CaptureRunContext,
    provider: CaptureProvider,
    knownFixtures: readonly SyntheticFixture[] = [],
  ): Promise<CaptureRunResult> {
    if (!context.synthetic) throw new Error("orchestrator accepts synthetic runs only");
    if (
      context.providerKey !== provider.providerKey ||
      context.providerVersion !== provider.providerVersion
    ) {
      throw new Error("run context and provider identity must match");
    }
    assertProviderCapabilities(provider, context.stage);
    const startedAtUtc = this.clock.nowUtc();
    const metrics: MutableMetrics = {
      discoveredFixtures: 0,
      attemptedCaptures: 0,
      successfulCaptures: 0,
      duplicateCaptures: 0,
      conflictedCaptures: 0,
      failedCaptures: 0,
      retryCount: 0,
      rateLimitedCount: 0,
      evidenceIds: [],
      warningCodes: [],
      errorCodes: [],
    };
    const fixtures: SyntheticFixture[] = [...knownFixtures];
    const forebetSnapshots: ForebetObservation[] = [];
    const oddsSnapshots: OddsObservation[] = [];
    const closingSnapshots: ClosingObservation[] = [];
    const outcomes: OutcomeObservation[] = [];

    if (
      (context.stage === "PREMATCH" ||
        context.stage === "CLOSING" ||
        context.stage === "SYNTHETIC_FULL") &&
      provider.discoverFixtures !== undefined &&
      knownFixtures.length === 0
    ) {
      try {
        const executed = await this.#execute(
          context,
          "FIXTURES",
          undefined,
          (attemptContext) => provider.discoverFixtures!(attemptContext),
          metrics,
        );
        const discovered = executed.providerCapture.normalize().map((draft) =>
          attachEvidence(draft, executed.evidence),
        );
        for (const fixture of discovered) {
          validateFixture(fixture, context);
          this.#accept(context, fixture, executed.disposition, metrics, fixtures);
        }
        metrics.discoveredFixtures = discovered.length;
        metrics.successfulCaptures += 1;
      } catch (error) {
        this.#recordFailure(error, context, undefined, metrics);
      }
    }

    const fixtureMap = new Map(fixtures.map((fixture) => [fixture.source_fixture_id, fixture]));
    const universeFixtures = [...fixtureMap.values()].sort((left, right) =>
      left.source_fixture_id.localeCompare(right.source_fixture_id),
    );

    if (context.stage === "PREMATCH" || context.stage === "SYNTHETIC_FULL") {
      if (provider.captureForebet !== undefined) {
        for (const fixture of universeFixtures) {
          try {
            const executed = await this.#execute(
              context,
              "FOREBET",
              fixture.source_fixture_id,
              (attemptContext) => provider.captureForebet!(attemptContext, fixture),
              metrics,
            );
            const observation = attachEvidence(executed.providerCapture.normalize(), executed.evidence);
            validateForebet(observation, fixture);
            this.#accept(context, observation, executed.disposition, metrics, forebetSnapshots);
            metrics.successfulCaptures += 1;
          } catch (error) {
            this.#recordFailure(error, context, fixture.source_fixture_id, metrics);
          }
        }
      }
      if (provider.captureOdds !== undefined) {
        for (const fixture of universeFixtures) {
          try {
            const executed = await this.#execute(
              context,
              "ODDS",
              fixture.source_fixture_id,
              (attemptContext) => provider.captureOdds!(attemptContext, fixture),
              metrics,
            );
            const observation = attachEvidence(executed.providerCapture.normalize(), executed.evidence);
            validateOdds(observation, fixture);
            this.#accept(context, observation, executed.disposition, metrics, oddsSnapshots);
            metrics.successfulCaptures += 1;
          } catch (error) {
            this.#recordFailure(error, context, fixture.source_fixture_id, metrics);
          }
        }
      }
    }

    if (context.stage === "CLOSING" || context.stage === "SYNTHETIC_FULL") {
      if (provider.captureClosing !== undefined) {
        for (const fixture of universeFixtures) {
          try {
            const executed = await this.#execute(
              context,
              "CLOSING",
              fixture.source_fixture_id,
              (attemptContext) => provider.captureClosing!(attemptContext, fixture),
              metrics,
            );
            const observation = attachEvidence(executed.providerCapture.normalize(), executed.evidence);
            validateClosing(observation, fixture);
            this.#accept(context, observation, executed.disposition, metrics, closingSnapshots);
            metrics.successfulCaptures += 1;
          } catch (error) {
            this.#recordFailure(error, context, fixture.source_fixture_id, metrics);
          }
        }
      }
    }

    if (context.stage === "OUTCOME" || context.stage === "SYNTHETIC_FULL") {
      if (provider.captureOutcomes !== undefined) {
        for (const fixture of universeFixtures) {
          try {
            const executed = await this.#execute(
              context,
              "OUTCOMES",
              fixture.source_fixture_id,
              (attemptContext) => provider.captureOutcomes!(attemptContext, fixture),
              metrics,
            );
            const normalized = executed.providerCapture
              .normalize()
              .map((draft) => attachEvidence(draft, executed.evidence));
            for (const observation of normalized) {
              validateOutcome(observation, fixture);
              this.#accept(context, observation, executed.disposition, metrics, outcomes);
            }
            metrics.successfulCaptures += 1;
          } catch (error) {
            this.#recordFailure(error, context, fixture.source_fixture_id, metrics);
          }
        }
      }
    }

    this.#validateOutcomeCorrections(outcomes, context, metrics);
    const data: CaptureData = Object.freeze({
      fixtures: Object.freeze(universeFixtures),
      forebetSnapshots: Object.freeze(forebetSnapshots),
      oddsSnapshots: Object.freeze(oddsSnapshots),
      closingSnapshots: Object.freeze(closingSnapshots),
      outcomes: Object.freeze(outcomes),
    });
    return Object.freeze({
      runId: context.runId,
      stage: context.stage,
      startedAtUtc,
      completedAtUtc: this.clock.nowUtc(),
      providerSummaries: Object.freeze([
        Object.freeze({
          providerKey: provider.providerKey,
          providerVersion: provider.providerVersion,
          capabilities: Object.freeze([...provider.capabilities]),
        }),
      ]),
      ...metrics,
      evidenceIds: Object.freeze(metrics.evidenceIds),
      warningCodes: Object.freeze([...new Set(metrics.warningCodes)].sort()),
      errorCodes: Object.freeze([...new Set(metrics.errorCodes)].sort()),
      synthetic: true,
      data,
    });
  }

  async #execute<T>(
    context: CaptureRunContext,
    capability: ProviderCapability,
    fixtureId: string | undefined,
    operation: (attemptContext: CaptureRunContext) => Promise<ProviderCapture<T>>,
    metrics: MutableMetrics,
  ): Promise<ExecutedCapture<T>> {
    metrics.attemptedCaptures += 1;
    for (let attempt = 1; attempt <= this.retryPolicy.options.maxAttempts; attempt += 1) {
      const rateLimit = this.rateLimitPolicy.acquire(context.providerKey, capability, this.clock);
      if (!rateLimit.allowed) {
        metrics.rateLimitedCount += 1;
        throw new CaptureError({
          code: "CAPTURE_RATE_LIMITED",
          retryable: false,
          providerKey: context.providerKey,
          stage: context.stage,
          fixtureId,
          sanitizedMessage: rateLimit.reasonCode,
        });
      }
      const attemptContext = contextWithAttempt(context, attempt);
      try {
        const providerCapture = await operation(attemptContext);
        const evidence = createRawEvidence(attemptContext, providerCapture.response);
        const published = await this.evidenceStore.publish(evidence, providerCapture.response.body);
        if (!metrics.evidenceIds.includes(evidence.evidenceId)) metrics.evidenceIds.push(evidence.evidenceId);
        return Object.freeze({
          providerCapture,
          evidence: published.evidence,
          disposition: published.disposition,
        });
      } catch (error) {
        const captureError = asCaptureError(error, {
          code: "CAPTURE_PERMANENT_FAILURE",
          retryable: false,
          providerKey: context.providerKey,
          stage: context.stage,
          fixtureId,
          sanitizedMessage: "capture operation failed",
        });
        if (!this.retryPolicy.shouldRetry(captureError, attempt)) {
          if (captureError.retryable && attempt >= this.retryPolicy.options.maxAttempts) {
            throw new CaptureError({
              code: "CAPTURE_RETRY_EXHAUSTED",
              retryable: false,
              providerKey: context.providerKey,
              stage: context.stage,
              fixtureId,
              sanitizedMessage: "retry policy exhausted",
            });
          }
          throw captureError;
        }
        metrics.retryCount += 1;
        await this.sleeper.sleep(this.retryPolicy.delayForAttempt(attempt));
      }
    }
    throw new Error("retry loop must return or throw");
  }

  #accept<T extends SyntheticFixture | ForebetObservation | OddsObservation | ClosingObservation | OutcomeObservation>(
    context: CaptureRunContext,
    value: T,
    disposition: EvidencePublishDisposition,
    metrics: MutableMetrics,
    target: T[],
  ): void {
    const deduplication = this.#deduplicator.classify(
      deduplicationInput(value, disposition === "REPLAY"),
    );
    if (deduplication === "CONFLICT") {
      metrics.conflictedCaptures += 1;
      throw new CaptureError({
        code: "FIXTURE_IDENTITY_CONFLICT",
        retryable: false,
        providerKey: context.providerKey,
        stage: context.stage,
        sanitizedMessage: "record identity points to different content",
      });
    }
    if (deduplication === "EXACT_DUPLICATE" || deduplication === "REPLAY") {
      metrics.duplicateCaptures += 1;
      return;
    }
    target.push(value);
  }

  #recordFailure(
    error: unknown,
    context: CaptureRunContext,
    fixtureId: string | undefined,
    metrics: MutableMetrics,
  ): void {
    const captureError =
      error instanceof CaptureError
        ? error
        : new CaptureError({
            code: "CAPTURE_CONTENT_INVALID",
            retryable: false,
            providerKey: context.providerKey,
            stage: context.stage,
            fixtureId,
            sanitizedMessage: "normalized synthetic content is invalid",
          });
    metrics.failedCaptures += 1;
    metrics.errorCodes.push(captureError.code);
    metrics.warningCodes.push(
      fixtureId === undefined ? "SYNTHETIC_CAPTURE_PARTIAL" : `TECHNICAL_ABSTENTION_${fixtureId}`,
    );
  }

  #validateOutcomeCorrections(
    outcomes: readonly OutcomeObservation[],
    context: CaptureRunContext,
    metrics: MutableMetrics,
  ): void {
    const byId = new Map(outcomes.map((outcome) => [outcome.outcome_id, outcome]));
    for (const outcome of outcomes) {
      if (outcome.outcome_status !== "CORRECTED") continue;
      const previous = byId.get(outcome.supersedes_outcome_id ?? "");
      if (
        previous === undefined ||
        previous.fixture_id !== outcome.fixture_id ||
        previous.observed_at_utc >= outcome.observed_at_utc
      ) {
        this.#recordFailure(
          new CaptureError({
            code: "CAPTURE_CONTENT_INVALID",
            retryable: false,
            providerKey: context.providerKey,
            stage: context.stage,
            fixtureId: outcome.fixture_id,
            sanitizedMessage: "outcome correction is not append-only",
          }),
          context,
          outcome.fixture_id,
          metrics,
        );
      }
    }
  }
}
