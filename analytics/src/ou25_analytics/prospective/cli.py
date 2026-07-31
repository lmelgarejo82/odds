"""Synthetic-only CLI for prospective packet dry-runs."""

import argparse
import json
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ou25_analytics.prospective.contracts import ProspectiveCapturePacket
from ou25_analytics.prospective.synthetic import make_synthetic_packet_payload
from ou25_analytics.prospective.validation import PacketValidationSummary, validate_packet

MAX_PACKET_BYTES = 1024 * 1024


def _repository_test_fixture_root() -> Path:
    return Path(__file__).resolve().parents[3] / "tests" / "fixtures"


def _is_beneath(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _contains_url(value: object) -> bool:
    if isinstance(value, str):
        return value.lower().startswith(("http://", "https://"))
    if isinstance(value, dict):
        return any(_contains_url(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_url(item) for item in value)
    return False


def _assert_synthetic(packet: ProspectiveCapturePacket) -> None:
    if not packet.source_metadata.synthetic:
        raise ValueError("CLI accepts synthetic packets only")
    if not packet.packet_id.startswith("SYNTH_"):
        raise ValueError("synthetic packet_id must start with SYNTH_")
    for fixture in packet.fixtures:
        if not fixture.source_fixture_id.startswith("SYNTH_"):
            raise ValueError("synthetic fixture IDs must start with SYNTH_")
        if not all(
            value.startswith("Synthetic ")
            for value in (fixture.competition_raw, fixture.home_team_raw, fixture.away_team_raw)
        ):
            raise ValueError("synthetic sports labels must be explicit")
    if any(not item.bookmaker_key.startswith("SYNTH_") for item in packet.odds_snapshots):
        raise ValueError("synthetic bookmaker keys must start with SYNTH_")
    if any(
        not item.artifact_reference.startswith("synth:") for item in packet.evidence_manifest.items
    ):
        raise ValueError("synthetic evidence references must start with synth:")


def validate_packet_path(
    path_text: str, *, allowed_roots: tuple[Path, ...] | None = None
) -> tuple[ProspectiveCapturePacket, PacketValidationSummary]:
    """Validate one local synthetic JSON packet without modifying it."""

    if "://" in path_text:
        raise ValueError("URLs are not accepted")
    candidate = Path(path_text)
    if candidate.is_symlink():
        raise ValueError("packet path must not be a symlink")
    path = candidate.resolve(strict=True)
    roots = allowed_roots or (
        Path(tempfile.gettempdir()).resolve(),
        _repository_test_fixture_root(),
    )
    if not any(_is_beneath(path, root.resolve()) for root in roots):
        raise ValueError("packet path is outside synthetic temporary/test roots")
    if not path.is_file() or path.suffix.lower() != ".json":
        raise ValueError("packet must be a local JSON file")
    if path.stat().st_size > MAX_PACKET_BYTES:
        raise ValueError("packet exceeds synthetic dry-run size limit")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("packet root must be an object")
    if _contains_url(payload):
        raise ValueError("synthetic packets must not contain URLs")
    packet, summary = validate_packet(payload)
    _assert_synthetic(packet)
    return packet, summary


def _summary_json(summary: PacketValidationSummary) -> str:
    return json.dumps(summary.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)


def validate_main(argv: Sequence[str] | None = None) -> int:
    """Entry point for validate-prospective-packet."""

    parser = argparse.ArgumentParser(prog="validate-prospective-packet")
    parser.add_argument("path")
    arguments = parser.parse_args(argv)
    try:
        _, summary = validate_packet_path(arguments.path)
    except (OSError, ValueError, json.JSONDecodeError, ValidationError) as error:
        print(f"PROSPECTIVE_PACKET_INVALID: {error}", file=sys.stderr)
        return 2
    print(_summary_json(summary))
    print("SYNTHETIC_PROSPECTIVE_PACKET")
    print("NO_REAL_DATA")
    print("NO_REAL_PERFORMANCE_CLAIM")
    return 0


def prospective_packet_self_check() -> int:
    """Generate, validate, summarize and delete one synthetic R0 packet."""

    payload = make_synthetic_packet_payload()
    with tempfile.TemporaryDirectory(prefix="ou25-prospective-r0-") as temporary:
        path = Path(temporary) / "synthetic-prospective-packet.json"
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        packet, summary = validate_packet_path(str(path))
        selected = next(
            decision
            for decision in packet.decisions
            if decision.decision_status.value == "SELECTED"
        )
        abstained = next(
            decision
            for decision in packet.decisions
            if decision.decision_status.value == "ABSTAINED"
        )
        demonstration: dict[str, Any] = {
            "summary": summary.model_dump(mode="json"),
            "concordant_case": selected.reason_code == "SYNTH_CONCORDANT_CASE",
            "divergent_case": abstained.reason_code == "SYNTH_DIVERGENCE_REQUIRES_ABSTENTION",
            "double_chance_1x_decimal_odds": 1.60,
            "break_even_probability": selected.break_even_probability,
            "performance_claim": None,
        }
        print(json.dumps(demonstration, ensure_ascii=False, sort_keys=True))
        print("SYNTHETIC_PROSPECTIVE_PACKET")
        print("NO_REAL_DATA")
        print("NO_REAL_PERFORMANCE_CLAIM")
    return 0


def self_check_main(argv: Sequence[str] | None = None) -> int:
    """Console-script wrapper for the prospective packet self-check."""

    parser = argparse.ArgumentParser(prog="prospective-packet-self-check")
    parser.parse_args(argv)
    return prospective_packet_self_check()


if __name__ == "__main__":
    raise SystemExit(validate_main())
