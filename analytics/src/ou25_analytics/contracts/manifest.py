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


class ExclusionCounts(BaseModel):
    """Auditable source-to-snapshot row accounting for one table."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source_total_rows: int = Field(ge=0)
    eligible_rows_at_cutoff: int = Field(ge=0)
    exported_rows: int = Field(ge=0)
    excluded_after_cutoff: int = Field(ge=0)
    excluded_invalid: int = Field(ge=0)
    excluded_unreferenced: int = Field(ge=0)
    excluded_other: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_accounting(self) -> Self:
        excluded = (
            self.excluded_after_cutoff
            + self.excluded_invalid
            + self.excluded_unreferenced
            + self.excluded_other
        )
        if self.exported_rows + excluded != self.source_total_rows:
            raise ValueError("source row accounting must balance")
        if self.exported_rows != self.eligible_rows_at_cutoff - self.excluded_invalid:
            raise ValueError("eligible/exported row accounting must balance")
        return self


class SQLiteExtractionMetadata(BaseModel):
    """Frozen SQLite provenance recorded by the read-only exporter."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source_database_byte_size: int = Field(ge=0)
    source_database_mtime_ns: int = Field(ge=0)
    sqlite_user_version: int = Field(ge=0)
    sqlite_schema_version: int = Field(ge=0)
    sqlite_schema_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    export_profile: str = Field(pattern=r"^(prematch|evaluation)$")
    transaction_mode: str = "READ_ONLY_DEFERRED"
    source_open_mode: str = "mode=ro&immutable=1"
    cutoff_semantics_version: str = "availability-v1"
    query_mapping_version: str = "market-v2-sqlite-v1"
    source_hash_verified_after_export: bool
    excluded_rows_by_table: dict[str, ExclusionCounts]
    exclusion_reasons_by_table: dict[str, dict[str, int]]

    @model_validator(mode="after")
    def validate_exclusions(self) -> Self:
        if set(self.excluded_rows_by_table) != set(self.exclusion_reasons_by_table):
            raise ValueError("exclusion metadata table keys must match")
        for reasons in self.exclusion_reasons_by_table.values():
            if any(count < 0 for count in reasons.values()):
                raise ValueError("exclusion reason counts must be non-negative")
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
    sqlite_extraction: SQLiteExtractionMetadata | None = None
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
        if self.sqlite_extraction is not None:
            extraction_keys = set(self.sqlite_extraction.excluded_rows_by_table)
            if extraction_keys != table_set:
                raise ValueError("sqlite extraction table keys must equal tables")
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
