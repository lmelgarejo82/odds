from datetime import UTC, datetime

import pandas as pd
import pytest
from pydantic import ValidationError

from ou25_analytics.contracts.manifest import DateRange, SnapshotManifest
from ou25_analytics.contracts.schemas import (
    CONTRACTS,
    ContractError,
    validate_all_tables,
    validate_dataframe,
)
from ou25_analytics.synthetic.factory import make_invalid_copy


def test_all_canonical_tables_validate_with_arrow_types(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    arrow_tables = validate_all_tables(synthetic_tables)
    assert set(arrow_tables) == set(CONTRACTS)
    assert (
        str(arrow_tables["fixtures"].schema.field("kickoff_at_utc").type) == "timestamp[us, tz=UTC]"
    )


def test_contract_metadata_documents_keys_nullability_and_boundaries() -> None:
    decisions = CONTRACTS["prematch_decisions"]
    outcomes = CONTRACTS["outcomes"]
    assert decisions.primary_key == ("decision_id",)
    assert decisions.schema.field("selected_odds_snapshot_id").nullable
    assert decisions.decision_allowed
    assert not outcomes.decision_allowed
    assert outcomes.evaluation_only


def test_missing_critical_column_is_rejected(synthetic_tables: dict[str, pd.DataFrame]) -> None:
    fixtures = synthetic_tables["fixtures"].drop(columns="competition_key")
    with pytest.raises(ContractError, match="missing critical columns"):
        validate_dataframe("fixtures", fixtures)


def test_unknown_or_incomplete_table_set_is_rejected(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    with pytest.raises(ContractError, match="unknown analytical table"):
        validate_dataframe("unknown", pd.DataFrame())
    incomplete = {name: frame for name, frame in synthetic_tables.items() if name != "outcomes"}
    with pytest.raises(ContractError, match="table set mismatch"):
        validate_all_tables(incomplete)


def test_naive_timestamps_and_invalid_probabilities_are_rejected(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    naive = make_invalid_copy(synthetic_tables, "naive_timestamp")
    with pytest.raises(ContractError, match="timezone-aware UTC"):
        validate_dataframe("odds_snapshots", naive["odds_snapshots"])
    invalid_probability = make_invalid_copy(synthetic_tables, "probability_out_of_range")
    with pytest.raises(ContractError, match="outside"):
        validate_dataframe("forebet_snapshots", invalid_probability["forebet_snapshots"])


def test_manifest_requires_utc_and_matching_table_mappings() -> None:
    timestamp = datetime(2030, 2, 1, tzinfo=UTC)
    table = "fixtures"
    payload = {
        "snapshot_id": "SYNTH_MANIFEST",
        "schema_version": "1",
        "created_at_utc": timestamp,
        "cutoff_at_utc": timestamp,
        "source_kind": "SYNTHETIC",
        "source_reference": "seed:1",
        "source_database_sha256": None,
        "source_git_commit": "SOURCE",
        "analytics_git_commit": "ANALYTICS",
        "analytics_lock_sha256": "a" * 64,
        "synthetic": True,
        "tables": [table],
        "row_counts": {table: 1},
        "date_ranges": {table: DateRange(minimum_at_utc=timestamp, maximum_at_utc=timestamp)},
        "parquet_files": {table: "fixtures.parquet"},
        "parquet_sha256": {table: "b" * 64},
        "quality_report_sha256": "c" * 64,
        "excluded_rows": {table: 0},
        "notes": [],
    }
    assert SnapshotManifest.model_validate(payload).synthetic
    with pytest.raises(ValidationError, match="timezone-aware UTC"):
        SnapshotManifest.model_validate(
            {**payload, "created_at_utc": timestamp.replace(tzinfo=None)}
        )
    with pytest.raises(ValidationError, match="keys must equal tables"):
        SnapshotManifest.model_validate({**payload, "row_counts": {}})


def test_date_range_rejects_reverse_bounds() -> None:
    with pytest.raises(ValidationError, match="must not exceed"):
        DateRange(
            minimum_at_utc=datetime(2030, 1, 2, tzinfo=UTC),
            maximum_at_utc=datetime(2030, 1, 1, tzinfo=UTC),
        )
