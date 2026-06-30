"""
Generate comparison reports between two completed jobs.

Produces chart-only figures (ET, ETo/PET, precipitation) for yearly, summary,
and yearly-aggregate views.
"""

from __future__ import annotations

import calendar
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
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from rasterio.transform import array_bounds

from .constants import END_MONTH, START_MONTH, WGS84
from .custom_report_generator import (
    _calculate_global_bounds,
    _calculate_year_combined_bounds,
    _calculate_year_et_bounds,
    _calculate_year_ppt_bounds,
    _display_et_bounds,
    _display_scale_bounds,
    _prepare_year_main_df,
)
from .generate_patch import generate_patch
from .pdf_report_generator import append_data_documentation, generate_custom_pdf_report
from .plotting_helpers import (
    MetricETUnit,
    PercentageUnits,
    cloud_coverage_data_unavailable,
    convert_to_nice_number_range,
    et_unit_from_name,
    fill_cloud_coverage_area,
    fill_missing_report_columns,
    format_requestor_name,
)
from .ROI_area import ROI_area
from .variable_types import OPENET_TRANSITION_DATE
from .yearly_combined_figure_generator import (
    _load_monthly_data,
    _prepare_yearly_dataframe,
    _yearly_xlim,
    calculate_yearly_totals_bounds,
)

logger = logging.getLogger(__name__)

ColorScaleMode = Literal["across_years", "per_year", "custom"]
MapTileMode = Literal["yearly_total", "month", "winter", "spring", "summer", "fall"]
PreviewKind = Literal["year", "summary", "yearly_combined"]
UnitName = Literal["metric", "imperial", "acre-feet"]

PET_COLOR = "#9e3fff"
ET_COLOR = "#fc8d59"
PPT_COLOR = "#2C77BF"
CLOUD_COLOR = "#7F7F7F"
CLOUD_LEGEND_LABEL = "Cloud Cover & Missing Data %"
ET_MAP_COLORS = ["#f6e8c3", "#d8b365", "#99974a", "#53792d", "#6bdfd2", "#1839c5"]

PORTRAIT_CONTENT_MARGIN_LEFT = 0.125
PORTRAIT_CONTENT_MARGIN_RIGHT = 0.90
LANDSCAPE_CONTENT_MARGIN_LEFT = 0.08
LANDSCAPE_CONTENT_MARGIN_RIGHT = 0.95
COMPARISON_REPORT_PREVIEW_VERSION = 14
METADATA_LINE_GAP = 0.022
LANDSCAPE_METADATA_LINE_GAP = 0.026
CHART_TOP_PADDING = 0.006
CHART_BOTTOM = 0.06
CHART_GAP = 0.016
THUMBNAIL_ROW_HEIGHT = 0.135
THUMBNAIL_TITLE_SPACE = 0.028
THUMBNAIL_BOTTOM_GAP = 0.010
THUMBNAIL_TILE_GAP = 0.018
THUMBNAIL_CBAR_WIDTH = 0.032
THUMBNAIL_CBAR_GAP = 0.010

SEASON_MONTHS: dict[str, tuple[int, ...]] = {
    "winter": (12, 1, 2),
    "spring": (3, 4, 5),
    "summer": (6, 7, 8),
    "fall": (9, 10, 11),
}


@dataclass
class JobReportSource:
    output_directory: str
    roi_path: str
    roi_name: str
    start_year: int
    end_year: int


@dataclass
class ComparisonReportConfig:
    primary: JobReportSource
    comparison: JobReportSource
    et_units: UnitName = "metric"
    ppt_units: UnitName = "metric"
    et_eto_scale: ColorScaleMode = "across_years"
    et_eto_custom_min: float | None = None
    et_eto_custom_max: float | None = None
    ppt_scale: ColorScaleMode = "across_years"
    ppt_custom_min: float | None = None
    ppt_custom_max: float | None = None
    color_scale: ColorScaleMode = "across_years"
    et_custom_min: float | None = None
    et_custom_max: float | None = None
    start_month: int = START_MONTH
    end_month: int = END_MONTH
    requestor: dict | None = None
    output_dir: str | None = None
    include_summary: bool = True
    include_yearly_combined: bool = False
    map_tile_mode: MapTileMode = "yearly_total"
    map_tile_month: int = START_MONTH


def _comparison_slug(config: ComparisonReportConfig) -> str:
    return f"{config.primary.roi_name}_vs_{config.comparison.roi_name}"


def _resolve_output_dir(config: ComparisonReportConfig) -> str:
    if config.output_dir:
        return config.output_dir
    return join(config.primary.output_directory, "comparison_reports", "latest")


def _overlap_years(config: ComparisonReportConfig) -> tuple[int, int]:
    start_year = max(config.primary.start_year, config.comparison.start_year)
    end_year = min(config.primary.end_year, config.comparison.end_year)
    if start_year > end_year:
        raise ValueError("Selected jobs do not have overlapping years")
    return start_year, end_year


def _job_paths(source: JobReportSource) -> tuple[Path, Path]:
    monthly_means_directory = Path(source.output_directory) / "monthly_means" / source.roi_name
    monthly_nan_directory = Path(source.output_directory) / "monthly_nan" / source.roi_name
    return monthly_means_directory, monthly_nan_directory


def _monthly_sums_directory(source: JobReportSource) -> Path:
    return Path(source.output_directory) / "monthly" / source.roi_name


def _subset_directory(source: JobReportSource) -> Path:
    return Path(source.output_directory) / "subset" / source.roi_name


def _get_subset_affine(source: JobReportSource):
    subset_directory = _subset_directory(source)
    for file in subset_directory.glob(f"*_{source.roi_name}_ET_subset.tif"):
        with rasterio.open(str(file)) as src:
            return src.transform
    return None


def _load_roi_polygon(roi_path: str):
    return gpd.read_file(roi_path).to_crs(WGS84).geometry[0]


def _map_tile_label(config: ComparisonReportConfig) -> str:
    if config.map_tile_mode == "yearly_total":
        return "Yearly Total"
    if config.map_tile_mode == "month":
        return calendar.month_name[config.map_tile_month]
    if config.map_tile_mode in SEASON_MONTHS:
        return f"{config.map_tile_mode.capitalize()} Total"
    return str(config.map_tile_mode)


def _months_for_tile_mode(config: ComparisonReportConfig) -> list[int]:
    if config.map_tile_mode == "month":
        return [config.map_tile_month]
    if config.map_tile_mode == "yearly_total":
        return list(range(config.start_month, config.end_month + 1))
    if config.map_tile_mode in SEASON_MONTHS:
        return [month for month in SEASON_MONTHS[config.map_tile_mode] if config.start_month <= month <= config.end_month]
    return list(range(config.start_month, config.end_month + 1))


def _combined_year_map_bounds(config: ComparisonReportConfig, year: int) -> tuple[float | None, float | None]:
    et_vmin = et_vmax = None
    for source in (config.primary, config.comparison):
        means_dir, _ = _job_paths(source)
        year_vmin, year_vmax = _calculate_year_et_bounds(means_dir, year)
        if year_vmin is None:
            continue
        et_vmin = year_vmin if et_vmin is None else min(et_vmin, year_vmin)
        et_vmax = year_vmax if et_vmax is None else max(et_vmax, year_vmax)
    return et_vmin, et_vmax


def _resolve_map_et_bounds(config: ComparisonReportConfig, year: int, et_unit) -> tuple[float, float]:
    bounds = _combined_global_bounds(config)
    if config.color_scale == "custom":
        if config.et_custom_min is None or config.et_custom_max is None:
            raise ValueError("Custom map color scale requires min and max values")
        et_vmin = et_unit.convert_to_metric(config.et_custom_min)
        et_vmax = et_unit.convert_to_metric(config.et_custom_max)
        if et_vmin >= et_vmax:
            raise ValueError("Custom map color scale max must be greater than min")
    elif config.color_scale == "per_year":
        year_et_vmin, year_et_vmax = _combined_year_map_bounds(config, year)
        et_vmin = year_et_vmin if year_et_vmin is not None else bounds["et_vmin"]
        et_vmax = year_et_vmax if year_et_vmax is not None else bounds["et_vmax"]
    else:
        et_vmin = bounds["et_vmin"]
        et_vmax = bounds["et_vmax"]

    if et_vmin is None or et_vmax is None:
        raise ValueError("Unable to determine map color scale bounds")
    if config.color_scale == "custom":
        return float(et_vmin), float(et_vmax)
    range_values = convert_to_nice_number_range(et_vmin, et_vmax, MetricETUnit())
    return float(range_values[0]), float(range_values[-1])


def _load_et_raster_for_tile(
    source: JobReportSource,
    year: int,
    config: ComparisonReportConfig,
) -> tuple[np.ndarray | None, object | None]:
    monthly_sums_directory = _monthly_sums_directory(source)
    roi_name = source.roi_name
    months = _months_for_tile_mode(config)

    if config.map_tile_mode == "month" and len(months) == 1:
        month = months[0]
        monthly_filename = monthly_sums_directory / f"{year:04d}_{month:02d}_{roi_name}_ET_monthly_sum.tif"
        if not exists(monthly_filename):
            return None, _get_subset_affine(source)
        with rasterio.open(str(monthly_filename)) as src:
            return src.read(1).astype(float), src.transform

    arrays: list[np.ndarray] = []
    affine = None
    for month in months:
        monthly_filename = monthly_sums_directory / f"{year:04d}_{month:02d}_{roi_name}_ET_monthly_sum.tif"
        if not exists(monthly_filename):
            continue
        with rasterio.open(str(monthly_filename)) as src:
            arrays.append(src.read(1).astype(float))
            if affine is None:
                affine = src.transform

    if not arrays:
        return None, affine
    return np.nansum(np.stack(arrays, axis=0), axis=0), affine


def _scale_map_bounds_for_tile_totals(
    et_vmin: float,
    et_vmax: float,
    month_count: int,
) -> tuple[float, float]:
    if month_count <= 1:
        return et_vmin, et_vmax
    scaled_vmax = et_vmax * month_count
    range_values = convert_to_nice_number_range(et_vmin, scaled_vmax, MetricETUnit())
    return float(range_values[0]), float(range_values[-1])


def _crop_axes_to_roi(ax: plt.Axes, roi_latlon) -> None:
    minx, miny, maxx, maxy = roi_latlon.bounds
    width = maxx - minx
    height = maxy - miny
    pad_x = width * 0.08 if width > 0 else 0.01
    pad_y = height * 0.08 if height > 0 else 0.01
    ax.set_xlim(minx - pad_x, maxx + pad_x)
    ax.set_ylim(miny - pad_y, maxy + pad_y)
    ax.set_aspect("equal", adjustable="box")


def _render_et_map_thumbnail(
    ax: plt.Axes,
    raster: np.ndarray | None,
    affine,
    roi_latlon,
    et_vmin: float,
    et_vmax: float,
    title: str,
    cmap,
):
    ax.get_xaxis().set_visible(False)
    ax.get_yaxis().set_visible(False)
    ax.set_title(title, loc="left", fontsize=8, pad=3)

    if raster is None or affine is None:
        ax.text(0.5, 0.5, "Unavailable", ha="center", va="center", transform=ax.transAxes, fontsize=8, color="#666666")
        for spine in ax.spines.values():
            spine.set_linewidth(0.5)
        return None

    left, bottom, right, top = array_bounds(raster.shape[0], raster.shape[1], affine)
    im = ax.imshow(
        raster,
        vmin=et_vmin,
        vmax=et_vmax,
        cmap=cmap,
        extent=(left, right, bottom, top),
        origin="upper",
    )
    ax.add_patch(generate_patch(roi_latlon))
    _crop_axes_to_roi(ax, roi_latlon)
    for spine in ax.spines.values():
        spine.set_linewidth(0.5)
    return im


def _add_map_thumbnail_colorbar(
    fig: plt.Figure,
    im,
    *,
    et_vmin: float,
    et_vmax: float,
    et_unit,
    bottom: float,
    height: float,
    margin_right: float,
) -> None:
    cbar_left = margin_right - THUMBNAIL_CBAR_WIDTH
    cbar_ax = fig.add_axes([cbar_left, bottom, THUMBNAIL_CBAR_WIDTH, height])
    cbar = fig.colorbar(im, cax=cbar_ax, ticks=[])
    display_vmin = et_unit.convert_from_metric(et_vmin)
    display_vmax = et_unit.convert_from_metric(et_vmax)
    if float(display_vmin).is_integer():
        bottom_label = str(int(display_vmin))
    else:
        bottom_label = f"{display_vmin:.1f}"
    if float(display_vmax).is_integer():
        top_label = str(int(display_vmax))
    else:
        top_label = f"{display_vmax:.1f}"
    unit_label = et_unit.abbreviation
    cbar.ax.text(0.5, -0.02, f"{bottom_label} {unit_label}", transform=cbar.ax.transAxes, ha="center", va="top", fontsize=7)
    cbar.ax.text(0.5, 1.02, f"{top_label} {unit_label}", transform=cbar.ax.transAxes, ha="center", va="bottom", fontsize=7)


def _merge_bounds(*bounds_dicts: dict[str, float | None]) -> dict[str, float | None]:
    merged: dict[str, float | None] = {
        "et_vmin": None,
        "et_vmax": None,
        "combined_abs_min": None,
        "combined_abs_max": None,
        "ppt_min": None,
        "ppt_max": None,
        "cloud_cover_min": None,
        "cloud_cover_max": None,
    }
    for bounds in bounds_dicts:
        for key in merged:
            value = bounds.get(key)
            if value is None or (isinstance(value, float) and np.isnan(value)):
                continue
            if merged[key] is None:
                merged[key] = value
            elif key.endswith("_min"):
                merged[key] = min(merged[key], value)
            else:
                merged[key] = max(merged[key], value)
    if merged["ppt_min"] is not None:
        merged["ppt_min"] = max(merged["ppt_min"], 0)
    if merged["ppt_max"] is not None and merged["ppt_min"] is not None:
        merged["ppt_max"] = max(merged["ppt_max"], merged["ppt_min"])
    return merged


def _combined_global_bounds(config: ComparisonReportConfig) -> dict[str, float | None]:
    primary_means, primary_nan = _job_paths(config.primary)
    comparison_means, comparison_nan = _job_paths(config.comparison)
    return _merge_bounds(
        _calculate_global_bounds(primary_means, primary_nan),
        _calculate_global_bounds(comparison_means, comparison_nan),
    )


def _combined_year_bounds(config: ComparisonReportConfig, year: int) -> dict[str, float | None]:
    primary_means, primary_nan = _job_paths(config.primary)
    comparison_means, comparison_nan = _job_paths(config.comparison)

    combined_abs_min = combined_abs_max = None
    ppt_min = ppt_max = None

    for means_dir, nan_dir in ((primary_means, primary_nan), (comparison_means, comparison_nan)):
        year_combined_min, year_combined_max = _calculate_year_combined_bounds(means_dir, nan_dir, year)
        if year_combined_min is not None:
            combined_abs_min = year_combined_min if combined_abs_min is None else min(combined_abs_min, year_combined_min)
        if year_combined_max is not None:
            combined_abs_max = year_combined_max if combined_abs_max is None else max(combined_abs_max, year_combined_max)

        year_ppt_min, year_ppt_max = _calculate_year_ppt_bounds(nan_dir, year)
        if year_ppt_min is not None:
            ppt_min = year_ppt_min if ppt_min is None else min(ppt_min, year_ppt_min)
        if year_ppt_max is not None:
            ppt_max = year_ppt_max if ppt_max is None else max(ppt_max, year_ppt_max)

    return {
        "combined_abs_min": combined_abs_min,
        "combined_abs_max": combined_abs_max,
        "ppt_min": ppt_min,
        "ppt_max": ppt_max,
    }


def _resolve_et_eto_bounds(
    config: ComparisonReportConfig,
    bounds: dict[str, float | None],
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
        year_bounds = _combined_year_bounds(config, year)
        return year_bounds["combined_abs_min"], year_bounds["combined_abs_max"]

    return bounds["combined_abs_min"], bounds["combined_abs_max"]


def _resolve_ppt_bounds(
    config: ComparisonReportConfig,
    bounds: dict[str, float | None],
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
        year_bounds = _combined_year_bounds(config, year)
        return year_bounds["ppt_min"], year_bounds["ppt_max"]

    return bounds["ppt_min"], bounds["ppt_max"]


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


def _combined_yearly_bounds(config: ComparisonReportConfig, start_year: int, end_year: int) -> dict[str, float | None]:
    primary_means, primary_nan = _job_paths(config.primary)
    comparison_means, comparison_nan = _job_paths(config.comparison)
    return _merge_bounds(
        calculate_yearly_totals_bounds(str(primary_means), str(primary_nan), start_year, end_year),
        calculate_yearly_totals_bounds(str(comparison_means), str(comparison_nan), start_year, end_year),
    )


def _resolve_yearly_et_eto_bounds(
    config: ComparisonReportConfig,
    yearly_bounds: dict[str, float | None],
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
        year_bounds = _combined_yearly_bounds(config, year, year)
        return year_bounds["combined_abs_min"], year_bounds["combined_abs_max"]

    return yearly_bounds["combined_abs_min"], yearly_bounds["combined_abs_max"]


def _resolve_yearly_ppt_bounds(
    config: ComparisonReportConfig,
    yearly_bounds: dict[str, float | None],
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
        year_bounds = _combined_yearly_bounds(config, year, year)
        return year_bounds["ppt_min"], year_bounds["ppt_max"]

    return yearly_bounds["ppt_min"], yearly_bounds["ppt_max"]


def get_comparison_scale_bounds(config: ComparisonReportConfig, year: int) -> dict[str, dict[str, dict[str, float | None]]]:
    global_bounds = _combined_global_bounds(config)
    year_bounds = _combined_year_bounds(config, year)

    primary_acres = round(ROI_area(config.primary.roi_path, _resolve_output_dir(config)), 2)
    et_unit = et_unit_from_name(config.et_units, acres=primary_acres)
    ppt_unit = et_unit_from_name(config.ppt_units, acres=primary_acres)

    across_et_eto_min, across_et_eto_max = _display_scale_bounds(
        global_bounds["combined_abs_min"],
        global_bounds["combined_abs_max"],
        et_unit,
    )
    per_year_et_eto_min, per_year_et_eto_max = _display_scale_bounds(
        year_bounds["combined_abs_min"],
        year_bounds["combined_abs_max"],
        et_unit,
    )
    across_ppt_min, across_ppt_max = _display_scale_bounds(global_bounds["ppt_min"], global_bounds["ppt_max"], ppt_unit)
    per_year_ppt_min, per_year_ppt_max = _display_scale_bounds(year_bounds["ppt_min"], year_bounds["ppt_max"], ppt_unit)

    year_map_vmin, year_map_vmax = _combined_year_map_bounds(config, year)
    if year_map_vmin is None:
        year_map_vmin = global_bounds["et_vmin"]
    if year_map_vmax is None:
        year_map_vmax = global_bounds["et_vmax"]
    across_map_min, across_map_max = _display_et_bounds(global_bounds["et_vmin"], global_bounds["et_vmax"], et_unit)
    per_year_map_min, per_year_map_max = _display_et_bounds(year_map_vmin, year_map_vmax, et_unit)

    return {
        "map": _bounds_group(across_map_min, across_map_max, per_year_map_min, per_year_map_max),
        "et_eto": _bounds_group(across_et_eto_min, across_et_eto_max, per_year_et_eto_min, per_year_et_eto_max),
        "ppt": _bounds_group(across_ppt_min, across_ppt_max, per_year_ppt_min, per_year_ppt_max),
    }


def _truncate_label(name: str, max_length: int = 24) -> str:
    if len(name) <= max_length:
        return name
    return name[: max_length - 3] + "..."


def _convert_year_df(df: pd.DataFrame, units, ppt_units) -> pd.DataFrame:
    converted = df.copy()
    converted["ET"] = units.convert_from_metric(converted["ET"])
    converted["PET"] = units.convert_from_metric(converted["PET"])
    if "ppt_avg" in converted.columns:
        converted["ppt_avg"] = ppt_units.convert_from_metric(converted["ppt_avg"])
    return converted


def _load_year_dataframe(
    source: JobReportSource,
    year: int,
    start_month: int,
    end_month: int,
) -> pd.DataFrame | None:
    means_dir, nan_dir = _job_paths(source)
    if not exists(means_dir / f"{year}_monthly_means.csv"):
        return None
    return _prepare_year_main_df(year, means_dir, nan_dir, start_month, end_month)


def _load_summary_dataframe(
    source: JobReportSource,
    start_year: int,
    end_year: int,
) -> pd.DataFrame:
    means_dir, nan_dir = _job_paths(source)
    frames = []
    for year in range(start_year, end_year + 1):
        mm_file = means_dir / f"{year}_monthly_means.csv"
        if not exists(mm_file):
            continue
        mm = pd.read_csv(mm_file)
        nd_file = nan_dir / f"{year}.csv"
        if exists(nd_file):
            nd = pd.read_csv(nd_file)
        else:
            nd = pd.DataFrame(columns=["year", "month", "percent_nan"])
        df = pd.merge(left=mm, right=nd, how="left", left_on="Month", right_on="month")
        if "Year" not in df.columns and "Year_x" in df.columns:
            df = df.rename(columns={"Year_x": "Year"})
        frames.append(fill_missing_report_columns(df))
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _legend_handle(color: str, linestyle: str) -> Line2D:
    if linestyle == "--":
        return Line2D(
            [0, 0.95],
            [0.5, 0.5],
            color=color,
            linestyle=(0, (3.5, 2.9)),
            linewidth=1.0,
            solid_capstyle="round",
        )
    return Line2D([0, 0.95], [0.5, 0.5], color=color, linestyle="-", linewidth=1.0)


def _cloud_legend_label(job_label: str) -> str:
    return f"{CLOUD_LEGEND_LABEL} ({job_label})"


def _apply_ordered_legend(ax: plt.Axes, entries: list[tuple[str, str, str]]) -> None:
    if not entries:
        return
    handles = [_legend_handle(color, linestyle) for _, color, linestyle in entries]
    labels = [label for label, _, _ in entries]
    ax.legend(handles, labels, loc="upper left", fontsize=8, frameon=False)


def _plot_line(
    ax: plt.Axes,
    x,
    y,
    *,
    color: str,
    linestyle: str,
    marker: str = "o",
    marker_size: float = 4,
) -> None:
    y_values = np.asarray(y, dtype=float)
    ax.plot(
        x,
        y_values,
        color=color,
        linestyle=linestyle,
        marker=marker,
        markersize=marker_size,
        linewidth=2,
    )


def _pet_label_for_year(year: int) -> str:
    return "PET" if year < OPENET_TRANSITION_DATE else "ETo"


def _resolve_plot_x(
    df: pd.DataFrame,
    fallback_x,
    month_to_idx: dict[tuple[int, int], int] | None,
) -> tuple[np.ndarray, pd.DataFrame]:
    if month_to_idx is not None:
        plot_df = df.sort_values(["Year", "Month"]).reset_index(drop=True)
        x = np.array(
            [month_to_idx.get((int(row["Year"]), int(row["Month"])), np.nan) for _, row in plot_df.iterrows()],
            dtype=float,
        )
        return x, plot_df
    if "date" in df.columns:
        return mdates.date2num(pd.to_datetime(df["date"])), df
    return np.asarray(fallback_x, dtype=float), df


def _series_x_values(df: pd.DataFrame, fallback_x) -> np.ndarray:
    x, _ = _resolve_plot_x(df, fallback_x, None)
    return x


def _month_axis_context(start_year: int, end_year: int) -> tuple[pd.DatetimeIndex, dict[tuple[int, int], int], int]:
    all_months = pd.date_range(start=f"{start_year}-01-01", end=f"{end_year}-12-31", freq="MS")
    month_to_idx = {(d.year, d.month): i for i, d in enumerate(all_months)}
    return all_months, month_to_idx, len(all_months)


def _apply_summary_x_axis(
    axes: tuple[plt.Axes, plt.Axes, plt.Axes],
    all_months: pd.DatetimeIndex,
    *,
    axis_label_fontsize: int = 12,
) -> None:
    ax, ax_precip, ax_cloud = axes
    n_months = len(all_months)
    x_tick_fontsize = axis_label_fontsize / 2
    if n_months > 12 * 10:
        x_tick_fontsize = axis_label_fontsize / 3
    elif n_months > 12 * 4:
        x_tick_fontsize = axis_label_fontsize / 2.5

    for ax_plot in axes:
        ax_plot.set_xlim(0, n_months - 1)
        ax_plot.set_xticks(range(n_months))
        ax_plot.set_xticklabels([])
        ax_plot.spines["top"].set_visible(False)
        ax_plot.spines["right"].set_visible(False)

    if n_months > 12 * 10:
        tick_indices = [i for i in range(0, n_months, 4)]
        if tick_indices[-1] != n_months - 1:
            tick_indices.append(n_months - 1)
        for ax_plot in axes:
            ax_plot.set_xticks(tick_indices)
            ax_plot.set_xticks(np.arange(0, n_months), minor=True)
            ax_plot.tick_params(axis="x", which="major", length=6)
            ax_plot.tick_params(axis="x", which="minor", length=3)
        ax_cloud.set_xticklabels(
            [all_months[i].strftime("%b %Y") for i in tick_indices],
            rotation=45,
            ha="right",
            fontsize=x_tick_fontsize,
        )
    else:
        ax_cloud.set_xticklabels(
            [d.strftime("%b %Y") for d in all_months],
            rotation=45,
            ha="right",
            fontsize=x_tick_fontsize,
        )


def _plot_et_eto_comparison(
    ax: plt.Axes,
    job_series: list[tuple[str, pd.DataFrame, str]],
    fallback_x,
    *,
    reference_year: int,
    month_to_idx: dict[tuple[int, int], int] | None = None,
) -> None:
    pet_label = _pet_label_for_year(reference_year)
    legend_entries: list[tuple[str, str, str]] = []

    for job_label, df, linestyle in job_series:
        if df.empty or "ET" not in df.columns:
            continue
        x_values, plot_df = _resolve_plot_x(df, fallback_x, month_to_idx)
        _plot_line(ax, x_values, plot_df["ET"].values, color=ET_COLOR, linestyle=linestyle)
        legend_entries.append((f"ET ({job_label})", ET_COLOR, linestyle))

    for job_label, df, linestyle in job_series:
        if df.empty or "PET" not in df.columns:
            continue
        x_values, plot_df = _resolve_plot_x(df, fallback_x, month_to_idx)
        _plot_line(ax, x_values, plot_df["PET"].values, color=PET_COLOR, linestyle=linestyle)
        legend_entries.append((f"{pet_label} ({job_label})", PET_COLOR, linestyle))

    _apply_ordered_legend(ax, legend_entries)
    ax.set(xlabel="", ylabel="")


def _plot_ppt_comparison(
    ax: plt.Axes,
    job_series: list[tuple[str, pd.DataFrame, str]],
    fallback_x,
    *,
    month_to_idx: dict[tuple[int, int], int] | None = None,
) -> None:
    legend_entries: list[tuple[str, str, str]] = []

    for job_label, df, linestyle in job_series:
        if df.empty or "ppt_avg" not in df.columns:
            continue
        x_values, plot_df = _resolve_plot_x(df, fallback_x, month_to_idx)
        _plot_line(ax, x_values, plot_df["ppt_avg"].values, color=PPT_COLOR, linestyle=linestyle)
        legend_entries.append((f"PPT ({job_label})", PPT_COLOR, linestyle))

    _apply_ordered_legend(ax, legend_entries)
    ax.set(xlabel="", ylabel="")


def _plot_cloud_comparison(
    ax: plt.Axes,
    job_series: list[tuple[str, pd.DataFrame, str]],
    fallback_x,
    *,
    month_to_idx: dict[tuple[int, int], int] | None = None,
) -> None:
    legend_entries: list[tuple[str, str, str]] = []
    has_data = False

    for job_label, df, linestyle in job_series:
        if df.empty or "percent_nan" not in df.columns or cloud_coverage_data_unavailable(df):
            continue
        has_data = True
        x_values, plot_df = _resolve_plot_x(df, fallback_x, month_to_idx)
        if linestyle == "-":
            fill_cloud_coverage_area(ax, x_values, plot_df["percent_nan"], CLOUD_COLOR)
        _plot_line(ax, x_values, plot_df["percent_nan"].values, color=CLOUD_COLOR, linestyle=linestyle)
        legend_entries.append((_cloud_legend_label(job_label), CLOUD_COLOR, linestyle))

    if has_data:
        _apply_ordered_legend(ax, legend_entries)
    else:
        ax.legend(
            [_legend_handle(CLOUD_COLOR, "-")],
            [f"{CLOUD_LEGEND_LABEL} (Unavailable)"],
            loc="upper left",
            fontsize=8,
            frameon=False,
        )
    ax.set(xlabel="", ylabel="")


def _apply_standard_chart_spines(axes: tuple[plt.Axes, ...]) -> None:
    for ax_plot in axes:
        ax_plot.spines["top"].set_visible(False)
        ax_plot.spines["right"].set_visible(False)


def _apply_year_month_x_axis(
    ax_et: plt.Axes,
    ax_ppt: plt.Axes,
    ax_cloud: plt.Axes,
    start_month: int,
    end_month: int,
    *,
    axis_label_fontsize: int = 12,
) -> None:
    months = list(range(start_month, end_month + 1))
    padding = 0.1
    x_start, x_end = months[0], months[-1]
    month_labels = [calendar.month_abbr[month] for month in months]

    for ax_plot in (ax_et, ax_ppt, ax_cloud):
        ax_plot.set_xticks(months)
        ax_plot.set_xlim(x_start - padding, x_end + padding)

    ax_et.set_xticklabels([])
    ax_ppt.set_xticklabels([])
    ax_cloud.set_xticklabels(month_labels, fontsize=axis_label_fontsize / 2)
    _apply_standard_chart_spines((ax_et, ax_ppt, ax_cloud))


def _apply_et_eto_axis(ax: plt.Axes, combined_abs_min: float, combined_abs_max: float, units) -> None:
    range_values = convert_to_nice_number_range(combined_abs_min, combined_abs_max, units)
    et_padding = 10 if units.units == "metric" else units.convert_from_metric(10)
    ax.set_ylim(0, range_values[-1] + et_padding)
    ax.set_yticks(range_values)
    ax.set_yticklabels([f"{tick} {units.abbreviation}" for tick in range_values])
    ax.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")
    ax.tick_params(axis="y", labelsize=6)
    ax.set(xlabel="", ylabel="")


def _apply_yearly_combined_x_axis(
    ax_et: plt.Axes,
    ax_ppt: plt.Axes,
    ax_cloud: plt.Axes,
    years: list[int],
    xlim: tuple[float, float],
    *,
    axis_label_fontsize: int = 12,
) -> None:
    x = list(range(len(years)))
    x_tick_fontsize = axis_label_fontsize / 2 if len(years) <= 10 else axis_label_fontsize / 2.5

    for ax_plot in (ax_et, ax_ppt, ax_cloud):
        ax_plot.set_xlim(*xlim)
        ax_plot.set_xticks(x)

    ax_et.set_xticklabels([])
    ax_ppt.set_xticklabels([])
    ax_cloud.set_xticklabels(
        [str(year) for year in years],
        rotation=45,
        ha="right",
        fontsize=x_tick_fontsize,
    )
    _apply_standard_chart_spines((ax_et, ax_ppt, ax_cloud))


def _apply_ppt_axis(ax: plt.Axes, ppt_min: float, ppt_max: float, ppt_units) -> None:
    range_values = convert_to_nice_number_range(ppt_min, ppt_max, ppt_units, subdivisions=3)
    ppt_padding = 15 if ppt_units.units == "metric" else ppt_units.convert_from_metric(15)
    ax.set_ylim(max(range_values[0], 0), range_values[-1] + ppt_padding)
    ax.set_yticks(range_values)
    ax.set_yticklabels([f"{tick} {ppt_units.abbreviation}" for tick in range_values])
    ax.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")
    ax.tick_params(axis="y", labelsize=6)
    ax.set(xlabel="", ylabel="")


def _apply_cloud_axis(ax: plt.Axes, cloud_cover_max: float) -> None:
    normalized_cloud_cover_max = cloud_cover_max if not pd.isna(cloud_cover_max) and cloud_cover_max < 100 else 100
    nice_cloud_cover_range = convert_to_nice_number_range(0, normalized_cloud_cover_max, PercentageUnits(), subdivisions=3)
    min_cloud_coverage = nice_cloud_cover_range[0]
    max_cloud_coverage = nice_cloud_cover_range[-1]
    top_gap = min(max_cloud_coverage / 2, 10)
    ax.set_ylim(min_cloud_coverage, min(max_cloud_coverage + top_gap, 100))
    ax.set_yticks(nice_cloud_cover_range)
    ax.set_yticklabels([f"{tick}%" for tick in nice_cloud_cover_range])
    ax.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")
    ax.tick_params(axis="y", labelsize=6)
    ax.set(xlabel="", ylabel="")


def _combined_cloud_bounds(config: ComparisonReportConfig) -> tuple[float, float]:
    primary_means, primary_nan = _job_paths(config.primary)
    comparison_means, comparison_nan = _job_paths(config.comparison)
    bounds = [
        _calculate_global_bounds(primary_means, primary_nan),
        _calculate_global_bounds(comparison_means, comparison_nan),
    ]
    cloud_min = min(b["cloud_cover_min"] for b in bounds)
    cloud_max = max(b["cloud_cover_max"] for b in bounds)
    return float(cloud_min), float(cloud_max)


def _add_portrait_header(
    fig: plt.Figure,
    *,
    title: str,
    line1: str,
    line2: str,
    line3: str | None = None,
) -> float:
    """Return the lowest y used by metadata so charts can sit directly beneath it."""
    title_y = 0.97
    line1_y = 0.945
    line2_y = line1_y - METADATA_LINE_GAP
    line3_y = line2_y - METADATA_LINE_GAP
    fig.suptitle(title, fontsize=14, ha="left", x=PORTRAIT_CONTENT_MARGIN_LEFT, y=title_y, fontweight="bold")
    fig.text(PORTRAIT_CONTENT_MARGIN_LEFT, line1_y, line1, fontsize=11, ha="left", va="top")
    fig.text(PORTRAIT_CONTENT_MARGIN_LEFT, line2_y, line2, fontsize=11, ha="left", va="top")
    if line3:
        fig.text(PORTRAIT_CONTENT_MARGIN_LEFT, line3_y, line3, fontsize=11, ha="left", va="top")
        return line3_y - METADATA_LINE_GAP
    return line2_y - METADATA_LINE_GAP


def _add_landscape_header(
    fig: plt.Figure,
    *,
    title: str,
    line1: str,
    line2: str,
) -> float:
    title_y = 0.97
    line1_y = 0.932
    line2_y = line1_y - LANDSCAPE_METADATA_LINE_GAP
    fig.suptitle(title, fontsize=16, ha="left", x=LANDSCAPE_CONTENT_MARGIN_LEFT, y=title_y, fontweight="bold")
    fig.text(LANDSCAPE_CONTENT_MARGIN_LEFT, line1_y, line1, fontsize=12, ha="left", va="top")
    fig.text(LANDSCAPE_CONTENT_MARGIN_LEFT, line2_y, line2, fontsize=12, ha="left", va="top")
    return line2_y - LANDSCAPE_METADATA_LINE_GAP


def _layout_three_chart_axes(
    fig: plt.Figure,
    metadata_bottom: float,
    *,
    margin_left: float,
    margin_right: float,
    chart_top: float | None = None,
) -> tuple[plt.Axes, plt.Axes, plt.Axes]:
    chart_width = margin_right - margin_left
    resolved_chart_top = metadata_bottom - CHART_TOP_PADDING if chart_top is None else chart_top
    total_height = resolved_chart_top - CHART_BOTTOM
    small_height = total_height * 0.19
    cloud_bottom = CHART_BOTTOM
    cloud_top = cloud_bottom + small_height
    ppt_bottom = cloud_top + CHART_GAP
    ppt_top = ppt_bottom + small_height
    et_bottom = ppt_top + CHART_GAP
    et_top = resolved_chart_top
    ax_et = fig.add_axes([margin_left, et_bottom, chart_width, et_top - et_bottom])
    ax_ppt = fig.add_axes([margin_left, ppt_bottom, chart_width, ppt_top - ppt_bottom])
    ax_cloud = fig.add_axes([margin_left, cloud_bottom, chart_width, cloud_top - cloud_bottom])
    return ax_et, ax_ppt, ax_cloud


def _add_portrait_year_thumbnail_axes(
    fig: plt.Figure,
    *,
    metadata_bottom: float,
) -> tuple[tuple[plt.Axes, plt.Axes], float, float]:
    margin_left = PORTRAIT_CONTENT_MARGIN_LEFT
    margin_right = PORTRAIT_CONTENT_MARGIN_RIGHT
    chart_top = metadata_bottom - CHART_TOP_PADDING
    thumbnail_top = chart_top - THUMBNAIL_TITLE_SPACE
    thumbnail_bottom = thumbnail_top - THUMBNAIL_ROW_HEIGHT
    et_chart_top = thumbnail_bottom - THUMBNAIL_BOTTOM_GAP

    tiles_right = margin_right - THUMBNAIL_CBAR_WIDTH - THUMBNAIL_CBAR_GAP
    tiles_width = tiles_right - margin_left
    tile_width = (tiles_width - THUMBNAIL_TILE_GAP) / 2

    ax_primary = fig.add_axes([margin_left, thumbnail_bottom, tile_width, thumbnail_top - thumbnail_bottom])
    ax_comparison = fig.add_axes(
        [margin_left + tile_width + THUMBNAIL_TILE_GAP, thumbnail_bottom, tile_width, thumbnail_top - thumbnail_bottom]
    )
    return (ax_primary, ax_comparison), thumbnail_bottom, et_chart_top


def _add_portrait_chart_axes(fig: plt.Figure, *, metadata_bottom: float) -> tuple[plt.Axes, plt.Axes, plt.Axes]:
    return _layout_three_chart_axes(
        fig,
        metadata_bottom,
        margin_left=PORTRAIT_CONTENT_MARGIN_LEFT,
        margin_right=PORTRAIT_CONTENT_MARGIN_RIGHT,
    )


def _add_landscape_chart_axes(fig: plt.Figure, *, metadata_bottom: float) -> tuple[plt.Axes, plt.Axes, plt.Axes]:
    return _layout_three_chart_axes(
        fig,
        metadata_bottom,
        margin_left=LANDSCAPE_CONTENT_MARGIN_LEFT,
        margin_right=LANDSCAPE_CONTENT_MARGIN_RIGHT,
    )


def _job_series_for_year(
    config: ComparisonReportConfig,
    year: int,
    et_unit,
    ppt_unit,
) -> list[tuple[str, pd.DataFrame, str]]:
    series: list[tuple[str, pd.DataFrame, str]] = []
    primary_df = _load_year_dataframe(config.primary, year, config.start_month, config.end_month)
    comparison_df = _load_year_dataframe(config.comparison, year, config.start_month, config.end_month)
    if primary_df is not None:
        primary_plot = _convert_year_df(primary_df[primary_df["Year"] == year], et_unit, ppt_unit)
        series.append((_truncate_label(config.primary.roi_name), primary_plot, "-"))
    if comparison_df is not None:
        comparison_plot = _convert_year_df(comparison_df[comparison_df["Year"] == year], et_unit, ppt_unit)
        series.append((_truncate_label(config.comparison.roi_name), comparison_plot, "--"))
    return series


def _job_series_for_summary(
    config: ComparisonReportConfig,
    start_year: int,
    end_year: int,
    et_unit,
    ppt_unit,
) -> list[tuple[str, pd.DataFrame, str]]:
    series: list[tuple[str, pd.DataFrame, str]] = []

    def _prepare_plot_df(source: JobReportSource) -> pd.DataFrame:
        df = _load_summary_dataframe(source, start_year, end_year)
        if df.empty:
            return df
        plot_df = df.copy()
        plot_df["ET"] = et_unit.convert_from_metric(plot_df["ET"])
        plot_df["PET"] = et_unit.convert_from_metric(plot_df["PET"])
        if "ppt_avg" in plot_df.columns:
            plot_df["ppt_avg"] = ppt_unit.convert_from_metric(plot_df["ppt_avg"])
        plot_df["date"] = pd.to_datetime(plot_df[["Year", "Month"]].assign(day=1))
        return plot_df

    primary_plot = _prepare_plot_df(config.primary)
    if not primary_plot.empty:
        series.append((_truncate_label(config.primary.roi_name), primary_plot, "-"))
    comparison_plot = _prepare_plot_df(config.comparison)
    if not comparison_plot.empty:
        series.append((_truncate_label(config.comparison.roi_name), comparison_plot, "--"))
    return series


def _job_series_for_yearly(
    config: ComparisonReportConfig,
    start_year: int,
    end_year: int,
    et_unit,
    ppt_unit,
) -> tuple[list[tuple[str, pd.DataFrame, str]], list[int]]:
    primary_means, primary_nan = _job_paths(config.primary)
    comparison_means, comparison_nan = _job_paths(config.comparison)
    primary_df = _load_monthly_data(str(primary_means), str(primary_nan), start_year, end_year)
    comparison_df = _load_monthly_data(str(comparison_means), str(comparison_nan), start_year, end_year)
    primary_yearly = _prepare_yearly_dataframe(primary_df, et_unit, ppt_unit) if not primary_df.empty else pd.DataFrame()
    comparison_yearly = (
        _prepare_yearly_dataframe(comparison_df, et_unit, ppt_unit) if not comparison_df.empty else pd.DataFrame()
    )
    years = sorted(
        set(primary_yearly.get("Year", pd.Series(dtype=int)).tolist())
        | set(comparison_yearly.get("Year", pd.Series(dtype=int)).tolist())
    )
    series: list[tuple[str, pd.DataFrame, str]] = []
    if not primary_yearly.empty:
        series.append((_truncate_label(config.primary.roi_name), primary_yearly, "-"))
    if not comparison_yearly.empty:
        series.append((_truncate_label(config.comparison.roi_name), comparison_yearly, "--"))
    return series, years


def generate_comparison_year_figure(
    config: ComparisonReportConfig,
    year: int,
    figure_filename: str,
    *,
    creation_date: datetime | None = None,
) -> None:
    creation_date = creation_date or datetime.today()
    primary_acres = round(ROI_area(config.primary.roi_path, dirname(figure_filename)), 2)
    comparison_acres = round(ROI_area(config.comparison.roi_path, dirname(figure_filename)), 2)
    et_unit = et_unit_from_name(config.et_units, acres=primary_acres)
    ppt_unit = et_unit_from_name(config.ppt_units, acres=primary_acres)

    job_series = _job_series_for_year(config, year, et_unit, ppt_unit)
    if not job_series:
        raise ValueError(f"No monthly data available for year {year}")

    bounds = _combined_global_bounds(config)
    combined_abs_min, combined_abs_max = _resolve_et_eto_bounds(config, bounds, year, et_unit)
    ppt_min, ppt_max = _resolve_ppt_bounds(config, bounds, year, ppt_unit)
    if combined_abs_min is None or combined_abs_max is None:
        raise ValueError("Unable to determine ET/ETo scale bounds")
    if ppt_min is None or ppt_max is None:
        raise ValueError("Unable to determine precipitation scale bounds")

    combined_abs_min = et_unit.convert_from_metric(combined_abs_min)
    combined_abs_max = et_unit.convert_from_metric(combined_abs_max)
    ppt_min = ppt_unit.convert_from_metric(ppt_min)
    ppt_max = ppt_unit.convert_from_metric(ppt_max)
    _, cloud_cover_max = _combined_cloud_bounds(config)
    et_map_vmin, et_map_vmax = _resolve_map_et_bounds(config, year, et_unit)
    tile_months = _months_for_tile_mode(config)
    if config.color_scale != "custom" and len(tile_months) > 1:
        et_map_vmin, et_map_vmax = _scale_map_bounds_for_tile_totals(et_map_vmin, et_map_vmax, len(tile_months))
    tile_label = _map_tile_label(config)
    et_cmap = LinearSegmentedColormap.from_list("ET", ET_MAP_COLORS)

    fig = plt.figure(figsize=(8.5, 11))
    title = f"ET Comparison: {config.primary.roi_name} vs {config.comparison.roi_name}"
    metadata_bottom = _add_portrait_header(
        fig,
        title=title,
        line1=f"Year: {year}",
        line2=(
            f"{config.primary.roi_name}: {primary_acres} acres  |  "
            f"{config.comparison.roi_name}: {comparison_acres} acres"
        ),
        line3=f"Created: {creation_date.date()}  Requested By: {format_requestor_name(config.requestor)}",
    )

    (ax_primary_tile, ax_comparison_tile), thumbnail_bottom, et_chart_top = _add_portrait_year_thumbnail_axes(
        fig,
        metadata_bottom=metadata_bottom,
    )
    ax, ax_precip, ax_cloud = _layout_three_chart_axes(
        fig,
        metadata_bottom,
        margin_left=PORTRAIT_CONTENT_MARGIN_LEFT,
        margin_right=PORTRAIT_CONTENT_MARGIN_RIGHT,
        chart_top=et_chart_top,
    )
    months = list(range(config.start_month, config.end_month + 1))

    primary_raster, primary_affine = _load_et_raster_for_tile(config.primary, year, config)
    comparison_raster, comparison_affine = _load_et_raster_for_tile(config.comparison, year, config)
    primary_roi = _load_roi_polygon(config.primary.roi_path)
    comparison_roi = _load_roi_polygon(config.comparison.roi_path)

    primary_im = _render_et_map_thumbnail(
        ax_primary_tile,
        primary_raster,
        primary_affine,
        primary_roi,
        et_map_vmin,
        et_map_vmax,
        f"{_truncate_label(config.primary.roi_name)}\n{tile_label}",
        et_cmap,
    )
    comparison_im = _render_et_map_thumbnail(
        ax_comparison_tile,
        comparison_raster,
        comparison_affine,
        comparison_roi,
        et_map_vmin,
        et_map_vmax,
        f"{_truncate_label(config.comparison.roi_name)}\n{tile_label}",
        et_cmap,
    )
    colorbar_image = comparison_im or primary_im
    if colorbar_image is not None:
        _add_map_thumbnail_colorbar(
            fig,
            colorbar_image,
            et_vmin=et_map_vmin,
            et_vmax=et_map_vmax,
            et_unit=et_unit,
            bottom=thumbnail_bottom,
            height=THUMBNAIL_ROW_HEIGHT,
            margin_right=PORTRAIT_CONTENT_MARGIN_RIGHT,
        )

    _plot_et_eto_comparison(ax, job_series, months, reference_year=year)
    _plot_ppt_comparison(ax_precip, job_series, months)
    _plot_cloud_comparison(ax_cloud, job_series, months)

    _apply_year_month_x_axis(ax, ax_precip, ax_cloud, config.start_month, config.end_month)

    _apply_et_eto_axis(ax, combined_abs_min, combined_abs_max, et_unit)
    _apply_ppt_axis(ax_precip, ppt_min, ppt_max, ppt_unit)
    _apply_cloud_axis(ax_cloud, cloud_cover_max)
    fig.savefig(figure_filename, dpi=150)
    plt.close(fig)
    logger.info("Saved comparison year figure %s", figure_filename)


def generate_comparison_summary_figure(
    config: ComparisonReportConfig,
    figure_filename: str,
    *,
    creation_date: datetime | None = None,
) -> None:
    creation_date = creation_date or datetime.today()
    start_year, end_year = _overlap_years(config)
    primary_acres = round(ROI_area(config.primary.roi_path, dirname(figure_filename)), 2)
    comparison_acres = round(ROI_area(config.comparison.roi_path, dirname(figure_filename)), 2)
    et_unit = et_unit_from_name(config.et_units, acres=primary_acres)
    ppt_unit = et_unit_from_name(config.ppt_units, acres=primary_acres)

    job_series = _job_series_for_summary(config, start_year, end_year, et_unit, ppt_unit)
    if not job_series:
        raise ValueError("No overlapping summary data available")

    bounds = _combined_global_bounds(config)
    combined_abs_min, combined_abs_max = _resolve_et_eto_bounds(config, bounds, end_year, et_unit)
    ppt_min, ppt_max = _resolve_ppt_bounds(config, bounds, end_year, ppt_unit)
    if combined_abs_min is None or combined_abs_max is None:
        raise ValueError("Unable to determine ET/ETo scale bounds")
    if ppt_min is None or ppt_max is None:
        raise ValueError("Unable to determine precipitation scale bounds")

    combined_abs_min = et_unit.convert_from_metric(combined_abs_min)
    combined_abs_max = et_unit.convert_from_metric(combined_abs_max)
    ppt_min = ppt_unit.convert_from_metric(ppt_min)
    ppt_max = ppt_unit.convert_from_metric(ppt_max)
    _, cloud_cover_max = _combined_cloud_bounds(config)

    fig = plt.figure(figsize=(11, 8.5))
    title = f"ET Comparison: {config.primary.roi_name} vs {config.comparison.roi_name}"
    metadata_bottom = _add_landscape_header(
        fig,
        title=title,
        line1=(
            f"Years: {start_year}-{end_year}  "
            f"{config.primary.roi_name}: {primary_acres} acres  |  "
            f"{config.comparison.roi_name}: {comparison_acres} acres"
        ),
        line2=f"Created: {creation_date.date()}  Requested By: {format_requestor_name(config.requestor)}",
    )

    ax, ax_precip, ax_cloud = _add_landscape_chart_axes(fig, metadata_bottom=metadata_bottom)
    all_months, month_to_idx, _ = _month_axis_context(start_year, end_year)
    _plot_et_eto_comparison(
        ax,
        job_series,
        None,
        reference_year=end_year,
        month_to_idx=month_to_idx,
    )
    _plot_ppt_comparison(ax_precip, job_series, None, month_to_idx=month_to_idx)
    _plot_cloud_comparison(ax_cloud, job_series, None, month_to_idx=month_to_idx)
    _apply_summary_x_axis((ax, ax_precip, ax_cloud), all_months)

    _apply_et_eto_axis(ax, combined_abs_min, combined_abs_max, et_unit)
    _apply_ppt_axis(ax_precip, ppt_min, ppt_max, ppt_unit)
    _apply_cloud_axis(ax_cloud, cloud_cover_max)
    fig.savefig(figure_filename, dpi=150)
    plt.close(fig)


def generate_comparison_yearly_combined_figure(
    config: ComparisonReportConfig,
    figure_filename: str,
    *,
    creation_date: datetime | None = None,
) -> None:
    creation_date = creation_date or datetime.today()
    start_year, end_year = _overlap_years(config)
    primary_acres = round(ROI_area(config.primary.roi_path, dirname(figure_filename)), 2)
    comparison_acres = round(ROI_area(config.comparison.roi_path, dirname(figure_filename)), 2)
    et_unit = et_unit_from_name(config.et_units, acres=primary_acres)
    ppt_unit = et_unit_from_name(config.ppt_units, acres=primary_acres)

    job_series, years = _job_series_for_yearly(config, start_year, end_year, et_unit, ppt_unit)
    if not years:
        raise ValueError("No yearly aggregate data available")

    yearly_bounds = _combined_yearly_bounds(config, start_year, end_year)
    combined_abs_min, combined_abs_max = _resolve_yearly_et_eto_bounds(config, yearly_bounds, end_year, et_unit)
    ppt_min, ppt_max = _resolve_yearly_ppt_bounds(config, yearly_bounds, end_year, ppt_unit)
    if combined_abs_min is None or combined_abs_max is None:
        raise ValueError("Unable to determine ET/ETo scale bounds")
    if ppt_min is None or ppt_max is None:
        raise ValueError("Unable to determine precipitation scale bounds")

    combined_abs_min = et_unit.convert_from_metric(combined_abs_min)
    combined_abs_max = et_unit.convert_from_metric(combined_abs_max)
    ppt_min = ppt_unit.convert_from_metric(ppt_min)
    ppt_max = ppt_unit.convert_from_metric(ppt_max)
    _, cloud_cover_max = _combined_cloud_bounds(config)

    fig = plt.figure(figsize=(11, 8.5))
    title = f"Annual ET Comparison: {config.primary.roi_name} vs {config.comparison.roi_name}"
    metadata_bottom = _add_landscape_header(
        fig,
        title=title,
        line1=(
            f"Years: {start_year}-{end_year}  "
            f"{config.primary.roi_name}: {primary_acres} acres  |  "
            f"{config.comparison.roi_name}: {comparison_acres} acres"
        ),
        line2=f"Created: {creation_date.date()}  Requested By: {format_requestor_name(config.requestor)}",
    )

    ax, ax_precip, ax_cloud = _add_landscape_chart_axes(fig, metadata_bottom=metadata_bottom)
    x = np.arange(len(years))
    xlim = _yearly_xlim(len(years))
    marker_size = 8 if len(years) == 1 else (4 if len(years) < 10 else 3)
    pet_label = _pet_label_for_year(end_year)

    def _aligned_yearly_values(yearly_df: pd.DataFrame, column: str) -> np.ndarray:
        year_map = {int(row["Year"]): row[column] for _, row in yearly_df.iterrows()} if not yearly_df.empty else {}
        return np.array([year_map.get(year, np.nan) for year in years], dtype=float)

    et_legend: list[tuple[str, str, str]] = []
    pet_legend: list[tuple[str, str, str]] = []
    ppt_legend: list[tuple[str, str, str]] = []
    cloud_legend: list[tuple[str, str, str]] = []

    for job_label, yearly_df, linestyle in job_series:
        if yearly_df.empty:
            continue
        et_values = _aligned_yearly_values(yearly_df, "ET")
        pet_values = _aligned_yearly_values(yearly_df, "PET")
        ax.plot(
            x,
            et_values,
            color=ET_COLOR,
            linestyle=linestyle,
            marker="o",
            markersize=marker_size,
            linewidth=2,
        )
        et_legend.append((f"ET ({job_label})", ET_COLOR, linestyle))
        ax.plot(
            x,
            pet_values,
            color=PET_COLOR,
            linestyle=linestyle,
            marker="o",
            markersize=marker_size,
            linewidth=2,
        )
        pet_legend.append((f"{pet_label} ({job_label})", PET_COLOR, linestyle))

        if "ppt_avg" in yearly_df.columns:
            ppt_values = _aligned_yearly_values(yearly_df, "ppt_avg")
            ax_precip.plot(
                x,
                ppt_values,
                color=PPT_COLOR,
                linestyle=linestyle,
                marker="o",
                markersize=marker_size,
                linewidth=2,
            )
            ppt_legend.append((f"PPT ({job_label})", PPT_COLOR, linestyle))

        if "percent_nan" in yearly_df.columns and not cloud_coverage_data_unavailable(yearly_df):
            cloud_values = _aligned_yearly_values(yearly_df, "percent_nan")
            if linestyle == "-":
                fill_cloud_coverage_area(ax_cloud, x, cloud_values, CLOUD_COLOR)
            ax_cloud.plot(
                x,
                cloud_values,
                color=CLOUD_COLOR,
                linestyle=linestyle,
                marker="o",
                markersize=marker_size,
                linewidth=2,
            )
            cloud_legend.append((_cloud_legend_label(job_label), CLOUD_COLOR, linestyle))

    _apply_ordered_legend(ax, et_legend + pet_legend)
    _apply_ordered_legend(ax_precip, ppt_legend)
    if cloud_legend:
        _apply_ordered_legend(ax_cloud, cloud_legend)
    else:
        ax_cloud.legend(
            [_legend_handle(CLOUD_COLOR, "-")],
            [f"{CLOUD_LEGEND_LABEL} (Unavailable)"],
            loc="upper left",
            fontsize=8,
            frameon=False,
        )

    for chart_ax in (ax, ax_precip, ax_cloud):
        chart_ax.set(xlabel="", ylabel="")

    _apply_yearly_combined_x_axis(ax, ax_precip, ax_cloud, years, xlim)

    _apply_et_eto_axis(ax, combined_abs_min, combined_abs_max, et_unit)
    _apply_ppt_axis(ax_precip, ppt_min, ppt_max, ppt_unit)
    _apply_cloud_axis(ax_cloud, cloud_cover_max)
    fig.savefig(figure_filename, dpi=150)
    plt.close(fig)


def generate_comparison_figures(
    config: ComparisonReportConfig,
    years: list[int] | None = None,
    *,
    include_summary: bool | None = None,
    include_yearly_combined: bool | None = None,
    output_dir_override: str | None = None,
    clear_output_dir: bool = True,
) -> str:
    output_dir = output_dir_override or _resolve_output_dir(config)
    if clear_output_dir and exists(output_dir):
        shutil.rmtree(output_dir)
    makedirs(output_dir, exist_ok=True)

    slug = _comparison_slug(config)
    overlap_start, overlap_end = _overlap_years(config)
    if years is None:
        target_years = list(range(overlap_start, overlap_end + 1))
    else:
        target_years = years

    should_include_summary = config.include_summary if include_summary is None else include_summary
    should_include_yearly_combined = (
        config.include_yearly_combined if include_yearly_combined is None else include_yearly_combined
    )

    for year in target_years:
        figure_filename = join(output_dir, f"{year}_{slug}.png")
        generate_comparison_year_figure(config, year, figure_filename)

    if should_include_summary:
        generate_comparison_summary_figure(config, join(output_dir, f"summary_{slug}.png"))

    if should_include_yearly_combined:
        generate_comparison_yearly_combined_figure(config, join(output_dir, f"yearly_combined_{slug}.png"))

    return output_dir


def generate_comparison_report(config: ComparisonReportConfig) -> str:
    figure_directory = generate_comparison_figures(config)
    slug = _comparison_slug(config)
    report_path = generate_custom_pdf_report(figure_directory, slug)
    append_data_documentation(report_path)
    return report_path


def _preview_cache_key(
    config: ComparisonReportConfig,
    preview_kind: PreviewKind,
    year: int | None,
    preview_version: int | None = None,
) -> str:
    payload = {
        "primary": config.primary.roi_name,
        "comparison": config.comparison.roi_name,
        "et_units": config.et_units,
        "ppt_units": config.ppt_units,
        "et_eto_scale": config.et_eto_scale,
        "et_eto_custom_min": config.et_eto_custom_min,
        "et_eto_custom_max": config.et_eto_custom_max,
        "ppt_scale": config.ppt_scale,
        "ppt_custom_min": config.ppt_custom_min,
        "ppt_custom_max": config.ppt_custom_max,
        "color_scale": config.color_scale,
        "et_custom_min": config.et_custom_min,
        "et_custom_max": config.et_custom_max,
        "map_tile_mode": config.map_tile_mode,
        "map_tile_month": config.map_tile_month,
        "preview_kind": preview_kind,
        "year": year,
        "preview_version": preview_version or COMPARISON_REPORT_PREVIEW_VERSION,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]


def _preview_cache_path(config: ComparisonReportConfig, cache_key: str) -> str:
    cache_dir = join(config.primary.output_directory, "comparison_reports", "preview_cache")
    makedirs(cache_dir, exist_ok=True)
    return join(cache_dir, f"{cache_key}.png")


def generate_comparison_preview(
    config: ComparisonReportConfig,
    preview_kind: PreviewKind = "year",
    year: int | None = None,
    *,
    force_refresh: bool = False,
    preview_version: int | None = None,
) -> str:
    resolved_preview_version = preview_version or COMPARISON_REPORT_PREVIEW_VERSION
    cache_key = _preview_cache_key(config, preview_kind, year, resolved_preview_version)
    cached_path = _preview_cache_path(config, cache_key)
    if not force_refresh and exists(cached_path):
        return cached_path

    slug = _comparison_slug(config)
    build_dir = join(config.primary.output_directory, "comparison_reports", "preview_build", cache_key)
    if exists(build_dir):
        shutil.rmtree(build_dir)
    makedirs(build_dir, exist_ok=True)

    if preview_kind == "summary":
        generate_comparison_figures(
            config,
            years=[],
            include_summary=True,
            output_dir_override=build_dir,
            clear_output_dir=False,
        )
        generated_path = join(build_dir, f"summary_{slug}.png")
    elif preview_kind == "yearly_combined":
        generate_comparison_figures(
            config,
            years=[],
            include_summary=False,
            include_yearly_combined=True,
            output_dir_override=build_dir,
            clear_output_dir=False,
        )
        generated_path = join(build_dir, f"yearly_combined_{slug}.png")
    else:
        if year is None:
            raise ValueError("Preview year is required for year comparison previews")
        generate_comparison_figures(
            config,
            years=[year],
            include_summary=False,
            output_dir_override=build_dir,
            clear_output_dir=False,
        )
        generated_path = join(build_dir, f"{year}_{slug}.png")

    shutil.copy2(generated_path, cached_path)
    return cached_path
