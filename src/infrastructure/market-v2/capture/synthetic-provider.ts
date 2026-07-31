import type {
  CaptureProvider,
  EvidenceDraft,
} from "@/application/market-v2/capture/capture-provider";
import type {
  CaptureRunContext,
  CaptureTransport,
  ClosingObservation,
  ForebetObservation,
  OddsObservation,
  OutcomeObservation,
  ProviderCapture,
  SyntheticFixture,
  TransportResponse,
} from "@/domain/market-v2/capture/types";
import {
  SyntheticCaptureTransport,
  type SyntheticTransportRecord,
} from "./synthetic-transport";

const FIXTURE_CAPTURED_AT = "2030-02-01T10:00:00.000Z";

export const SYNTHETIC_FIXTURES: readonly EvidenceDraft<SyntheticFixture>[] = Object.freeze(
  [
    ["A", "18:00", "CONFIRMED"],
    ["B", "19:00", "HIGH"],
    ["C", "20:00", "CONFIRMED"],
    ["D", "21:00", "HIGH"],
  ].map(([key, kickoff, confidence]) =>
    Object.freeze({
      source_fixture_id: `SYNTH_FIXTURE_${key}`,
      source_name: "SYNTHETIC_FIXTURE_SOURCE",
      competition_raw: "Synthetic Competition Alpha",
      competition_key: "SYNTH_COMP_ALPHA",
      home_team_raw: `Synthetic Home ${key}`,
      away_team_raw: `Synthetic Away ${key}`,
      home_team_id: `SYNTH_TEAM_HOME_${key}`,
      away_team_id: `SYNTH_TEAM_AWAY_${key}`,
      kickoff_raw: `2030-02-01 ${kickoff} UTC`,
      kickoff_source_timezone: "UTC",
      kickoff_at_utc: `2030-02-01T${kickoff}:00.000Z`,
      kickoff_confidence: confidence as "CONFIRMED" | "HIGH",
      fixture_status: "SCHEDULED" as const,
      captured_at_utc: FIXTURE_CAPTURED_AT,
    }),
  ),
);

function fixtureKey(fixtureId: string): string {
  return fixtureId.slice(-1);
}

function parseBody<T>(response: TransportResponse): T {
  return JSON.parse(Buffer.from(response.body).toString("utf8")) as T;
}

function capture<T>(response: TransportResponse): ProviderCapture<T> {
  return Object.freeze({ response, normalize: () => parseBody<T>(response) });
}

function forebetDraft(key: string): EvidenceDraft<ForebetObservation> {
  const probabilities =
    key === "A"
      ? [0.55, 0.25, 0.2]
      : key === "B"
        ? [0.65, 0.2, 0.15]
        : [0.4, 0.3, 0.3];
  return Object.freeze({
    forebet_snapshot_id: `SYNTH_FOREBET_${key}`,
    source_fixture_id: `SYNTH_FIXTURE_${key}`,
    captured_at_utc: `2030-02-01T1${key === "A" ? "2" : key === "B" ? "3" : "4"}:00:00.000Z`,
    home_probability: probabilities[0],
    draw_probability: probabilities[1],
    away_probability: probabilities[2],
    predicted_home_score: 2,
    predicted_away_score: 1,
    source_page_reference: `synth:page:forebet-${key.toLowerCase()}`,
    parser_version: "synthetic-parser/1.0",
  });
}

function oddsDraft(key: string): EvidenceDraft<OddsObservation> {
  const capturedHour = key === "A" ? "17" : key === "B" ? "18" : key === "C" ? "19" : "20";
  return Object.freeze({
    odds_snapshot_id: `SYNTH_ODDS_${key}`,
    source_fixture_id: `SYNTH_FIXTURE_${key}`,
    bookmaker_key: "SYNTH_BOOK_A",
    market_key: key === "A" ? "DOUBLE_CHANCE" : "MATCH_ODDS_1X2",
    selection_key: key === "A" ? "HOME_OR_DRAW" : "AWAY",
    captured_at_utc: `2030-02-01T${capturedHour}:00:00.000Z`,
    decimal_odds: key === "A" ? 1.6 : 2.2,
    raw_odds: key === "A" ? "1.60" : "2.20",
    line_value: null,
    market_status: key === "D" ? "SUSPENDED" : "ACTIVE",
    is_in_play: key === "C",
    source_event_id: `SYNTH_EVENT_${key}`,
    source_market_id: `SYNTH_MARKET_${key}`,
    source_selection_id: `SYNTH_SELECTION_${key}`,
    price_kind: "OFFERED",
  });
}

function closingDraft(key: string): EvidenceDraft<ClosingObservation> {
  const hour = key === "A" ? "17" : key === "B" ? "18" : key === "C" ? "19" : "20";
  return Object.freeze({
    closing_snapshot_id: `SYNTH_CLOSING_${key}`,
    fixture_id: `SYNTH_FIXTURE_${key}`,
    bookmaker_key: "SYNTH_BOOK_A",
    market_key: key === "A" ? "DOUBLE_CHANCE" : "MATCH_ODDS_1X2",
    selection_key: key === "A" ? "HOME_OR_DRAW" : "AWAY",
    captured_at_utc: `2030-02-01T${hour}:55:00.000Z`,
    decimal_odds: key === "A" ? 1.55 : 2.1,
    seconds_before_kickoff: 300,
    status: "ACTIVE",
  });
}

function outcomeDrafts(key: string): readonly EvidenceDraft<OutcomeObservation>[] {
  const score = key === "B" ? [0, 0] : [2, 1];
  const observed = key === "A" ? "22" : key === "B" ? "23" : key === "C" ? "00" : "01";
  const date = key === "A" || key === "B" ? "2030-02-01" : "2030-02-02";
  const first: EvidenceDraft<OutcomeObservation> = Object.freeze({
    outcome_id: `SYNTH_OUTCOME_${key}_V1`,
    fixture_id: `SYNTH_FIXTURE_${key}`,
    observed_at_utc: `${date}T${observed}:00:00.000Z`,
    source_name: "SYNTHETIC_OUTCOME_SOURCE",
    home_score: score[0],
    away_score: score[1],
    result_1x2: score[0] === score[1] ? "DRAW" : "HOME",
    outcome_status: "FINAL",
    supersedes_outcome_id: null,
  });
  if (key !== "B") return Object.freeze([first]);
  return Object.freeze([
    first,
    Object.freeze({
      ...first,
      outcome_id: "SYNTH_OUTCOME_B_V2",
      observed_at_utc: "2030-02-01T23:30:00.000Z",
      home_score: 1,
      away_score: 0,
      result_1x2: "HOME",
      outcome_status: "CORRECTED",
      supersedes_outcome_id: "SYNTH_OUTCOME_B_V1",
    }),
  ]);
}

export function createSyntheticTransport(): SyntheticCaptureTransport {
  const records = new Map<string, SyntheticTransportRecord>();
  records.set("synth:fixtures:v1", {
    capturedAtUtc: FIXTURE_CAPTURED_AT,
    body: SYNTHETIC_FIXTURES,
    metadata: { scenario: "complete-universe" },
  });
  for (const key of ["A", "B", "C", "D"]) {
    records.set(`synth:forebet:${key.toLowerCase()}`, {
      capturedAtUtc: forebetDraft(key).captured_at_utc,
      body: forebetDraft(key),
      metadata: { scenario: key === "A" ? "concordant" : key === "B" ? "divergent" : "control" },
      failuresByAttempt:
        key === "B"
          ? {
              1: {
                code: "CAPTURE_TEMPORARY_FAILURE",
                retryable: true,
                sanitizedMessage: "synthetic temporary failure",
              },
            }
          : key === "C"
            ? {
                1: {
                  code: "CAPTURE_PERMANENT_FAILURE",
                  retryable: false,
                  sanitizedMessage: "synthetic permanent failure",
                },
              }
            : undefined,
    });
    records.set(`synth:odds:${key.toLowerCase()}`, {
      capturedAtUtc: oddsDraft(key).captured_at_utc,
      body: oddsDraft(key),
      metadata: { scenario: key === "C" ? "in-play-invalid" : key === "D" ? "suspended" : "valid" },
    });
    records.set(`synth:closing:${key.toLowerCase()}`, {
      capturedAtUtc: closingDraft(key).captured_at_utc,
      body: closingDraft(key),
      metadata: { scenario: "closing-control" },
    });
    records.set(`synth:outcome:${key.toLowerCase()}`, {
      capturedAtUtc: outcomeDrafts(key).at(-1)?.observed_at_utc ?? "2030-02-02T02:00:00.000Z",
      body: outcomeDrafts(key),
      metadata: { scenario: key === "B" ? "append-only-correction" : "final" },
    });
  }
  return new SyntheticCaptureTransport(records);
}

abstract class SyntheticProviderBase {
  abstract readonly providerKey: string;
  abstract readonly providerVersion: string;
  constructor(protected readonly transport: CaptureTransport) {}

  protected request(
    context: CaptureRunContext,
    capability: "FIXTURES" | "FOREBET" | "ODDS" | "CLOSING" | "OUTCOMES",
    sourceReference: string,
    fixtureId?: string,
  ): Promise<TransportResponse> {
    return this.transport.execute({
      providerKey: this.providerKey,
      stage: context.stage,
      capability,
      sourceReference,
      fixtureId,
      attemptNumber: context.attemptNumber,
    });
  }
}

export class SyntheticForebetProvider extends SyntheticProviderBase implements CaptureProvider {
  readonly providerKey = "SYNTH_FOREBET_PROVIDER";
  readonly providerVersion = "synthetic-forebet/1.0";
  readonly capabilities = ["FIXTURES", "FOREBET"] as const;

  async discoverFixtures(context: CaptureRunContext) {
    return capture<readonly EvidenceDraft<SyntheticFixture>[]>(
      await this.request(context, "FIXTURES", "synth:fixtures:v1"),
    );
  }

  async captureForebet(context: CaptureRunContext, fixture: SyntheticFixture) {
    const key = fixtureKey(fixture.source_fixture_id);
    return capture<EvidenceDraft<ForebetObservation>>(
      await this.request(context, "FOREBET", `synth:forebet:${key.toLowerCase()}`, fixture.source_fixture_id),
    );
  }
}

export class SyntheticOddsProvider extends SyntheticProviderBase implements CaptureProvider {
  readonly providerKey = "SYNTH_ODDS_PROVIDER";
  readonly providerVersion = "synthetic-odds/1.0";
  readonly capabilities = ["FIXTURES", "ODDS", "CLOSING"] as const;

  async discoverFixtures(context: CaptureRunContext) {
    return capture<readonly EvidenceDraft<SyntheticFixture>[]>(
      await this.request(context, "FIXTURES", "synth:fixtures:v1"),
    );
  }

  async captureOdds(context: CaptureRunContext, fixture: SyntheticFixture) {
    const key = fixtureKey(fixture.source_fixture_id);
    return capture<EvidenceDraft<OddsObservation>>(
      await this.request(context, "ODDS", `synth:odds:${key.toLowerCase()}`, fixture.source_fixture_id),
    );
  }

  async captureClosing(context: CaptureRunContext, fixture: SyntheticFixture) {
    const key = fixtureKey(fixture.source_fixture_id);
    return capture<EvidenceDraft<ClosingObservation>>(
      await this.request(context, "CLOSING", `synth:closing:${key.toLowerCase()}`, fixture.source_fixture_id),
    );
  }
}

export class SyntheticOutcomeProvider extends SyntheticProviderBase implements CaptureProvider {
  readonly providerKey = "SYNTH_OUTCOME_PROVIDER";
  readonly providerVersion = "synthetic-outcome/1.0";
  readonly capabilities = ["OUTCOMES"] as const;

  async captureOutcomes(context: CaptureRunContext, fixture: SyntheticFixture) {
    const key = fixtureKey(fixture.source_fixture_id);
    return capture<readonly EvidenceDraft<OutcomeObservation>[]>(
      await this.request(context, "OUTCOMES", `synth:outcome:${key.toLowerCase()}`, fixture.source_fixture_id),
    );
  }
}
