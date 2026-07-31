"""Quality report models with bounded diagnostic samples."""

from pydantic import BaseModel, ConfigDict, Field


class CheckResult(BaseModel):
    """One deterministic quality assertion."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    check_id: str
    severity: str
    passed: bool
    affected_rows: int = Field(ge=0)
    total_rows: int = Field(ge=0)
    sample_identifiers: list[str]
    message: str


class QualityReport(BaseModel):
    """Snapshot-wide quality result."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_id: str
    checks: list[CheckResult]
    coverage: dict[str, int]

    @property
    def has_errors(self) -> bool:
        """Return whether any ERROR check failed."""

        return any(check.severity == "ERROR" and not check.passed for check in self.checks)
