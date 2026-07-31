"""Pydantic contract for immutable analytical snapshot manifests."""

from datetime import datetime, timedelta
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


def require_utc(value: datetime, field_name: str) -> datetime:
    """Reject naive or non-UTC datetimes without consulting a clock."""

    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ValueError(f"{field_name} must be timezone-aware UTC")
    return value


class DateRange(BaseModel):
    """Observed timestamp bounds for one table."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    minimum_at_utc: datetime | None
    maximum_at_utc: datetime | None

    @model_validator(mode="after")
    def validate_range(self) -> Self:
        if self.minimum_at_utc is not None:
            require_utc(self.minimum_at_utc, "minimum_at_utc")
        if self.maximum_at_utc is not None:
            require_utc(self.maximum_at_utc, "maximum_at_utc")
        if (
            self.minimum_at_utc is not None
            and self.maximum_at_utc is not None
            and self.minimum_at_utc > self.maximum_at_utc
        ):
            raise ValueError("minimum_at_utc must not exceed maximum_at_utc")
        return self


class SnapshotManifest(BaseModel):
    """Complete reproducibility metadata for one published snapshot."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    schema_version: str = Field(min_length=1)
    created_at_utc: datetime
    cutoff_at_utc: datetime
    source_kind: str = Field(min_length=1)
    source_reference: str = Field(min_length=1)
    source_database_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    source_git_commit: str = Field(min_length=1)
    analytics_git_commit: str = Field(min_length=1)
    analytics_lock_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    synthetic: bool
    tables: list[str]
    row_counts: dict[str, int]
    date_ranges: dict[str, DateRange]
    parquet_files: dict[str, str]
    parquet_sha256: dict[str, str]
    quality_report_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    excluded_rows: dict[str, int]
    notes: list[str]

    @model_validator(mode="after")
    def validate_manifest(self) -> Self:
        require_utc(self.created_at_utc, "created_at_utc")
        require_utc(self.cutoff_at_utc, "cutoff_at_utc")
        if self.created_at_utc < self.cutoff_at_utc:
            raise ValueError("created_at_utc must be at or after cutoff_at_utc")
        table_set = set(self.tables)
        if len(table_set) != len(self.tables):
            raise ValueError("tables must not contain duplicates")
        mapping_key_sets: dict[str, set[str]] = {
            "row_counts": set(self.row_counts),
            "date_ranges": set(self.date_ranges),
            "parquet_files": set(self.parquet_files),
            "parquet_sha256": set(self.parquet_sha256),
            "excluded_rows": set(self.excluded_rows),
        }
        for mapping_name, mapping_keys in mapping_key_sets.items():
            if mapping_keys != table_set:
                raise ValueError(f"{mapping_name} keys must equal tables")
        if any(count < 0 for count in self.row_counts.values()):
            raise ValueError("row counts must be non-negative")
        if any(count < 0 for count in self.excluded_rows.values()):
            raise ValueError("excluded row counts must be non-negative")
        if any(
            len(value) != 64 or any(character not in "0123456789abcdef" for character in value)
            for value in self.parquet_sha256.values()
        ):
            raise ValueError("every parquet SHA-256 must have 64 lowercase hex characters")
        return self
