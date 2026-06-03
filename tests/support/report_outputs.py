from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from tests.support.paths import MM_PER_INCH


@dataclass(frozen=True)
class MonthlyReportRow:
    year: int
    month: int
    et_mm: float
    eto_mm: float
    ppt_mm: float
    cloud_coverage_percent: float | None = None
    landsat_passes: int | None = None


EXPECTED_MONTHLY_MEANS_COLUMNS = {"Year", "Month", "ET", "PET"}
EXPECTED_COMBINED_HEADERS_METRIC = [
    "Year",
    "Month",
    "ET (mm/month)",
    "ETo (mm/month)",
    "Precipitation (mm/month)",
    "Cloud Coverage + Missing Data (%)",
    "Days with Landsat Passes",
]


def read_monthly_means(report_output: Path, roi_name: str, year: int) -> pd.DataFrame:
    csv_path = report_output / "monthly_means" / roi_name / f"{year}_monthly_means.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing monthly means CSV: {csv_path}")
    df = pd.read_csv(csv_path)
    if "Unnamed: 0" in df.columns:
        df = df.drop(columns=["Unnamed: 0"])
    return df


def read_monthly_nan(report_output: Path, roi_name: str, year: int) -> pd.DataFrame:
    csv_path = report_output / "monthly_nan" / roi_name / f"{year}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing monthly NaN CSV: {csv_path}")
    return pd.read_csv(csv_path)


def read_combined_csv(report_output: Path, roi_name: str) -> pd.DataFrame:
    csv_path = report_output / f"{roi_name}_combined.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing combined CSV: {csv_path}")
    return pd.read_csv(csv_path)


def build_combined_csv_from_outputs(report_output: Path, roi_name: str, year: int) -> Path:
    monthly_means = read_monthly_means(report_output, roi_name, year)
    monthly_nan = read_monthly_nan(report_output, roi_name, year)

    rows = []
    for _, mean_row in monthly_means.iterrows():
        nan_row = monthly_nan.loc[monthly_nan["month"] == mean_row["Month"]]
        ppt = float(nan_row["ppt_avg"].iloc[0]) if not nan_row.empty else 0.0
        cloud = float(nan_row["percent_nan"].iloc[0]) if not nan_row.empty else ""
        rows.append(
            [
                int(mean_row["Year"]),
                int(mean_row["Month"]),
                round(float(mean_row["ET"]), 2),
                round(float(mean_row["PET"]), 2),
                round(ppt, 2),
                cloud,
                "",
            ]
        )

    combined_path = report_output / f"{roi_name}_combined.csv"
    header = ",".join(EXPECTED_COMBINED_HEADERS_METRIC)
    with open(combined_path, "w") as handle:
        handle.write(header + "\n")
        for row in rows:
            handle.write(",".join(str(value) for value in row) + "\n")
    return combined_path


def assert_monthly_value_ranges(df: pd.DataFrame, max_mm: float = 1500) -> None:
    for column in ("ET", "PET"):
        values = df[column].dropna()
        assert (values >= 0).all(), f"{column} contains negative values"
        assert (values <= max_mm).all(), f"{column} exceeds plausible maximum of {max_mm} mm/month"


def assert_combined_csv_structure(df: pd.DataFrame) -> None:
    for header in EXPECTED_COMBINED_HEADERS_METRIC:
        assert header in df.columns, f"Combined CSV missing column: {header}"


def monthly_report_rows_from_means(report_output: Path, roi_name: str, year: int) -> list[MonthlyReportRow]:
    monthly_means = read_monthly_means(report_output, roi_name, year)
    monthly_nan = read_monthly_nan(report_output, roi_name, year)
    rows = []
    for _, mean_row in monthly_means.iterrows():
        nan_match = monthly_nan.loc[monthly_nan["month"] == mean_row["Month"]]
        rows.append(
            MonthlyReportRow(
                year=int(mean_row["Year"]),
                month=int(mean_row["Month"]),
                et_mm=float(mean_row["ET"]),
                eto_mm=float(mean_row["PET"]),
                ppt_mm=float(nan_match["ppt_avg"].iloc[0]) if not nan_match.empty else 0.0,
                cloud_coverage_percent=float(nan_match["percent_nan"].iloc[0]) if not nan_match.empty else None,
            )
        )
    return rows


def annual_mean_mm(rows: list[MonthlyReportRow], field: str) -> float:
    values = [getattr(row, field) for row in rows]
    return float(sum(values) / len(values))


def annual_mean_inches(rows: list[MonthlyReportRow], field: str) -> float:
    return annual_mean_mm(rows, field) / MM_PER_INCH
