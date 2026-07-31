"""Immutable source-neutral contracts for prospective capture packets."""

import hashlib
import json
import re
from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    model_validator,
)

SHA256_PATTERN = r"^[a-f0-9]{64}$"
IDENTIFIER_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"
PROBABILITY_TOLERANCE = 0.01


def _require_utc_z(value: object) -> object:
    if isinstance(value, str):
        if not value.endswith("Z"):
            raise ValueError("timestamp must use explicit UTC Z notation")
        return value
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("timestamp must be timezone-aware UTC")
        return value
    return value


UtcTimestamp = Annotated[datetime, BeforeValidator(_require_utc_z)]


class StrictModel(BaseModel):
    """Forbid undeclared fields and mutation in every R0 contract."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ProtocolPhase(StrEnum):
    PILOT = "PILOT"
    SHADOW = "SHADOW"
    FROZEN_EVALUATION = "FROZEN_EVALUATION"
    HOLDOUT = "HOLDOUT"
    PROSPECTIVE_VALIDATION = "PROSPECTIVE_VALIDATION"


class CaptureStage(StrEnum):
    PREMATCH = "PREMATCH"
    CLOSING = "CLOSING"
    OUTCOME = "OUTCOME"
    SYNTHETIC_FULL = "SYNTHETIC_FULL"


class SnapshotRole(StrEnum):
    EARLY = "EARLY"
    DECISION = "DECISION"
    CLOSING = "CLOSING"


class KickoffConfidence(StrEnum):
    CONFIRMED = "CONFIRMED"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"


class FixtureStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    POSTPONED = "POSTPONED"
    CANCELLED = "CANCELLED"
    STARTED = "STARTED"
    FINISHED = "FINISHED"
    UNKNOWN = "UNKNOWN"


class MarketKey(StrEnum):
    MATCH_ODDS_1X2 = "MATCH_ODDS_1X2"
    DOUBLE_CHANCE = "DOUBLE_CHANCE"
    DRAW_NO_BET = "DRAW_NO_BET"


class SelectionKey(StrEnum):
    HOME = "HOME"
    DRAW = "DRAW"
    AWAY = "AWAY"
    HOME_OR_DRAW = "HOME_OR_DRAW"
    DRAW_OR_AWAY = "DRAW_OR_AWAY"
    HOME_DNB = "HOME_DNB"
    AWAY_DNB = "AWAY_DNB"


MARKET_SELECTIONS: dict[MarketKey, frozenset[SelectionKey]] = {
    MarketKey.MATCH_ODDS_1X2: frozenset({SelectionKey.HOME, SelectionKey.DRAW, SelectionKey.AWAY}),
    MarketKey.DOUBLE_CHANCE: frozenset({SelectionKey.HOME_OR_DRAW, SelectionKey.DRAW_OR_AWAY}),
    MarketKey.DRAW_NO_BET: frozenset({SelectionKey.HOME_DNB, SelectionKey.AWAY_DNB}),
}


class MarketStatus(StrEnum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    CLOSED = "CLOSED"
    UNKNOWN = "UNKNOWN"


class DecisionStatus(StrEnum):
    SELECTED = "SELECTED"
    ABSTAINED = "ABSTAINED"
    BLOCKED = "BLOCKED"
    UNRESOLVED = "UNRESOLVED"


class OutcomeStatus(StrEnum):
    FINAL = "FINAL"
    CORRECTED = "CORRECTED"
    VOID = "VOID"


class Result1X2(StrEnum):
    HOME = "HOME"
    DRAW = "DRAW"
    AWAY = "AWAY"


class SnapshotSchedule(StrictModel):
    role: SnapshotRole
    target_seconds_before_kickoff: int = Field(gt=0)
    tolerance_seconds: int = Field(ge=0)


class CaptureUniverse(StrictModel):
    protocol_version: str = Field(min_length=1)
    phase: ProtocolPhase
    competition_allowlist: list[str] = Field(min_length=1)
    date_from: date
    date_to: date
    required_markets: list[MarketKey] = Field(min_length=1)
    allowed_bookmakers: list[str] = Field(min_length=1)
    snapshot_schedule: list[SnapshotSchedule] = Field(min_length=1)
    postponed_fixture_policy: Literal["RECAPTURE_NEW_KICKOFF", "EXCLUDE"]
    unreliable_kickoff_policy: Literal["BLOCK_DECISION", "EXCLUDE"]

    @model_validator(mode="after")
    def validate_universe(self) -> Self:
        if self.date_from > self.date_to:
            raise ValueError("date_from must not exceed date_to")
        unique_fields: list[tuple[str, list[Any]]] = [
            ("competition_allowlist", list(self.competition_allowlist)),
            ("required_markets", list(self.required_markets)),
            ("allowed_bookmakers", list(self.allowed_bookmakers)),
            ("snapshot_schedule", [item.role for item in self.snapshot_schedule]),
        ]
        for name, values in unique_fields:
            if len(values) != len(set(values)):
                raise ValueError(f"{name} must not contain duplicates")
        return self


class PacketSourceMetadata(StrictModel):
    synthetic: bool
    capture_stage: CaptureStage
    source_names: list[str] = Field(min_length=1)
    data_classification: Literal["SYNTHETIC", "PROSPECTIVE_REAL"]

    @model_validator(mode="after")
    def validate_classification(self) -> Self:
        if self.synthetic != (self.data_classification == "SYNTHETIC"):
            raise ValueError("synthetic flag and data_classification must agree")
        if self.capture_stage is CaptureStage.SYNTHETIC_FULL and not self.synthetic:
            raise ValueError("SYNTHETIC_FULL is reserved for synthetic packets")
        if len(self.source_names) != len(set(self.source_names)):
            raise ValueError("source_names must not contain duplicates")
        return self


class EvidenceItem(StrictModel):
    artifact_reference: str = Field(min_length=1)
    source_name: str = Field(min_length=1)
    captured_at_utc: UtcTimestamp
    content_hash: str = Field(pattern=SHA256_PATTERN)


class EvidenceManifest(StrictModel):
    items: list[EvidenceItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_references(self) -> Self:
        references = [item.artifact_reference for item in self.items]
        if len(references) != len(set(references)):
            raise ValueError("evidence artifact references must be unique")
        return self


class Fixture(StrictModel):
    source_fixture_id: str = Field(pattern=IDENTIFIER_PATTERN)
    source_name: str = Field(min_length=1)
    competition_raw: str = Field(min_length=1)
    competition_key: str | None = None
    home_team_raw: str = Field(min_length=1)
    away_team_raw: str = Field(min_length=1)
    home_team_id: str | None = None
    away_team_id: str | None = None
    kickoff_raw: str = Field(min_length=1)
    kickoff_source_timezone: str = Field(min_length=1)
    kickoff_at_utc: UtcTimestamp | None
    kickoff_confidence: KickoffConfidence
    fixture_status: FixtureStatus
    captured_at_utc: UtcTimestamp
    source_artifact_reference: str = Field(min_length=1)
    content_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_kickoff(self) -> Self:
        if self.kickoff_at_utc is None and self.kickoff_confidence in {
            KickoffConfidence.CONFIRMED,
            KickoffConfidence.HIGH,
        }:
            raise ValueError("high-confidence fixture requires kickoff_at_utc")
        if self.kickoff_at_utc is not None and self.home_team_raw == self.away_team_raw:
            raise ValueError("home and away teams must differ")
        return self


class ForebetSnapshot(StrictModel):
    forebet_snapshot_id: str = Field(pattern=IDENTIFIER_PATTERN)
    source_fixture_id: str = Field(pattern=IDENTIFIER_PATTERN)
    captured_at_utc: UtcTimestamp
    home_probability: float = Field(ge=0, le=1)
    draw_probability: float = Field(ge=0, le=1)
    away_probability: float = Field(ge=0, le=1)
    predicted_home_score: int | None = Field(default=None, ge=0)
    predicted_away_score: int | None = Field(default=None, ge=0)
    source_page_reference: str = Field(min_length=1)
    source_artifact_reference: str = Field(min_length=1)
    parser_version: str = Field(min_length=1)
    content_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_probability_sum(self) -> Self:
        total = self.home_probability + self.draw_probability + self.away_probability
        if abs(total - 1.0) > PROBABILITY_TOLERANCE:
            raise ValueError("Forebet 1X2 probabilities must sum to 1 within tolerance")
        return self


class OddsSnapshot(StrictModel):
    odds_snapshot_id: str = Field(pattern=IDENTIFIER_PATTERN)
    source_fixture_id: str = Field(pattern=IDENTIFIER_PATTERN)
    bookmaker_key: str = Field(pattern=IDENTIFIER_PATTERN)
    market_key: MarketKey
    selection_key: SelectionKey
    captured_at_utc: UtcTimestamp
    decimal_odds: float = Field(gt=1)
    raw_odds: str | None = None
    line_value: float | None = None
    market_status: MarketStatus
    is_in_play: bool
    source_event_id: str = Field(min_length=1)
    source_market_id: str = Field(min_length=1)
    source_selection_id: str = Field(min_length=1)
    source_artifact_reference: str = Field(min_length=1)
    price_kind: Literal["OFFERED"]
    content_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_market(self) -> Self:
        if self.selection_key not in MARKET_SELECTIONS[self.market_key]:
            raise ValueError("selection is not valid for market")
        if self.market_status is not MarketStatus.ACTIVE:
            raise ValueError("odds market must be ACTIVE")
        if self.is_in_play:
            raise ValueError("in-play odds are not allowed")
        return self


class PrematchDecision(StrictModel):
    decision_id: str = Field(pattern=IDENTIFIER_PATTERN)
    fixture_id: str = Field(pattern=IDENTIFIER_PATTERN)
    decided_at_utc: UtcTimestamp
    decision_status: DecisionStatus
    reason_code: str = Field(min_length=1)
    selected_market_key: MarketKey | None = None
    selected_selection_key: SelectionKey | None = None
    selected_odds_snapshot_id: str | None = None
    estimated_probability: float | None = Field(default=None, ge=0, le=1)
    break_even_probability: float | None = Field(default=None, gt=0, lt=1)
    estimated_edge: float | None = Field(default=None, ge=-1, le=1)
    policy_version: str = Field(min_length=1)
    input_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_selection_shape(self) -> Self:
        selected = (
            self.selected_market_key,
            self.selected_selection_key,
            self.selected_odds_snapshot_id,
        )
        if self.decision_status is DecisionStatus.SELECTED and any(v is None for v in selected):
            raise ValueError(
                "SELECTED decision requires exact market, selection, and odds snapshot"
            )
        if self.decision_status is not DecisionStatus.SELECTED and any(
            v is not None for v in selected
        ):
            raise ValueError("non-SELECTED decision cannot retain a selected quote")
        return self


class ClosingLineObservation(StrictModel):
    closing_snapshot_id: str = Field(pattern=IDENTIFIER_PATTERN)
    fixture_id: str = Field(pattern=IDENTIFIER_PATTERN)
    bookmaker_key: str = Field(pattern=IDENTIFIER_PATTERN)
    market_key: MarketKey
    selection_key: SelectionKey
    captured_at_utc: UtcTimestamp
    decimal_odds: float = Field(gt=1)
    seconds_before_kickoff: int = Field(gt=0)
    status: MarketStatus
    source_artifact_reference: str = Field(min_length=1)
    content_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_market(self) -> Self:
        if self.selection_key not in MARKET_SELECTIONS[self.market_key]:
            raise ValueError("closing selection is not valid for market")
        return self


class Outcome(StrictModel):
    outcome_id: str = Field(pattern=IDENTIFIER_PATTERN)
    fixture_id: str = Field(pattern=IDENTIFIER_PATTERN)
    observed_at_utc: UtcTimestamp
    source_name: str = Field(min_length=1)
    home_score: int = Field(ge=0)
    away_score: int = Field(ge=0)
    result_1x2: Result1X2
    outcome_status: OutcomeStatus
    supersedes_outcome_id: str | None = None
    source_artifact_reference: str = Field(min_length=1)
    content_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_result(self) -> Self:
        expected = (
            Result1X2.HOME
            if self.home_score > self.away_score
            else Result1X2.AWAY
            if self.away_score > self.home_score
            else Result1X2.DRAW
        )
        if self.result_1x2 is not expected:
            raise ValueError("result_1x2 must agree with scores")
        if (self.outcome_status is OutcomeStatus.CORRECTED) != (
            self.supersedes_outcome_id is not None
        ):
            raise ValueError("CORRECTED outcome must supersede exactly one prior outcome")
        return self


def _canonical_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _canonical_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T.*Z", value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return _canonical_value(parsed)
    return value


def packet_payload_hash(payload: dict[str, Any]) -> str:
    """Hash a canonical packet payload after excluding its self-referential hash."""

    canonical = _canonical_value(
        {key: value for key, value in payload.items() if key != "packet_hash"}
    )
    serialized = json.dumps(
        canonical, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class ProspectiveCapturePacket(StrictModel):
    protocol_version: str = Field(min_length=1)
    packet_id: str = Field(pattern=IDENTIFIER_PATTERN)
    generated_at_utc: UtcTimestamp
    source_metadata: PacketSourceMetadata
    capture_universe: CaptureUniverse
    fixtures: list[Fixture] = Field(min_length=1)
    forebet_snapshots: list[ForebetSnapshot]
    odds_snapshots: list[OddsSnapshot]
    decisions: list[PrematchDecision]
    closing_snapshots: list[ClosingLineObservation]
    outcomes: list[Outcome]
    evidence_manifest: EvidenceManifest
    packet_hash: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def validate_packet(self) -> Self:
        if self.protocol_version != self.capture_universe.protocol_version:
            raise ValueError("packet and capture-universe protocol versions must match")
        stage = self.source_metadata.capture_stage
        if stage is CaptureStage.PREMATCH and (self.closing_snapshots or self.outcomes):
            raise ValueError("PREMATCH packet cannot contain closing snapshots or outcomes")
        if stage is CaptureStage.CLOSING and (
            self.forebet_snapshots or self.odds_snapshots or self.decisions or self.outcomes
        ):
            raise ValueError(
                "CLOSING packet must remain separate from decision inputs and outcomes"
            )
        if stage is CaptureStage.OUTCOME and (
            self.forebet_snapshots
            or self.odds_snapshots
            or self.decisions
            or self.closing_snapshots
        ):
            raise ValueError("OUTCOME packet must remain separate from prematch and closing data")

        fixture_ids = [fixture.source_fixture_id for fixture in self.fixtures]
        if len(fixture_ids) != len(set(fixture_ids)):
            raise ValueError("fixture IDs must be unique")
        fixtures = {fixture.source_fixture_id: fixture for fixture in self.fixtures}
        allowed_competitions = set(self.capture_universe.competition_allowlist)
        for universe_fixture in self.fixtures:
            if (
                universe_fixture.competition_key is not None
                and universe_fixture.competition_key not in allowed_competitions
            ):
                raise ValueError("fixture competition is outside the capture universe")
            if universe_fixture.kickoff_at_utc is not None and not (
                self.capture_universe.date_from
                <= universe_fixture.kickoff_at_utc.date()
                <= self.capture_universe.date_to
            ):
                raise ValueError("fixture kickoff is outside the capture-universe date window")
        identity_groups = {
            "Forebet snapshot": [item.forebet_snapshot_id for item in self.forebet_snapshots],
            "odds snapshot": [item.odds_snapshot_id for item in self.odds_snapshots],
            "decision": [item.decision_id for item in self.decisions],
            "closing snapshot": [item.closing_snapshot_id for item in self.closing_snapshots],
            "outcome": [item.outcome_id for item in self.outcomes],
        }
        for label, identifiers in identity_groups.items():
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"{label} IDs must be unique")
        closing_ids = set(identity_groups["closing snapshot"])
        if closing_ids.intersection(identity_groups["odds snapshot"]):
            raise ValueError("closing and decision-time snapshot IDs must be disjoint")

        evidence = {
            item.artifact_reference: item.content_hash for item in self.evidence_manifest.items
        }
        evidence_backed = [
            (item.source_artifact_reference, item.content_hash)
            for group in (
                self.fixtures,
                self.forebet_snapshots,
                self.odds_snapshots,
                self.closing_snapshots,
                self.outcomes,
            )
            for item in group
        ]
        for reference, content_hash in evidence_backed:
            if evidence.get(reference) != content_hash:
                raise ValueError("content hash must match the referenced evidence artifact")

        for forebet_snapshot in self.forebet_snapshots:
            fixture = fixtures.get(forebet_snapshot.source_fixture_id)
            if fixture is None:
                raise ValueError("Forebet snapshot references unknown fixture")
            if (
                fixture.kickoff_at_utc is None
                or forebet_snapshot.captured_at_utc >= fixture.kickoff_at_utc
            ):
                raise ValueError("Forebet snapshot must be strictly before kickoff")

        odds = {item.odds_snapshot_id: item for item in self.odds_snapshots}
        for odds_snapshot in self.odds_snapshots:
            if odds_snapshot.bookmaker_key not in self.capture_universe.allowed_bookmakers:
                raise ValueError("odds bookmaker is outside the capture universe")
            if odds_snapshot.market_key not in self.capture_universe.required_markets:
                raise ValueError("odds market is outside the capture universe")
            fixture = fixtures.get(odds_snapshot.source_fixture_id)
            if fixture is None:
                raise ValueError("odds snapshot references unknown fixture")
            if (
                fixture.kickoff_at_utc is None
                or odds_snapshot.captured_at_utc >= fixture.kickoff_at_utc
            ):
                raise ValueError("odds snapshot must be strictly before kickoff")

        for decision in self.decisions:
            fixture = fixtures.get(decision.fixture_id)
            if fixture is None:
                raise ValueError("decision references unknown fixture")
            if fixture.kickoff_confidence not in {
                KickoffConfidence.CONFIRMED,
                KickoffConfidence.HIGH,
            }:
                raise ValueError("decision requires CONFIRMED or HIGH kickoff confidence")
            if fixture.fixture_status is not FixtureStatus.SCHEDULED:
                raise ValueError("decision requires a SCHEDULED fixture")
            if fixture.competition_key not in allowed_competitions:
                raise ValueError("decision fixture must belong to an allowed competition")
            if fixture.kickoff_at_utc is None or decision.decided_at_utc >= fixture.kickoff_at_utc:
                raise ValueError("decision must be strictly before kickoff")
            if decision.decision_status is DecisionStatus.SELECTED:
                selected_id = decision.selected_odds_snapshot_id
                if selected_id in closing_ids:
                    raise ValueError("closing snapshot cannot be used as a decision input")
                selected = odds.get(selected_id or "")
                if selected is None:
                    raise ValueError("SELECTED decision requires an existing exact odds snapshot")
                if selected.source_fixture_id != decision.fixture_id:
                    raise ValueError("selected odds must belong to the decision fixture")
                if selected.captured_at_utc > decision.decided_at_utc:
                    raise ValueError("selected odds must exist before or exactly at decision time")
                if (
                    selected.market_key is not decision.selected_market_key
                    or selected.selection_key is not decision.selected_selection_key
                ):
                    raise ValueError("selected market and selection must match exact odds snapshot")
                if decision.break_even_probability is not None and not math_isclose(
                    decision.break_even_probability, 1 / selected.decimal_odds
                ):
                    raise ValueError("break-even probability must equal 1 / decimal odds")

        for closing in self.closing_snapshots:
            if closing.bookmaker_key not in self.capture_universe.allowed_bookmakers:
                raise ValueError("closing bookmaker is outside the capture universe")
            if closing.market_key not in self.capture_universe.required_markets:
                raise ValueError("closing market is outside the capture universe")
            fixture = fixtures.get(closing.fixture_id)
            if fixture is None or fixture.kickoff_at_utc is None:
                raise ValueError("closing snapshot requires a known fixture kickoff")
            actual_seconds = int((fixture.kickoff_at_utc - closing.captured_at_utc).total_seconds())
            if actual_seconds <= 0 or abs(actual_seconds - closing.seconds_before_kickoff) > 1:
                raise ValueError("closing seconds_before_kickoff must match actual chronology")

        outcomes = {item.outcome_id: item for item in self.outcomes}
        superseded: set[str] = set()
        outcomes_by_fixture: dict[str, list[Outcome]] = {}
        for outcome in sorted(self.outcomes, key=lambda item: item.observed_at_utc):
            fixture = fixtures.get(outcome.fixture_id)
            if fixture is None or fixture.kickoff_at_utc is None:
                raise ValueError("outcome requires a known fixture kickoff")
            if outcome.observed_at_utc <= fixture.kickoff_at_utc:
                raise ValueError("outcome must be observed after kickoff")
            prior = outcomes_by_fixture.setdefault(outcome.fixture_id, [])
            if prior and outcome.supersedes_outcome_id is None:
                raise ValueError("later outcome versions must supersede a prior outcome")
            if outcome.supersedes_outcome_id is not None:
                previous = outcomes.get(outcome.supersedes_outcome_id)
                if previous is None or previous.fixture_id != outcome.fixture_id:
                    raise ValueError(
                        "outcome correction must reference a prior version of same fixture"
                    )
                if previous.observed_at_utc >= outcome.observed_at_utc:
                    raise ValueError("outcome correction must be observed after the prior version")
                if previous.outcome_id in superseded:
                    raise ValueError("an outcome version cannot be superseded twice")
                superseded.add(previous.outcome_id)
            prior.append(outcome)

        recorded_times = (
            [item.captured_at_utc for item in self.fixtures]
            + [item.captured_at_utc for item in self.forebet_snapshots]
            + [item.captured_at_utc for item in self.odds_snapshots]
            + [item.decided_at_utc for item in self.decisions]
            + [item.captured_at_utc for item in self.closing_snapshots]
            + [item.observed_at_utc for item in self.outcomes]
            + [item.captured_at_utc for item in self.evidence_manifest.items]
        )
        if any(recorded_at > self.generated_at_utc for recorded_at in recorded_times):
            raise ValueError("packet cannot be generated before any recorded observation")

        expected_hash = packet_payload_hash(self.model_dump(mode="python"))
        if self.packet_hash != expected_hash:
            raise ValueError("packet_hash is inconsistent with canonical packet content")
        return self


def math_isclose(left: float, right: float) -> bool:
    """Use a narrow deterministic tolerance for stored probability calculations."""

    return abs(left - right) <= 1e-9
