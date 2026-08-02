import copy
import json
import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ou25_analytics.prospective.cli import validate_packet_path
from ou25_analytics.prospective.contracts import (
    SourceNeutralProspectiveCapturePacket,
    packet_payload_hash,
)
from ou25_analytics.prospective.synthetic import (
    make_source_neutral_synthetic_packet_payload,
    make_synthetic_packet_payload,
)
from ou25_analytics.prospective.validation import validate_packet


def rehash(payload: dict[str, Any]) -> dict[str, Any]:
    payload["packet_hash"] = packet_payload_hash(payload)
    return payload


def changed() -> dict[str, Any]:
    return copy.deepcopy(make_synthetic_packet_payload())


def source_neutral_changed() -> dict[str, Any]:
    return copy.deepcopy(make_source_neutral_synthetic_packet_payload())


def set_prediction_percentages(
    payload: dict[str, Any],
    values: tuple[tuple[str, str], tuple[str, str], tuple[str, str]],
    total: str,
) -> dict[str, Any]:
    snapshot = payload["prediction_snapshots"][0]
    for selection, (raw, normalized) in zip(snapshot["selections"], values, strict=True):
        selection["raw_percentage"] = raw
        selection["normalized_probability"] = normalized
    snapshot["probability_total_raw"] = total
    return rehash(payload)


def assert_invalid(payload: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        validate_packet(payload)


def test_valid_packet_is_deterministic_and_preserves_abstention() -> None:
    first = make_synthetic_packet_payload()
    second = make_synthetic_packet_payload()
    packet, summary = validate_packet(first)
    assert first == second
    assert first["packet_hash"] == second["packet_hash"]
    assert summary.decision_status_counts == {"ABSTAINED": 1, "SELECTED": 1}
    assert packet.decisions[0].break_even_probability == 0.625


def test_documented_json_example_matches_validated_factory() -> None:
    example_path = (
        Path(__file__).parents[2]
        / "docs"
        / "research"
        / "templates"
        / "prospective-capture-packet.example.json"
    )
    payload = json.loads(example_path.read_text(encoding="utf-8"))
    packet, summary = validate_packet(payload)
    assert payload == make_synthetic_packet_payload()
    assert packet.packet_hash == payload["packet_hash"]
    assert summary.fixture_count == 2


def test_invalid_probability_is_rejected() -> None:
    payload = changed()
    payload["forebet_snapshots"][0]["home_probability"] = 1.2
    assert_invalid(rehash(payload), "less than or equal to 1")


def test_invalid_probability_sum_is_rejected() -> None:
    payload = changed()
    payload["forebet_snapshots"][0].update(
        {"home_probability": 0.5, "draw_probability": 0.2, "away_probability": 0.2}
    )
    assert_invalid(rehash(payload), "must sum to 1")


def test_kickoff_without_utc_z_is_rejected() -> None:
    payload = changed()
    payload["fixtures"][0]["kickoff_at_utc"] = "2030-02-01T18:00:00+00:00"
    assert_invalid(rehash(payload), "explicit UTC Z")


def test_insufficient_kickoff_confidence_blocks_decision() -> None:
    payload = changed()
    payload["fixtures"][0]["kickoff_confidence"] = "MEDIUM"
    assert_invalid(rehash(payload), "requires CONFIRMED or HIGH")


def test_capture_universe_rejects_unlisted_competition() -> None:
    payload = changed()
    payload["fixtures"][0]["competition_key"] = "SYNTH_COMP_OUTSIDE"
    assert_invalid(rehash(payload), "competition is outside the capture universe")


def test_capture_universe_rejects_unlisted_bookmaker() -> None:
    payload = changed()
    payload["odds_snapshots"][0]["bookmaker_key"] = "SYNTH_BOOK_OUTSIDE"
    assert_invalid(rehash(payload), "bookmaker is outside the capture universe")


def test_capture_universe_rejects_kickoff_outside_date_window() -> None:
    payload = changed()
    payload["capture_universe"]["date_from"] = "2030-01-31"
    payload["capture_universe"]["date_to"] = "2030-01-31"
    assert_invalid(rehash(payload), "kickoff is outside the capture-universe date window")


def test_decision_requires_scheduled_fixture() -> None:
    payload = changed()
    payload["fixtures"][0]["fixture_status"] = "POSTPONED"
    assert_invalid(rehash(payload), "decision requires a SCHEDULED fixture")


def test_packet_cannot_predate_recorded_observation() -> None:
    payload = changed()
    payload["generated_at_utc"] = "2030-02-01T21:00:00.000Z"
    assert_invalid(rehash(payload), "cannot be generated before any recorded observation")


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("decimal_odds", 1.0, "greater than 1"),
        ("is_in_play", True, "in-play odds are not allowed"),
        ("market_status", "SUSPENDED", "must be ACTIVE"),
        ("selection_key", "UNKNOWN", "Input should be"),
    ],
)
def test_invalid_odds_are_rejected(field: str, value: object, message: str) -> None:
    payload = changed()
    payload["odds_snapshots"][0][field] = value
    assert_invalid(rehash(payload), message)


def test_forebet_after_kickoff_is_rejected() -> None:
    payload = changed()
    payload["forebet_snapshots"][0]["captured_at_utc"] = "2030-02-01T18:00:01.000Z"
    assert_invalid(rehash(payload), "Forebet snapshot must be strictly before kickoff")


def test_odds_after_kickoff_is_rejected() -> None:
    payload = changed()
    payload["odds_snapshots"][0]["captured_at_utc"] = "2030-02-01T18:00:01.000Z"
    assert_invalid(rehash(payload), "odds snapshot must be strictly before kickoff")


def test_decision_at_kickoff_is_rejected() -> None:
    payload = changed()
    payload["decisions"][0]["decided_at_utc"] = "2030-02-01T18:00:00.000Z"
    assert_invalid(rehash(payload), "decision must be strictly before kickoff")


def test_selected_without_exact_quote_is_rejected() -> None:
    payload = changed()
    payload["decisions"][0]["selected_odds_snapshot_id"] = None
    assert_invalid(rehash(payload), "SELECTED decision requires exact")


def test_quote_from_other_fixture_is_rejected() -> None:
    payload = changed()
    payload["decisions"][0].update(
        {
            "selected_odds_snapshot_id": "SYNTH_ODDS_B_AWAY",
            "selected_market_key": "MATCH_ODDS_1X2",
            "selected_selection_key": "AWAY",
            "break_even_probability": None,
        }
    )
    assert_invalid(rehash(payload), "selected odds must belong to the decision fixture")


def test_closing_snapshot_cannot_be_a_decision_input() -> None:
    payload = changed()
    payload["decisions"][0]["selected_odds_snapshot_id"] = "SYNTH_CLOSING_A_1X"
    assert_invalid(rehash(payload), "closing snapshot cannot be used")


def test_outcome_before_kickoff_is_rejected() -> None:
    payload = changed()
    payload["outcomes"][0]["observed_at_utc"] = "2030-02-01T17:59:59.000Z"
    assert_invalid(rehash(payload), "outcome must be observed after kickoff")


def test_invalid_outcome_correction_is_rejected() -> None:
    payload = changed()
    correction = copy.deepcopy(payload["outcomes"][0])
    correction.update(
        {
            "outcome_id": "SYNTH_OUTCOME_A_V2",
            "observed_at_utc": "2030-02-02T02:00:00.000Z",
            "outcome_status": "CORRECTED",
            "supersedes_outcome_id": "SYNTH_MISSING_OUTCOME",
        }
    )
    payload["outcomes"].append(correction)
    assert_invalid(rehash(payload), "must reference a prior version")


def test_duplicate_ids_are_rejected() -> None:
    payload = changed()
    payload["odds_snapshots"].append(copy.deepcopy(payload["odds_snapshots"][0]))
    assert_invalid(rehash(payload), "odds snapshot IDs must be unique")


def test_inconsistent_packet_hash_is_rejected() -> None:
    payload = changed()
    payload["generated_at_utc"] = "2030-02-02T01:00:01.000Z"
    assert_invalid(payload, "packet_hash is inconsistent")


def test_dry_run_does_not_write_databases_or_modify_packet(tmp_path: Path) -> None:
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(make_synthetic_packet_payload()), encoding="utf-8")
    before = packet_path.read_bytes()
    before_files = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*"))
    _, summary = validate_packet_path(str(packet_path), allowed_roots=(tmp_path,))
    after_files = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*"))
    assert summary.synthetic
    assert packet_path.read_bytes() == before
    assert before_files == after_files
    assert not list(tmp_path.rglob("*.db"))
    assert not list(tmp_path.rglob("*.sqlite*"))


def test_cli_self_check_cleans_temporaries(tmp_path: Path) -> None:
    temporary_root = tmp_path / "cli-temporary"
    temporary_root.mkdir()
    environment = {**os.environ, "TMPDIR": str(temporary_root)}
    result = subprocess.run(
        [sys.executable, "-m", "ou25_analytics.cli", "prospective-packet-self-check"],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "SYNTHETIC_PROSPECTIVE_PACKET" in result.stdout
    assert "NO_REAL_DATA" in result.stdout
    assert "NO_REAL_PERFORMANCE_CLAIM" in result.stdout
    assert '"break_even_probability": 0.625' in result.stdout
    assert list(temporary_root.iterdir()) == []


def test_prospective_modules_have_no_legacy_or_network_access() -> None:
    root = Path(__file__).parents[1] / "src" / "ou25_analytics" / "prospective"
    source = "\n".join(path.read_text(encoding="utf-8") for path in root.glob("*.py"))
    forbidden = ("ou25-consensus-lab", "prisma/dev.db", "sqlite3", "requests.", "httpx.")
    assert all(term not in source for term in forbidden)


def test_cli_rejects_urls_and_paths_outside_synthetic_roots() -> None:
    with pytest.raises(ValueError, match="URLs are not accepted"):
        validate_packet_path("https://invalid.example/packet.json")
    example_path = (
        Path(__file__).parents[2]
        / "docs"
        / "research"
        / "templates"
        / "prospective-capture-packet.example.json"
    )
    with pytest.raises(ValueError, match="outside synthetic"):
        validate_packet_path(str(example_path))


def test_synthetic_factory_contains_no_real_sports_data() -> None:
    payload = make_synthetic_packet_payload()
    assert payload["source_metadata"]["synthetic"] is True
    assert all(item["source_fixture_id"].startswith("SYNTH_") for item in payload["fixtures"])
    assert all(item["competition_raw"].startswith("Synthetic ") for item in payload["fixtures"])
    assert all(item["home_team_raw"].startswith("Synthetic ") for item in payload["fixtures"])
    assert all(item["away_team_raw"].startswith("Synthetic ") for item in payload["fixtures"])


def test_source_neutral_01_accepts_valid_packet() -> None:
    packet, summary = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert summary.prediction_snapshot_count == 1


def test_source_neutral_02_preserves_provider_key() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.prediction_snapshots[0].provider_key == "synthetic-prediction-provider"


def test_source_neutral_03_preserves_external_provider_fixture_id() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.prediction_snapshots[0].provider_fixture_id == "SYNTH_EXTERNAL_FIXTURE_A"


def test_source_neutral_04_preserves_captured_at_utc() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.prediction_snapshots[0].captured_at_utc.isoformat().startswith(
        "2030-02-01T17:00:00"
    )


def test_source_neutral_05_preserves_three_selections() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert [item.selection.value for item in packet.prediction_snapshots[0].selections] == [
        "HOME",
        "DRAW",
        "AWAY",
    ]


def test_source_neutral_06_uses_decimal() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert all(
        isinstance(item.normalized_probability, Decimal)
        for item in packet.prediction_snapshots[0].selections
    )


def test_source_neutral_07_rejects_float_contract_input() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"][0]["normalized_probability"] = 0.45
    assert_invalid(rehash(payload), "plain decimal string")


def test_source_neutral_08_preserves_raw_percentage() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert [item.raw_percentage for item in packet.prediction_snapshots[0].selections] == [
        "45%",
        "30%",
        "25%",
    ]


def test_source_neutral_09_preserves_exact_normalized_probability() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    serialized = packet.model_dump(mode="json")["prediction_snapshots"][0]["selections"]
    assert [item["normalized_probability"] for item in serialized] == ["0.45", "0.3", "0.25"]


def test_source_neutral_10_accepts_exact_100_sum() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.prediction_snapshots[0].probability_total_raw == "100%"


def test_source_neutral_11_accepts_lower_sum_boundary() -> None:
    payload = set_prediction_percentages(
        source_neutral_changed(),
        (("40%", "0.4"), ("30%", "0.3"), ("29.99%", "0.2999")),
        "99.99%",
    )
    validate_packet(payload)


def test_source_neutral_12_accepts_upper_sum_boundary() -> None:
    payload = set_prediction_percentages(
        source_neutral_changed(),
        (("40%", "0.4"), ("30%", "0.3"), ("30.01%", "0.3001")),
        "100.01%",
    )
    validate_packet(payload)


def test_source_neutral_13_rejects_below_sum_boundary() -> None:
    payload = set_prediction_percentages(
        source_neutral_changed(),
        (("40%", "0.4"), ("30%", "0.3"), ("29.98%", "0.2998")),
        "99.98%",
    )
    assert_invalid(payload, "outside 99.99 to 100.01")


def test_source_neutral_14_rejects_above_sum_boundary() -> None:
    payload = set_prediction_percentages(
        source_neutral_changed(),
        (("40%", "0.4"), ("30%", "0.3"), ("30.02%", "0.3002")),
        "100.02%",
    )
    assert_invalid(payload, "outside 99.99 to 100.01")


def test_source_neutral_15_rejects_duplicate_selection() -> None:
    payload = source_neutral_changed()
    selections = payload["prediction_snapshots"][0]["selections"]
    selections[1] = copy.deepcopy(selections[0])
    assert_invalid(rehash(payload), "canonical HOME DRAW AWAY")


def test_source_neutral_16_rejects_missing_selection() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"].pop()
    assert_invalid(rehash(payload), "at least 3")


def test_source_neutral_17_rejects_additional_selection() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"].append(
        {"selection": "HOME", "raw_percentage": "0%", "normalized_probability": "0"}
    )
    assert_invalid(rehash(payload), "at most 3")


def test_source_neutral_18_rejects_invalid_raw_percentage() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"][0]["raw_percentage"] = "45"
    assert_invalid(rehash(payload), "String should match pattern")


def test_source_neutral_19_rejects_decimal_out_of_range() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"][0]["normalized_probability"] = "1.1"
    assert_invalid(rehash(payload), "plain decimal string")


def test_source_neutral_20_rejects_scientific_notation() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"][0]["normalized_probability"] = "4.5e-1"
    assert_invalid(rehash(payload), "plain decimal string")


@pytest.mark.parametrize("value", ["NaN", "nan"])
def test_source_neutral_21_rejects_nan(value: str) -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"][0]["normalized_probability"] = value
    assert_invalid(rehash(payload), "plain decimal string")


@pytest.mark.parametrize("value", ["Infinity", "-Infinity"])
def test_source_neutral_22_rejects_infinity(value: str) -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["selections"][0]["normalized_probability"] = value
    assert_invalid(rehash(payload), "plain decimal string")


def test_source_neutral_23_rejects_invalid_captured_at() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["captured_at_utc"] = "invalid"
    assert_invalid(rehash(payload), "explicit UTC Z")


def test_source_neutral_24_rejects_captured_at_kickoff() -> None:
    payload = source_neutral_changed()
    snapshot = payload["prediction_snapshots"][0]
    snapshot["captured_at_utc"] = snapshot["kickoff_at_utc"]
    snapshot["prediction_captured_before_kickoff"] = False
    assert_invalid(rehash(payload), "strictly before kickoff")


def test_source_neutral_25_rejects_captured_after_kickoff() -> None:
    payload = source_neutral_changed()
    snapshot = payload["prediction_snapshots"][0]
    snapshot["captured_at_utc"] = "2030-02-01T18:00:00.001Z"
    snapshot["prediction_captured_before_kickoff"] = False
    assert_invalid(rehash(payload), "strictly before kickoff")


def test_source_neutral_26_rejects_contradictory_prematch_boolean() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["prediction_captured_before_kickoff"] = False
    assert_invalid(rehash(payload), "contradicts chronology")


def test_source_neutral_27_accepts_null_provider_internal_timestamp() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.prediction_snapshots[0].provider_internal_timestamp is None


def test_source_neutral_28_provider_timestamp_does_not_control_chronology() -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0]["provider_internal_timestamp"] = "2999-01-01T00:00:00Z"
    packet, _ = validate_packet(rehash(payload))
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)


def test_source_neutral_29_preserves_winner_metadata() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    prediction = packet.prediction_snapshots[0]
    assert prediction.predicted_winner_provider_team_id == "SYNTH_TEAM_HOME_A"
    assert prediction.winner_comment == "Synthetic winner metadata"


def test_source_neutral_30_preserves_advice_without_double_chance() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    prediction = packet.prediction_snapshots[0]
    assert prediction.advice == "Synthetic advice metadata only"
    assert [item.selection.value for item in prediction.selections] == ["HOME", "DRAW", "AWAY"]


def test_source_neutral_31_preserves_under_over_as_metadata() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.prediction_snapshots[0].under_over_raw == "Synthetic under-over metadata only"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("outcome", "HOME"),
        ("result1X2", "HOME"),
        ("score", {"fulltime": {"home": 1, "away": 0}}),
        ("settlement", {"status": "WIN"}),
    ],
)
def test_source_neutral_32_to_35_rejects_postmatch_fields(field: str, value: object) -> None:
    payload = source_neutral_changed()
    payload["prediction_snapshots"][0][field] = value
    assert_invalid(rehash(payload), "Extra inputs are not permitted")


def test_source_neutral_36_synthetic_packet_validates() -> None:
    packet, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    assert isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert packet.source_metadata.synthetic
    assert packet.outcomes == []


def test_source_neutral_37_serialization_and_parse_are_deterministic() -> None:
    first, _ = validate_packet(make_source_neutral_synthetic_packet_payload())
    serialized = first.model_dump(mode="json")
    reparsed, _ = validate_packet(rehash(serialized))
    assert reparsed.model_dump(mode="json") == serialized


def test_source_neutral_38_historical_packet_still_validates() -> None:
    packet, summary = validate_packet(make_synthetic_packet_payload())
    assert not isinstance(packet, SourceNeutralProspectiveCapturePacket)
    assert summary.prediction_snapshot_count == 0


def test_source_neutral_39_wrong_schema_version_is_rejected() -> None:
    payload = source_neutral_changed()
    payload["packet_schema_version"] = "3"
    assert_invalid(rehash(payload), "Input should be '2'")


def test_source_neutral_40_errors_hide_complete_packet() -> None:
    payload = source_neutral_changed()
    payload["packet_schema_version"] = "invalid"
    with pytest.raises(ValidationError) as captured:
        validate_packet(rehash(payload))
    message = str(captured.value)
    assert payload["packet_id"] not in message
    assert "input_value" not in message
