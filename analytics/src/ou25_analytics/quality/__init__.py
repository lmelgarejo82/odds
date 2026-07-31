"""Structured analytical data-quality checks."""

from .checks import run_quality_checks
from .report import CheckResult, QualityReport

__all__ = ["CheckResult", "QualityReport", "run_quality_checks"]
