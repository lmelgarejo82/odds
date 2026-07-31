import pandas as pd
import pytest

from ou25_analytics.splitting.walk_forward import walk_forward_splits


def _folds(fixtures: pd.DataFrame, *, expanding: bool = False):
    return walk_forward_splits(
        fixtures,
        train_window=pd.Timedelta(days=8),
        validation_window=pd.Timedelta(days=4),
        gap=pd.Timedelta(days=1),
        step=pd.Timedelta(days=4),
        expanding=expanding,
    )


def test_folds_have_zero_overlap_strict_order_and_gap(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    fixtures = synthetic_tables["fixtures"]
    for fold in _folds(fixtures):
        assert set(fold.train_indices).isdisjoint(fold.validation_indices)
        train_max = fixtures.loc[list(fold.train_indices), "kickoff_at_utc"].max()
        validation_min = fixtures.loc[list(fold.validation_indices), "kickoff_at_utc"].min()
        assert train_max < validation_min
        assert fold.validation_start - fold.train_end == pd.Timedelta(days=1)


def test_output_is_deterministic_and_expanding_window_retains_history(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    fixtures = synthetic_tables["fixtures"].sample(frac=1, random_state=9)
    assert _folds(fixtures) == _folds(fixtures)
    expanding = _folds(fixtures, expanding=True)
    assert len(expanding[-1].train_indices) > len(expanding[0].train_indices)


def test_insufficient_or_invalid_data_is_rejected(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    fixtures = synthetic_tables["fixtures"].iloc[:2]
    with pytest.raises(ValueError, match="insufficient"):
        walk_forward_splits(
            fixtures,
            train_window=pd.Timedelta(days=30),
            validation_window=pd.Timedelta(days=5),
        )
    duplicated = pd.concat(
        [synthetic_tables["fixtures"], synthetic_tables["fixtures"].iloc[[0]]], ignore_index=True
    )
    with pytest.raises(ValueError, match="only once"):
        _folds(duplicated)


def test_naive_kickoff_and_negative_gap_are_rejected(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    naive = synthetic_tables["fixtures"].copy()
    naive["kickoff_at_utc"] = naive["kickoff_at_utc"].dt.tz_localize(None)
    with pytest.raises(ValueError, match="timezone-aware UTC"):
        _folds(naive)
    with pytest.raises(ValueError, match="gap"):
        walk_forward_splits(
            synthetic_tables["fixtures"],
            train_window=pd.Timedelta(days=8),
            validation_window=pd.Timedelta(days=4),
            gap=pd.Timedelta(days=-1),
        )
