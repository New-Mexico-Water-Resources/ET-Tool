from __future__ import annotations

import os
import random
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd

from tests.support.external_references import relative_difference


@dataclass(frozen=True)
class DataQualityComparisonRow:
    year: int
    month: int
    variable: str
    report_mm: float
    reference_mm: float
    absolute_diff_mm: float
    relative_diff_pct: float
    reference_source: str
    tolerance_pct: float
    passed: bool
    upstream_reference_mm: float | None = None
    upstream_reference_source: str | None = None


def choose_data_quality_month() -> int:
    override = os.environ.get("TEST_MONTH")
    if override:
        return int(override)
    return random.randint(1, 12)


def build_comparison_row(
    *,
    year: int,
    month: int,
    variable: str,
    report_mm: float,
    reference_mm: float,
    reference_source: str,
    tolerance_pct: float,
    upstream_reference_mm: float | None = None,
    upstream_reference_source: str | None = None,
) -> DataQualityComparisonRow:
    absolute_diff_mm = abs(report_mm - reference_mm)
    relative_diff_pct = relative_difference(reference_mm, report_mm) * 100
    passed = relative_diff_pct <= tolerance_pct * 100
    return DataQualityComparisonRow(
        year=year,
        month=month,
        variable=variable,
        report_mm=round(report_mm, 4),
        reference_mm=round(reference_mm, 4),
        absolute_diff_mm=round(absolute_diff_mm, 4),
        relative_diff_pct=round(relative_diff_pct, 2),
        reference_source=reference_source,
        tolerance_pct=round(tolerance_pct * 100, 1),
        passed=passed,
        upstream_reference_mm=round(upstream_reference_mm, 4) if upstream_reference_mm is not None else None,
        upstream_reference_source=upstream_reference_source,
    )


def data_quality_comparison_csv_path(year: int, month: int) -> Path:
    from tests.support.paths import DATA_QUALITY_OUTPUT_DIR

    return DATA_QUALITY_OUTPUT_DIR / f"data_quality_comparison_{year}_m{month:02d}.csv"


def write_data_quality_csv(output_path: Path, rows: list[DataQualityComparisonRow]) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame([asdict(row) for row in rows]).to_csv(output_path, index=False)
    return output_path.resolve()
