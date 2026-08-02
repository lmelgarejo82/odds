"""Pure packet validation and compact summaries."""

from collections import Counter

from pydantic import BaseModel, ConfigDict

from ou25_analytics.prospective.contracts import (
    DecisionStatus,
    ProspectiveCapturePacket,
    SourceNeutralProspectiveCapturePacket,
)


class PacketValidationSummary(BaseModel):
    """Aggregate-only result returned by a prospective packet dry-run."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    packet_id: str
    synthetic: bool
    fixture_count: int
    forebet_snapshot_count: int
    odds_snapshot_count: int
    decision_count: int
    closing_snapshot_count: int
    outcome_count: int
    prediction_snapshot_count: int
    decision_status_counts: dict[str, int]
    warnings: list[str]


def validate_packet(
    payload: dict[str, object],
) -> tuple[ProspectiveCapturePacket, PacketValidationSummary]:
    """Validate a packet without persistence, network access, or mutable state."""

    source_neutral = "packet_schema_version" in payload or "prediction_snapshots" in payload
    packet: ProspectiveCapturePacket = (
        SourceNeutralProspectiveCapturePacket.model_validate(payload)
        if source_neutral
        else ProspectiveCapturePacket.model_validate(payload)
    )
    status_counts = Counter(decision.decision_status.value for decision in packet.decisions)
    warnings: list[str] = []
    if not packet.odds_snapshots:
        warnings.append("PACKET_HAS_NO_DECISION_TIME_ODDS")
    if not packet.decisions:
        warnings.append("PACKET_HAS_NO_DECISIONS")
    if (
        all(
            decision.decision_status is not DecisionStatus.SELECTED for decision in packet.decisions
        )
        and packet.decisions
    ):
        warnings.append("PACKET_HAS_NO_SELECTED_DECISION")
    return packet, PacketValidationSummary(
        packet_id=packet.packet_id,
        synthetic=packet.source_metadata.synthetic,
        fixture_count=len(packet.fixtures),
        forebet_snapshot_count=len(packet.forebet_snapshots),
        odds_snapshot_count=len(packet.odds_snapshots),
        decision_count=len(packet.decisions),
        closing_snapshot_count=len(packet.closing_snapshots),
        outcome_count=len(packet.outcomes),
        prediction_snapshot_count=len(getattr(packet, "prediction_snapshots", [])),
        decision_status_counts=dict(sorted(status_counts.items())),
        warnings=warnings,
    )
