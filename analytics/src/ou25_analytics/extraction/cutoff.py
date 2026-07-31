"""Strict UTC cutoff parsing and microsecond availability semantics."""

import re
from datetime import UTC, datetime

from ou25_analytics.contracts.manifest import require_utc

_UTC_Z_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


class CutoffError(ValueError):
    """Raised when a cutoff or source timestamp is not normalized UTC."""


def parse_utc_z(value: str, *, field_name: str) -> datetime:
    """Parse an ISO timestamp that explicitly uses the UTC ``Z`` suffix."""

    if not _UTC_Z_PATTERN.fullmatch(value):
        raise CutoffError(f"{field_name} must be normalized UTC ending in Z")
    try:
        parsed = datetime.fromisoformat(f"{value[:-1]}+00:00")
    except ValueError as error:
        raise CutoffError(f"{field_name} is not a valid UTC timestamp") from error
    return require_utc(parsed, field_name)


def parse_cutoff_z(value: str) -> datetime:
    """Parse the mandatory CLI cutoff policy."""

    return parse_utc_z(value, field_name="cutoff_at_utc")


def datetime_to_epoch_micros(value: datetime, *, field_name: str) -> int:
    """Convert aware UTC to an exact integer offset without float rounding."""

    normalized = require_utc(value, field_name)
    delta = normalized - _EPOCH
    return ((delta.days * 86_400 + delta.seconds) * 1_000_000) + delta.microseconds


def source_timestamp_to_epoch_micros(value: object) -> int:
    """SQLite scalar used by fixed mappings for exact availability filtering."""

    if not isinstance(value, str):
        raise CutoffError("source timestamp must be text ending in Z")
    parsed = parse_utc_z(value, field_name="source timestamp")
    return datetime_to_epoch_micros(parsed, field_name="source timestamp")
