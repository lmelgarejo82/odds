"""Minimal synthetic-only command-line self-check."""

import argparse
import hashlib
import json
import tempfile
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

from ou25_analytics.backtesting.metrics import binary_brier_score, flat_stake_profit, roi
from ou25_analytics.extraction.cutoff import parse_cutoff_z
from ou25_analytics.extraction.exporter import export_sqlite_snapshot
from ou25_analytics.extraction.profiles import ExportProfile
from ou25_analytics.extraction.synthetic_sqlite import create_synthetic_sqlite
from ou25_analytics.features.prematch import build_prematch_features
from ou25_analytics.prospective.cli import (
    prospective_packet_self_check,
    validate_packet_path,
)
from ou25_analytics.snapshot.duckdb_views import DuckDBSnapshotViews
from ou25_analytics.snapshot.reader import read_snapshot
from ou25_analytics.snapshot.writer import write_snapshot
from ou25_analytics.splitting.walk_forward import walk_forward_splits
from ou25_analytics.synthetic.factory import make_synthetic_tables


def _lock_sha256() -> str:
    lock_path = Path(__file__).resolve().parents[2] / "uv.lock"
    return hashlib.sha256(lock_path.read_bytes()).hexdigest()


def self_check() -> int:
    """Exercise the full foundation using synthetic data and disposable outputs."""

    tables = make_synthetic_tables(seed=20260731)
    cutoff = tables["outcomes"]["observed_at_utc"].max().to_pydatetime()
    created = (tables["outcomes"]["observed_at_utc"].max() + pd.Timedelta(hours=1)).to_pydatetime()
    with tempfile.TemporaryDirectory(prefix="ou25-analytics-self-check-") as temporary:
        snapshot = write_snapshot(
            Path(temporary) / "snapshots",
            tables,
            snapshot_id="SYNTHETIC_SELF_CHECK",
            created_at_utc=created,
            cutoff_at_utc=cutoff,
            source_kind="SYNTHETIC_FACTORY",
            source_reference="seed:20260731",
            source_database_sha256=None,
            source_git_commit="SYNTHETIC_SOURCE",
            analytics_git_commit="WORKTREE_SELF_CHECK",
            analytics_lock_sha256=_lock_sha256(),
            synthetic=True,
            notes=["Synthetic self-check only"],
        )
        manifest, loaded = read_snapshot(snapshot)
        with DuckDBSnapshotViews() as views:
            views.register_snapshot(snapshot)
            count_row = views.connection.execute(
                "SELECT count(*) FROM prematch_fixtures"
            ).fetchone()
            if count_row is None:
                raise RuntimeError("DuckDB self-check did not return a fixture count")
            fixture_count = count_row[0]
        features = build_prematch_features(
            loaded["fixtures"],
            loaded["forebet_snapshots"],
            loaded["odds_snapshots"],
            loaded["market_probabilities"],
            loaded["prematch_decisions"],
        )
        folds = walk_forward_splits(
            loaded["fixtures"],
            train_window=pd.Timedelta(days=8),
            validation_window=pd.Timedelta(days=4),
            gap=pd.Timedelta(days=1),
            step=pd.Timedelta(days=4),
        )
        brier = binary_brier_score([0.7, 0.4, 0.8], [1, 0, 1])
        profits = flat_stake_profit([1.8, 2.2, 1.7], [1, 0, 1])
        summary = {
            "snapshot_id": manifest.snapshot_id,
            "fixture_rows": int(fixture_count),
            "feature_rows": len(features),
            "folds": len(folds),
            "synthetic_brier": round(brier, 6),
            "synthetic_roi": round(roi(profits), 6),
        }
        print(json.dumps(summary, sort_keys=True))
        print("SYNTHETIC_DATA_ONLY")
        print("NO_REAL_PERFORMANCE_CLAIM")
    return 0


def export_synthetic_sqlite(profile: ExportProfile, cutoff_text: str) -> int:
    """Create, export and delete one explicitly synthetic frozen SQLite source."""

    cutoff = parse_cutoff_z(cutoff_text)
    with tempfile.TemporaryDirectory(prefix="ou25-analytics-synthetic-sqlite-") as temporary:
        temporary_root = Path(temporary)
        source_root = temporary_root / "source"
        source = create_synthetic_sqlite(source_root, seed=20260731)
        result = export_sqlite_snapshot(
            temporary_root / "snapshots",
            source_database_path=source,
            allowed_source_root=source_root,
            profile=profile,
            snapshot_id=f"SYNTHETIC_SQLITE_{profile.value.upper()}",
            created_at_utc=cutoff + pd.Timedelta(hours=1),
            cutoff_at_utc=cutoff,
            source_kind="SYNTHETIC_SQLITE",
            source_reference="synthetic:seed:20260731",
            source_git_commit="SYNTHETIC_SOURCE",
            analytics_git_commit="WORKTREE_SYNTHETIC_EXPORT",
            analytics_lock_sha256=_lock_sha256(),
            synthetic=True,
        )
        print(
            json.dumps(
                {
                    "excluded_rows": result.manifest.excluded_rows,
                    "profile": profile.value,
                    "row_counts": result.manifest.row_counts,
                    "snapshot_id": result.manifest.snapshot_id,
                },
                sort_keys=True,
            )
        )
        print("SYNTHETIC_SOURCE_ONLY")
        print("READ_ONLY_SQLITE")
        print("NO_LEGACY_DATABASE_ACCESSED")
        print("NO_REAL_PERFORMANCE_CLAIM")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Dispatch the supported CLI command."""

    parser = argparse.ArgumentParser(prog="ou25-analytics")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("self-check", help="run a disposable synthetic end-to-end check")
    export_parser = subparsers.add_parser(
        "export-synthetic-sqlite", help="export a disposable frozen synthetic SQLite source"
    )
    export_parser.add_argument(
        "--profile", choices=[profile.value for profile in ExportProfile], required=True
    )
    export_parser.add_argument("--cutoff", required=True)
    prospective_parser = subparsers.add_parser(
        "validate-prospective-packet",
        help="validate one local synthetic prospective R0 packet",
    )
    prospective_parser.add_argument("path")
    subparsers.add_parser(
        "prospective-packet-self-check",
        help="generate and validate one disposable synthetic R0 packet",
    )
    arguments = parser.parse_args(argv)
    if arguments.command == "self-check":
        return self_check()
    if arguments.command == "export-synthetic-sqlite":
        return export_synthetic_sqlite(ExportProfile(arguments.profile), arguments.cutoff)
    if arguments.command == "validate-prospective-packet":
        _, summary = validate_packet_path(arguments.path)
        print(json.dumps(summary.model_dump(mode="json"), sort_keys=True))
        print("SYNTHETIC_PROSPECTIVE_PACKET")
        print("NO_REAL_DATA")
        print("NO_REAL_PERFORMANCE_CLAIM")
        return 0
    if arguments.command == "prospective-packet-self-check":
        return prospective_packet_self_check()
    raise AssertionError("unreachable command")


if __name__ == "__main__":
    raise SystemExit(main())
