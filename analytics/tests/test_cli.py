import os
import subprocess
import sys
from pathlib import Path


def test_self_check_succeeds_warns_and_cleans_temporaries(tmp_path: Path) -> None:
    temporary_root = tmp_path / "cli-temporary"
    temporary_root.mkdir()
    environment = {**os.environ, "TMPDIR": str(temporary_root)}
    result = subprocess.run(
        [sys.executable, "-m", "ou25_analytics.cli", "self-check"],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "SYNTHETIC_DATA_ONLY" in result.stdout
    assert "NO_REAL_PERFORMANCE_CLAIM" in result.stdout
    assert '"fixture_rows": 12' in result.stdout
    assert list(temporary_root.iterdir()) == []
