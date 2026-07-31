"""Deterministic walk-forward partitions without random shuffling."""

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class WalkForwardFold:
    """Indices and temporal metadata for one validation fold."""

    fold_id: int
    train_indices: tuple[int, ...]
    validation_indices: tuple[int, ...]
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    validation_start: pd.Timestamp
    validation_end: pd.Timestamp
    gap: pd.Timedelta


def walk_forward_splits(
    fixtures: pd.DataFrame,
    *,
    train_window: pd.Timedelta,
    validation_window: pd.Timedelta,
    gap: pd.Timedelta | None = None,
    step: pd.Timedelta | None = None,
    expanding: bool = False,
    min_train_fixtures: int = 1,
) -> list[WalkForwardFold]:
    """Create strict temporal folds using half-open time windows."""

    required = {"fixture_id", "kickoff_at_utc"}
    missing = required.difference(fixtures.columns)
    if missing:
        raise ValueError(f"fixtures missing columns: {sorted(missing)}")
    if fixtures.empty:
        raise ValueError("fixtures must not be empty")
    if fixtures["fixture_id"].duplicated().any():
        raise ValueError("a fixture must appear only once in the split input")
    kickoff_dtype = fixtures["kickoff_at_utc"].dtype
    if not isinstance(kickoff_dtype, pd.DatetimeTZDtype) or str(kickoff_dtype.tz) != "UTC":
        raise ValueError("kickoff_at_utc must be timezone-aware UTC")
    if train_window <= pd.Timedelta(0) or validation_window <= pd.Timedelta(0):
        raise ValueError("train and validation windows must be positive")
    effective_gap = gap if gap is not None else pd.Timedelta(0)
    if effective_gap < pd.Timedelta(0):
        raise ValueError("gap must be non-negative")
    effective_step = step or validation_window
    if effective_step <= pd.Timedelta(0):
        raise ValueError("step must be positive")
    if min_train_fixtures < 1:
        raise ValueError("min_train_fixtures must be positive")

    ordered = fixtures.sort_values(["kickoff_at_utc", "fixture_id"], kind="mergesort")
    first_kickoff = pd.Timestamp(ordered["kickoff_at_utc"].min())
    last_kickoff = pd.Timestamp(ordered["kickoff_at_utc"].max())
    train_end = first_kickoff + train_window
    folds: list[WalkForwardFold] = []

    while train_end + effective_gap <= last_kickoff:
        validation_start = train_end + effective_gap
        validation_end = validation_start + validation_window
        train_start = first_kickoff if expanding else train_end - train_window
        train_mask = ordered["kickoff_at_utc"].ge(train_start) & ordered["kickoff_at_utc"].lt(
            train_end
        )
        validation_mask = ordered["kickoff_at_utc"].ge(validation_start) & ordered[
            "kickoff_at_utc"
        ].lt(validation_end)
        train_indices = tuple(int(value) for value in ordered.index[train_mask])
        validation_indices = tuple(int(value) for value in ordered.index[validation_mask])
        if len(train_indices) >= min_train_fixtures and validation_indices:
            train_latest = ordered.loc[list(train_indices), "kickoff_at_utc"].max()
            validation_earliest = ordered.loc[list(validation_indices), "kickoff_at_utc"].min()
            if train_latest >= validation_earliest:
                raise AssertionError("walk-forward chronology invariant violated")
            folds.append(
                WalkForwardFold(
                    fold_id=len(folds),
                    train_indices=train_indices,
                    validation_indices=validation_indices,
                    train_start=train_start,
                    train_end=train_end,
                    validation_start=validation_start,
                    validation_end=validation_end,
                    gap=effective_gap,
                )
            )
        train_end += effective_step

    if not folds:
        raise ValueError("insufficient data for the requested walk-forward windows")
    return folds
