from collections.abc import Callable
from datetime import datetime
from pathlib import Path

import pandas as pd
import pytest

from ou25_analytics.snapshot.writer import write_snapshot
from ou25_analytics.synthetic.factory import make_synthetic_tables


@pytest.fixture
def synthetic_tables() -> dict[str, pd.DataFrame]:
    return make_synthetic_tables(seed=42)


@pytest.fixture
def snapshot_writer() -> Callable[[Path, dict[str, pd.DataFrame], str], Path]:
    def write(root: Path, tables: dict[str, pd.DataFrame], snapshot_id: str = "SYNTH_TEST") -> Path:
        cutoff: datetime = tables["outcomes"]["observed_at_utc"].max().to_pydatetime()
        return write_snapshot(
            root,
            tables,
            snapshot_id=snapshot_id,
            created_at_utc=cutoff + pd.Timedelta(hours=1),
            cutoff_at_utc=cutoff,
            source_kind="SYNTHETIC_FACTORY",
            source_reference="seed:42",
            source_database_sha256=None,
            source_git_commit="SYNTHETIC_SOURCE",
            analytics_git_commit="TEST_WORKTREE",
            analytics_lock_sha256="a" * 64,
            synthetic=True,
            notes=["test snapshot"],
        )

    return write
