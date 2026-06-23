"""
On-demand report generation separate from the main job pipeline.

Reads existing processed job outputs (monthly means, nan files, geotiffs) and
generates figures + PDF reports with user-specified unit and color-scale options.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime
from os import makedirs
from os.path import dirname, exists, join
from pathlib import Path
from typing import Literal

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio

from .constants import WGS84
from .figure_generator import calculate_year_bounds
from .generate_figure import generate_figure
from .pdf_report_generator import (
    append_data_documentation,
    generate_custom_pdf_report,
    get_documentation_preview_cache_path,
    render_documentation_page,
)
from .plotting_helpers import MetricETUnit, convert_to_nice_number_range, et_unit_from_name
from .ROI_area import ROI_area
from .summary_figure_generator import generate_summary_figure
from .yearly_combined_figure_generator import generate_yearly_combined_figure

logger = logging.getLogger(__name__)

CUSTOM_REPORT_PREVIEW_VERSION = 2

ColorScaleMode = Literal["across_years", "per_year", "custom"]
PreviewKind = Literal["year", "summary", "yearly_combined", "documentation"]
UnitName = Literal["metric", "imperial", "acre-feet"]


@dataclass
class CustomReportConfig:
    output_directory: str
    roi_path: str
    roi_name: str
    start_year: int
    end_year: int
    et_units: UnitName = "metric"
    ppt_units: UnitName = "metric"
    color_scale: ColorScaleMode = "across_years"
    et_custom_min: float | None = None
    et_custom_max: float | None = None
    et_eto_scale: ColorScaleMode = "across_years"
    et_eto_custom_min: float | None = None
    et_eto_custom_max: float | None = None
    ppt_scale: ColorScaleMode = "across_years"
    ppt_custom_min: float | None = None
    ppt_custom_max: float | None = None
    show_monthly_averages: bool = False
    start_month: int = 1
    end_month: int = 12
    requestor: dict | None = None
    output_dir: str | None = None
    include_summary: bool = True
    include_yearly_combined: bool = False
    include_documentation: bool = True


def _resolve_output_dir(config: CustomReportConfig) -> str:
    if config.output_dir:
        return config.output_dir
    return join(config.output_directory, "custom_reports", "latest")


def _unit_figure_suffix(et_units: UnitName) -> str:
    if et_units == "imperial":
        return "_in"
    if et_units == "acre-feet":
        return "_AF"
    return ""


def _pipeline_figure_directory(config: CustomReportConfig) -> Path:
    return Path(config.output_directory) / "figures" / config.roi_name


def _can_use_pipeline_figures(config: CustomReportConfig) -> bool:
    return (
        config.color_scale == "across_years"
        and config.et_eto_scale == "across_years"
        and config.ppt_scale == "across_years"
        and not config.show_monthly_averages
        and config.et_units == config.ppt_units
    )


def _try_pipeline_preview_path(
    config: CustomReportConfig,
    preview_kind: PreviewKind,
    year: int | None,
) -> str | None:
    if not _can_use_pipeline_figures(config):
        return None

    figure_directory = _pipeline_figure_directory(config)
    suffix = _unit_figure_suffix(config.et_units)
    if preview_kind == "year" and year is not None:
        return str(figure_directory / f"{year}_{config.roi_name}{suffix}.png")
    if preview_kind == "summary":
        return str(figure_directory / f"summary_{config.roi_name}{suffix}.png")
    if preview_kind == "yearly_combined":
        return None
    return None


def _display_scale_bounds(
    vmin: float | None,
    vmax: float | None,
    unit,
) -> tuple[float | None, float | None]:
    if vmin is None or vmax is None:
        return None, None
    if unit.units == "metric":
        nice = convert_to_nice_number_range(vmin, vmax, MetricETUnit())
    else:
        nice = convert_to_nice_number_range(vmin, vmax, unit)
    return float(nice[0]), float(nice[-1])


def _display_et_bounds(
    et_vmin: float | None,
    et_vmax: float | None,
    et_unit,
) -> tuple[float | None, float | None]:
    return _display_scale_bounds(et_vmin, et_vmax, et_unit)


def _bounds_group(
    across_min: float | None,
    across_max: float | None,
    per_year_min: float | None,
    per_year_max: float | None,
) -> dict[str, dict[str, float | None]]:
    return {
        "across_years": {"min": across_min, "max": across_max},
        "per_year": {"min": per_year_min, "max": per_year_max},
    }


def get_scale_bounds(config: CustomReportConfig, year: int) -> dict[str, dict[str, dict[str, float | None]]]:
    """Return display-unit bounds for map, ET/ETo chart, and precipitation chart scales."""
    monthly_means_directory = Path(config.output_directory) / "monthly_means" / config.roi_name
    monthly_nan_directory = Path(config.output_directory) / "monthly_nan" / config.roi_name
    bounds = _calculate_global_bounds(monthly_means_directory, monthly_nan_directory)

    output_dir = _resolve_output_dir(config)
    makedirs(output_dir, exist_ok=True)
    roi_acres = round(ROI_area(config.roi_path, output_dir), 2)
    et_unit = et_unit_from_name(config.et_units, acres=roi_acres)
    ppt_unit = et_unit_from_name(config.ppt_units, acres=roi_acres)

    across_map_min, across_map_max = _display_et_bounds(bounds["et_vmin"], bounds["et_vmax"], et_unit)
    year_et_vmin, year_et_vmax = _calculate_year_et_bounds(monthly_means_directory, year)
    if year_et_vmin is None:
        year_et_vmin = bounds["et_vmin"]
    if year_et_vmax is None:
        year_et_vmax = bounds["et_vmax"]
    per_year_map_min, per_year_map_max = _display_et_bounds(year_et_vmin, year_et_vmax, et_unit)

    year_combined_min, year_combined_max = _calculate_year_combined_bounds(
        monthly_means_directory,
        monthly_nan_directory,
        year,
    )
    if year_combined_min is None:
        year_combined_min = bounds["combined_abs_min"]
    if year_combined_max is None:
        year_combined_max = bounds["combined_abs_max"]
    across_et_eto_min, across_et_eto_max = _display_scale_bounds(
        bounds["combined_abs_min"],
        bounds["combined_abs_max"],
        et_unit,
    )
    per_year_et_eto_min, per_year_et_eto_max = _display_scale_bounds(
        year_combined_min,
        year_combined_max,
        et_unit,
    )

    year_ppt_min, year_ppt_max = _calculate_year_ppt_bounds(monthly_nan_directory, year)
    if year_ppt_min is None:
        year_ppt_min = bounds["ppt_min"]
    if year_ppt_max is None:
        year_ppt_max = bounds["ppt_max"]
    across_ppt_min, across_ppt_max = _display_scale_bounds(bounds["ppt_min"], bounds["ppt_max"], ppt_unit)
    per_year_ppt_min, per_year_ppt_max = _display_scale_bounds(year_ppt_min, year_ppt_max, ppt_unit)

    return {
        "map": _bounds_group(across_map_min, across_map_max, per_year_map_min, per_year_map_max),
        "et_eto": _bounds_group(across_et_eto_min, across_et_eto_max, per_year_et_eto_min, per_year_et_eto_max),
        "ppt": _bounds_group(across_ppt_min, across_ppt_max, per_year_ppt_min, per_year_ppt_max),
    }


def get_et_scale_bounds(config: CustomReportConfig, year: int) -> dict[str, dict[str, dict[str, float | None]]]:
    return get_scale_bounds(config, year)


def _preview_cache_key(
    config: CustomReportConfig,
    preview_kind: PreviewKind,
    year: int | None,
    doc_page: int,
    preview_version: int | None = None,
) -> str:
    payload = {
        "roi": config.roi_name,
        "et_units": config.et_units,
        "ppt_units": config.ppt_units,
        "color_scale": config.color_scale,
        "et_custom_min": config.et_custom_min,
        "et_custom_max": config.et_custom_max,
        "et_eto_scale": config.et_eto_scale,
        "et_eto_custom_min": config.et_eto_custom_min,
        "et_eto_custom_max": config.et_eto_custom_max,
        "ppt_scale": config.ppt_scale,
        "ppt_custom_min": config.ppt_custom_min,
        "ppt_custom_max": config.ppt_custom_max,
        "show_monthly_averages": config.show_monthly_averages,
        "preview_kind": preview_kind,
        "year": year,
        "doc_page": doc_page,
        "start_month": config.start_month,
        "end_month": config.end_month,
        "preview_version": preview_version or CUSTOM_REPORT_PREVIEW_VERSION,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]


def _preview_cache_path(config: CustomReportConfig, cache_key: str) -> str:
    cache_dir = join(config.output_directory, "custom_reports", "preview_cache")
    makedirs(cache_dir, exist_ok=True)
    return join(cache_dir, f"{cache_key}.png")


def _should_skip_means_file(file: Path) -> bool:
    stem = file.stem
    if stem.endswith("_combined") or "_temp_" in stem:
        return True
    return not stem.endswith("_monthly_means")


def _calculate_global_bounds(
    monthly_means_directory: Path,
    monthly_nan_directory: Path,
) -> dict[str, float | None]:
    et_vmin = et_vmax = None
    combined_abs_min = combined_abs_max = None
    ppt_min = ppt_max = None
    cloud_cover_min = cloud_cover_max = None

    for file in monthly_means_directory.glob("*.csv"):
        if _should_skip_means_file(file):
            continue
        year_df = pd.read_csv(file)
        for variable in ["ET", "PET"]:
            year_vmin, year_vmax = calculate_year_bounds(year_df, file, variable, abs=True)
            if year_vmin is None:
                continue
            combined_abs_min = year_vmin if combined_abs_min is None else min(combined_abs_min, year_vmin)
            combined_abs_max = year_vmax if combined_abs_max is None else max(combined_abs_max, year_vmax)

        year_vmin, year_vmax = calculate_year_bounds(year_df, file, "ET")
        if year_vmin is None:
            continue
        et_vmin = year_vmin if et_vmin is None else min(et_vmin, year_vmin)
        et_vmax = year_vmax if et_vmax is None else max(et_vmax, year_vmax)

    for file in monthly_nan_directory.glob("*.csv"):
        year_df = pd.read_csv(file)
        for variable in ["avg_min", "avg_max"]:
            year_vmin, year_vmax = calculate_year_bounds(year_df, file, variable, abs=True)
            if year_vmin is None:
                continue
            combined_abs_min = year_vmin if combined_abs_min is None else min(combined_abs_min, year_vmin)
            combined_abs_max = year_vmax if combined_abs_max is None else max(combined_abs_max, year_vmax)

        year_ppt_min, year_ppt_max = calculate_year_bounds(year_df, file, "ppt_avg", abs=True)
        if year_ppt_min is not None:
            ppt_min = year_ppt_min if ppt_min is None else min(ppt_min, year_ppt_min)
            ppt_min = max(ppt_min, 0)
        if year_ppt_max is not None:
            ppt_max = year_ppt_max if ppt_max is None else max(ppt_max, year_ppt_max)
            ppt_max = max(ppt_max, ppt_min or 0)

        year_cloud_cover_min, year_cloud_cover_max = calculate_year_bounds(year_df, file, "percent_nan", abs=True)
        if year_cloud_cover_min is not None and not pd.isna(year_cloud_cover_min):
            cloud_cover_min = (
                year_cloud_cover_min if cloud_cover_min is None else min(cloud_cover_min, year_cloud_cover_min)
            )
        if year_cloud_cover_max is not None and not pd.isna(year_cloud_cover_max):
            cloud_cover_max = (
                year_cloud_cover_max if cloud_cover_max is None else max(cloud_cover_max, year_cloud_cover_max)
            )

    cloud_cover_min = cloud_cover_min if cloud_cover_min is not None and not pd.isna(cloud_cover_min) else 0
    cloud_cover_max = cloud_cover_max if cloud_cover_max is not None and not pd.isna(cloud_cover_max) else 100

    return {
        "et_vmin": et_vmin,
        "et_vmax": et_vmax,
        "combined_abs_min": combined_abs_min,
        "combined_abs_max": combined_abs_max,
        "ppt_min": ppt_min,
        "ppt_max": ppt_max,
        "cloud_cover_min": cloud_cover_min,
        "cloud_cover_max": cloud_cover_max,
    }


def _calculate_year_et_bounds(monthly_means_directory: Path, year: int) -> tuple[float | None, float | None]:
    file = monthly_means_directory / f"{year}_monthly_means.csv"
    if not exists(file):
        return None, None
    year_df = pd.read_csv(file)
    return calculate_year_bounds(year_df, file, "ET")


def _calculate_year_combined_bounds(
    monthly_means_directory: Path,
    monthly_nan_directory: Path,
    year: int,
) -> tuple[float | None, float | None]:
    combined_abs_min = combined_abs_max = None

    mm_file = monthly_means_directory / f"{year}_monthly_means.csv"
    if exists(mm_file):
        year_df = pd.read_csv(mm_file)
        for variable in ["ET", "PET"]:
            year_vmin, year_vmax = calculate_year_bounds(year_df, mm_file, variable, abs=True)
            if year_vmin is None:
                continue
            combined_abs_min = year_vmin if combined_abs_min is None else min(combined_abs_min, year_vmin)
            combined_abs_max = year_vmax if combined_abs_max is None else max(combined_abs_max, year_vmax)

    nd_file = monthly_nan_directory / f"{year}.csv"
    if exists(nd_file):
        year_df = pd.read_csv(nd_file)
        for variable in ["avg_min", "avg_max"]:
            year_vmin, year_vmax = calculate_year_bounds(year_df, nd_file, variable, abs=True)
            if year_vmin is None:
                continue
            combined_abs_min = year_vmin if combined_abs_min is None else min(combined_abs_min, year_vmin)
            combined_abs_max = year_vmax if combined_abs_max is None else max(combined_abs_max, year_vmax)

    return combined_abs_min, combined_abs_max


def _calculate_year_ppt_bounds(monthly_nan_directory: Path, year: int) -> tuple[float | None, float | None]:
    file = monthly_nan_directory / f"{year}.csv"
    if not exists(file):
        return None, None
    year_df = pd.read_csv(file)
    ppt_min, ppt_max = calculate_year_bounds(year_df, file, "ppt_avg", abs=True)
    if ppt_min is not None:
        ppt_min = max(ppt_min, 0)
    if ppt_max is not None and ppt_min is not None:
        ppt_max = max(ppt_max, ppt_min)
    return ppt_min, ppt_max


def _extract_month_et_averages(mm: pd.DataFrame, start_month: int, end_month: int) -> dict[int, float]:
    averages: dict[int, float] = {}
    if "ET" not in mm.columns or "Month" not in mm.columns:
        return averages

    for _, row in mm.iterrows():
        try:
            month = int(row["Month"])
        except (TypeError, ValueError):
            continue
        if month < start_month or month > end_month:
            continue
        et = row["ET"]
        if pd.notna(et):
            averages[month] = float(et)
    return averages


def _resolve_et_bounds(
    config: CustomReportConfig,
    bounds: dict[str, float | None],
    monthly_means_directory: Path,
    year: int,
    et_unit,
) -> tuple[float | None, float | None]:
    if config.color_scale == "custom":
        if config.et_custom_min is None or config.et_custom_max is None:
            raise ValueError("Custom color scale requires min and max values")
        et_vmin = et_unit.convert_to_metric(config.et_custom_min)
        et_vmax = et_unit.convert_to_metric(config.et_custom_max)
        if et_vmin >= et_vmax:
            raise ValueError("Custom color scale max must be greater than min")
        return et_vmin, et_vmax

    if config.color_scale == "per_year":
        year_et_vmin, year_et_vmax = _calculate_year_et_bounds(monthly_means_directory, year)
        return (
            year_et_vmin if year_et_vmin is not None else bounds["et_vmin"],
            year_et_vmax if year_et_vmax is not None else bounds["et_vmax"],
        )

    return bounds["et_vmin"], bounds["et_vmax"]


def _resolve_combined_bounds(
    config: CustomReportConfig,
    bounds: dict[str, float | None],
    monthly_means_directory: Path,
    monthly_nan_directory: Path,
    year: int | None,
    et_unit,
) -> tuple[float | None, float | None]:
    if config.et_eto_scale == "custom":
        if config.et_eto_custom_min is None or config.et_eto_custom_max is None:
            raise ValueError("Custom ET/ETo scale requires min and max values")
        combined_vmin = et_unit.convert_to_metric(config.et_eto_custom_min)
        combined_vmax = et_unit.convert_to_metric(config.et_eto_custom_max)
        if combined_vmin >= combined_vmax:
            raise ValueError("Custom ET/ETo scale max must be greater than min")
        return combined_vmin, combined_vmax

    if config.et_eto_scale == "per_year" and year is not None:
        year_combined_min, year_combined_max = _calculate_year_combined_bounds(
            monthly_means_directory,
            monthly_nan_directory,
            year,
        )
        return (
            year_combined_min if year_combined_min is not None else bounds["combined_abs_min"],
            year_combined_max if year_combined_max is not None else bounds["combined_abs_max"],
        )

    return bounds["combined_abs_min"], bounds["combined_abs_max"]


def _resolve_ppt_bounds(
    config: CustomReportConfig,
    bounds: dict[str, float | None],
    monthly_nan_directory: Path,
    year: int | None,
    ppt_unit,
) -> tuple[float | None, float | None]:
    if config.ppt_scale == "custom":
        if config.ppt_custom_min is None or config.ppt_custom_max is None:
            raise ValueError("Custom precipitation scale requires min and max values")
        ppt_vmin = ppt_unit.convert_to_metric(config.ppt_custom_min)
        ppt_vmax = ppt_unit.convert_to_metric(config.ppt_custom_max)
        if ppt_vmin >= ppt_vmax:
            raise ValueError("Custom precipitation scale max must be greater than min")
        return ppt_vmin, ppt_vmax

    if config.ppt_scale == "per_year" and year is not None:
        year_ppt_min, year_ppt_max = _calculate_year_ppt_bounds(monthly_nan_directory, year)
        return (
            year_ppt_min if year_ppt_min is not None else bounds["ppt_min"],
            year_ppt_max if year_ppt_max is not None else bounds["ppt_max"],
        )

    return bounds["ppt_min"], bounds["ppt_max"]


def _prepare_year_main_df(
    year: int,
    monthly_means_directory: Path,
    monthly_nan_directory: Path,
    start_month: int,
    end_month: int,
) -> pd.DataFrame:
    nd_filename = monthly_nan_directory / f"{year}.csv"
    if exists(nd_filename):
        nd = pd.read_csv(nd_filename)
    else:
        nd = pd.DataFrame(columns=["year", "month", "percent_nan", "avg_min", "avg_max"])

    mm_filename = monthly_means_directory / f"{year}_monthly_means.csv"
    if exists(mm_filename):
        mm = pd.read_csv(mm_filename)
    else:
        mm = pd.DataFrame(columns=["Year", "Month", "ET", "PET"])

    idx = {"Months": range(start_month, end_month + 1)}
    df1 = pd.DataFrame(idx, columns=["Months"])
    main_dfa = pd.merge(left=df1, right=mm, how="left", left_on="Months", right_on="Month")
    main_df = pd.merge(left=main_dfa, right=nd, how="left", left_on="Months", right_on="month")

    if "Year" not in main_df.columns and "Year_x" in main_df.columns:
        main_df = main_df.rename(columns={"Year_x": "Year"})
    return main_df.replace(np.nan, 100)


def _get_affine(subset_directory: Path, roi_name: str):
    for file in subset_directory.glob(f"*_{roi_name}_ET_subset.tif"):
        with rasterio.open(str(file)) as src:
            return src.transform
    return None


def generate_custom_figures(
    config: CustomReportConfig,
    years: list[int] | None = None,
    *,
    include_summary: bool | None = None,
    include_yearly_combined: bool | None = None,
    output_dir_override: str | None = None,
    clear_output_dir: bool = True,
) -> str:
    """Generate custom report figures into a dedicated output directory."""
    output_dir = output_dir_override or _resolve_output_dir(config)
    if clear_output_dir and exists(output_dir):
        shutil.rmtree(output_dir)
    makedirs(output_dir, exist_ok=True)

    roi_name = config.roi_name
    output_directory = config.output_directory
    monthly_nan_directory = Path(output_directory) / "monthly_nan" / roi_name
    monthly_sums_directory = Path(output_directory) / "monthly" / roi_name
    monthly_means_directory = Path(output_directory) / "monthly_means" / roi_name
    subset_directory = Path(output_directory) / "subset" / roi_name

    ROI_latlon = gpd.read_file(config.roi_path).to_crs(WGS84).geometry[0]
    ROI_acres = round(ROI_area(config.roi_path, output_dir), 2)
    creation_date = datetime.today()

    et_unit = et_unit_from_name(config.et_units, acres=ROI_acres)
    ppt_unit = et_unit_from_name(config.ppt_units, acres=ROI_acres)

    bounds = _calculate_global_bounds(monthly_means_directory, monthly_nan_directory)
    if years is None:
        target_years = list(range(config.start_year, config.end_year + 1))
    else:
        target_years = years

    should_include_summary = config.include_summary if include_summary is None else include_summary
    should_include_yearly_combined = (
        config.include_yearly_combined if include_yearly_combined is None else include_yearly_combined
    )

    for year in target_years:
        mm_filename = monthly_means_directory / f"{year}_monthly_means.csv"
        if exists(mm_filename):
            mm = pd.read_csv(mm_filename)
            month_et_averages = _extract_month_et_averages(mm, config.start_month, config.end_month)
        else:
            month_et_averages = {}

        main_df = _prepare_year_main_df(
            year,
            monthly_means_directory,
            monthly_nan_directory,
            config.start_month,
            config.end_month,
        )
        affine = _get_affine(subset_directory, roi_name)
        if affine is None:
            logger.error("no subset found for year %s and ROI %s", year, roi_name)
            continue

        et_vmin, et_vmax = _resolve_et_bounds(config, bounds, monthly_means_directory, year, et_unit)
        combined_abs_min, combined_abs_max = _resolve_combined_bounds(
            config,
            bounds,
            monthly_means_directory,
            monthly_nan_directory,
            year,
            et_unit,
        )
        ppt_min, ppt_max = _resolve_ppt_bounds(config, bounds, monthly_nan_directory, year, ppt_unit)

        figure_filename = join(output_dir, f"{year}_{roi_name}.png")
        generate_figure(
            ROI_name=roi_name,
            ROI_latlon=ROI_latlon,
            ROI_acres=ROI_acres,
            creation_date=creation_date,
            year=year,
            et_vmin=et_vmin,
            et_vmax=et_vmax,
            combined_abs_min=combined_abs_min,
            combined_abs_max=combined_abs_max,
            ppt_min=ppt_min,
            ppt_max=ppt_max,
            cloud_cover_min=bounds["cloud_cover_min"],
            cloud_cover_max=bounds["cloud_cover_max"],
            affine=affine,
            main_df=main_df,
            monthly_sums_directory=str(monthly_sums_directory),
            figure_filename=figure_filename,
            start_month=config.start_month,
            end_month=config.end_month,
            requestor=config.requestor,
            units=et_unit,
            ppt_units=ppt_unit,
            plain_filename=True,
            show_monthly_averages=config.show_monthly_averages,
            month_et_averages_metric=month_et_averages if config.show_monthly_averages else None,
            et_bounds_are_custom=config.color_scale == "custom",
        )

    if should_include_summary:
        summary_year = config.end_year
        summary_combined_min, summary_combined_max = _resolve_combined_bounds(
            config,
            bounds,
            monthly_means_directory,
            monthly_nan_directory,
            summary_year,
            et_unit,
        )
        summary_ppt_min, summary_ppt_max = _resolve_ppt_bounds(
            config,
            bounds,
            monthly_nan_directory,
            summary_year,
            ppt_unit,
        )
        summary_figure_filename = join(output_dir, f"summary_{roi_name}.png")
        generate_summary_figure(
            ROI_name=roi_name,
            ROI_acres=ROI_acres,
            creation_date=creation_date,
            start_year=config.start_year,
            end_year=config.end_year,
            et_vmin=bounds["et_vmin"],
            et_vmax=bounds["et_vmax"],
            combined_abs_min=summary_combined_min,
            combined_abs_max=summary_combined_max,
            ppt_min=summary_ppt_min,
            ppt_max=summary_ppt_max,
            cloud_cover_min=bounds["cloud_cover_min"],
            cloud_cover_max=bounds["cloud_cover_max"],
            monthly_means_directory=str(monthly_means_directory),
            monthly_nan_directory=str(monthly_nan_directory),
            figure_filename=summary_figure_filename,
            requestor=config.requestor,
            units=et_unit,
            ppt_units=ppt_unit,
            plain_filename=True,
        )

    if should_include_yearly_combined:
        yearly_year = config.end_year
        yearly_combined_min, yearly_combined_max = _resolve_combined_bounds(
            config,
            bounds,
            monthly_means_directory,
            monthly_nan_directory,
            yearly_year,
            et_unit,
        )
        yearly_ppt_min, yearly_ppt_max = _resolve_ppt_bounds(
            config,
            bounds,
            monthly_nan_directory,
            yearly_year,
            ppt_unit,
        )
        yearly_combined_figure_filename = join(output_dir, f"yearly_combined_{roi_name}.png")
        generate_yearly_combined_figure(
            ROI_name=roi_name,
            ROI_acres=ROI_acres,
            creation_date=creation_date,
            start_year=config.start_year,
            end_year=config.end_year,
            monthly_means_directory=str(monthly_means_directory),
            monthly_nan_directory=str(monthly_nan_directory),
            figure_filename=yearly_combined_figure_filename,
            requestor=config.requestor,
            units=et_unit,
            ppt_units=ppt_unit,
            plain_filename=True,
            combined_abs_min=yearly_combined_min,
            combined_abs_max=yearly_combined_max,
            ppt_min=yearly_ppt_min,
            ppt_max=yearly_ppt_max,
        )

    return output_dir


def generate_custom_report(config: CustomReportConfig) -> str:
    """Generate all figures and a PDF report with the given configuration."""
    figure_directory = generate_custom_figures(config)
    report_path = generate_custom_pdf_report(figure_directory, config.roi_name)
    if config.include_documentation:
        append_data_documentation(report_path)
    return report_path


def generate_custom_preview(
    config: CustomReportConfig,
    preview_kind: PreviewKind = "year",
    year: int | None = None,
    doc_page: int = 1,
    *,
    force_refresh: bool = False,
    preview_version: int | None = None,
) -> str:
    """Generate a preview image for a report page and return its path."""
    resolved_preview_version = preview_version or CUSTOM_REPORT_PREVIEW_VERSION

    if preview_kind == "documentation":
        cache_path = get_documentation_preview_cache_path(doc_page)
        if not force_refresh and exists(cache_path):
            return cache_path
        output_png = join(_resolve_output_dir(config), f"documentation_page_{doc_page}.png")
        makedirs(dirname(output_png), exist_ok=True)
        return render_documentation_page(doc_page, output_png)

    if not force_refresh:
        pipeline_path = _try_pipeline_preview_path(config, preview_kind, year)
        if pipeline_path and exists(pipeline_path):
            return pipeline_path

    cache_key = _preview_cache_key(config, preview_kind, year, doc_page, resolved_preview_version)
    cached_path = _preview_cache_path(config, cache_key)
    if not force_refresh and exists(cached_path):
        return cached_path

    roi_name = config.roi_name
    build_dir = join(config.output_directory, "custom_reports", "preview_build", cache_key)
    if exists(build_dir):
        shutil.rmtree(build_dir)

    if preview_kind == "summary":
        generate_custom_figures(
            config,
            years=[],
            include_summary=True,
            output_dir_override=build_dir,
            clear_output_dir=False,
        )
        generated_path = join(build_dir, f"summary_{roi_name}.png")
    elif preview_kind == "yearly_combined":
        generate_custom_figures(
            config,
            years=[],
            include_summary=False,
            include_yearly_combined=True,
            output_dir_override=build_dir,
            clear_output_dir=False,
        )
        generated_path = join(build_dir, f"yearly_combined_{roi_name}.png")
    else:
        if year is None:
            raise ValueError("Preview year is required for year report previews")
        generate_custom_figures(
            config,
            years=[year],
            include_summary=False,
            output_dir_override=build_dir,
            clear_output_dir=False,
        )
        generated_path = join(build_dir, f"{year}_{roi_name}.png")

    shutil.copy2(generated_path, cached_path)
    return cached_path
