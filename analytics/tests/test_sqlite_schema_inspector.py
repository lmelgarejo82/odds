import sqlite3
from pathlib import Path

import pytest

from ou25_analytics.extraction.profiles import ExportProfile
from ou25_analytics.extraction.schema_inspector import inspect_schema
from ou25_analytics.extraction.sqlite_source import (
    FrozenSQLiteSource,
    SQLiteSchemaIncompatible,
)


def _inspect(database: Path, profile: ExportProfile = ExportProfile.PREMATCH):
    with FrozenSQLiteSource(database, allowed_source_root=database.parent) as source:
        return inspect_schema(source, profile=profile), source.executed_sql


def test_schema_fingerprint_is_stable_and_profile_scoped(synthetic_sqlite: Path) -> None:
    first, prematch_sql = _inspect(synthetic_sqlite)
    second, _ = _inspect(synthetic_sqlite)
    evaluation, _ = _inspect(synthetic_sqlite, ExportProfile.EVALUATION)
    assert first.fingerprint == second.fingerprint
    assert first.fingerprint != evaluation.fingerprint
    assert first.user_version == 2
    assert first.schema_version > 0
    assert all('FROM "Outcome"' not in statement for statement in prematch_sql)
    assert all('table_info("Outcome")' not in statement for statement in prematch_sql)
    assert all('foreign_key_list("Outcome")' not in statement for statement in prematch_sql)


def test_unknown_table_is_rejected(synthetic_sqlite: Path) -> None:
    connection = sqlite3.connect(synthetic_sqlite)
    try:
        connection.execute('CREATE TABLE "UnknownSyntheticTable" ("id" TEXT)')
        connection.commit()
    finally:
        connection.close()
    with pytest.raises(SQLiteSchemaIncompatible, match="unknown tables"):
        _inspect(synthetic_sqlite)


def test_missing_required_column_is_rejected(synthetic_sqlite: Path) -> None:
    connection = sqlite3.connect(synthetic_sqlite)
    try:
        connection.execute(
            'ALTER TABLE "ForebetSnapshot" RENAME COLUMN "parserVersion" TO "removedColumn"'
        )
        connection.commit()
    finally:
        connection.close()
    with pytest.raises(SQLiteSchemaIncompatible, match="missing columns"):
        _inspect(synthetic_sqlite)


def test_evaluation_requires_outcome_but_prematch_does_not(synthetic_sqlite: Path) -> None:
    connection = sqlite3.connect(synthetic_sqlite)
    try:
        connection.execute('DROP TABLE "Outcome"')
        connection.commit()
    finally:
        connection.close()
    _inspect(synthetic_sqlite, ExportProfile.PREMATCH)
    with pytest.raises(SQLiteSchemaIncompatible, match="missing table Outcome"):
        _inspect(synthetic_sqlite, ExportProfile.EVALUATION)
