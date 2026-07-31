"""Structurally separated extraction profiles."""

from enum import StrEnum

from ou25_analytics.extraction.mappings import PREMATCH_MAPPINGS, TableMapping


class ExportProfile(StrEnum):
    """Supported analytical visibility boundaries."""

    PREMATCH = "prematch"
    EVALUATION = "evaluation"


def prematch_mappings() -> tuple[TableMapping, ...]:
    """Return mappings that cannot import or query post-match data."""

    return PREMATCH_MAPPINGS


def evaluation_mappings() -> tuple[TableMapping, ...]:
    """Add the evaluation-only mapping through an explicit separate import."""

    from ou25_analytics.extraction.outcome_mapping import EVALUATION_FIXTURES, OUTCOMES

    return (EVALUATION_FIXTURES, *PREMATCH_MAPPINGS[1:], OUTCOMES)


def mappings_for_profile(profile: ExportProfile) -> tuple[TableMapping, ...]:
    """Resolve only the fixed mapping set for a validated profile."""

    if profile is ExportProfile.PREMATCH:
        return prematch_mappings()
    if profile is ExportProfile.EVALUATION:
        return evaluation_mappings()
    raise ValueError(f"unsupported export profile: {profile}")
