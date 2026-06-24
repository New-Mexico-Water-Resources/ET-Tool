from datetime import datetime
from logging import getLogger
from os import makedirs
from os.path import abspath, dirname, exists, join
import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .plotting_helpers import ETUnit, MetricETUnit, PercentageUnits, convert_to_nice_number_range
from .variable_types import OPENET_TRANSITION_DATE, get_available_variable_source_for_date
from .write_status import write_status

logger = getLogger(__name__)


def _load_monthly_data(monthly_means_directory: str, monthly_nan_directory: str, start_year: int, end_year: int) -> pd.DataFrame:
    all_data = []
    for year in range(start_year, end_year + 1):
        mm = pd.read_csv(f"{monthly_means_directory}/{year}_monthly_means.csv")

        if exists(f"{monthly_nan_directory}/{year}.csv"):
            nd = pd.read_csv(f"{monthly_nan_directory}/{year}.csv")
        else:
            nd = pd.DataFrame(columns=["year", "month", "percent_nan"])

        df = pd.merge(left=mm, right=nd, how="left", left_on="Month", right_on="month")
        if "Year" not in df.columns and "Year_x" in df.columns:
            df = df.rename(columns={"Year_x": "Year"})
        all_data.append(df.replace(np.nan, 100))

    return pd.concat(all_data, ignore_index=True)


def _prepare_yearly_dataframe(main_df: pd.DataFrame, units: ETUnit, ppt_units: ETUnit) -> pd.DataFrame:
    main_df = main_df.copy()
    main_df["ET"] = units.convert_from_metric(main_df["ET"])
    main_df["PET"] = units.convert_from_metric(main_df["PET"])

    if "ppt_avg" in main_df.columns:
        main_df["ppt_avg"] = ppt_units.convert_from_metric(main_df["ppt_avg"])

    if "avg_min" in main_df.columns:
        main_df["avg_min"] = units.convert_from_metric(main_df["avg_min"])

    if "avg_max" in main_df.columns:
        main_df["avg_max"] = units.convert_from_metric(main_df["avg_max"])

    main_df["pet_ci_ymin"] = main_df.apply(
        lambda row: (
            row["PET"] - (row["percent_nan"] / 100 * row["PET"])
            if row["Year"] < OPENET_TRANSITION_DATE
            else row["avg_min"]
        ),
        axis=1,
    )
    main_df["pet_ci_ymax"] = main_df.apply(
        lambda row: (
            row["PET"] + (row["percent_nan"] / 100 * row["PET"])
            if row["Year"] < OPENET_TRANSITION_DATE
            else row["avg_max"]
        ),
        axis=1,
    )
    main_df["et_ci_ymin"] = main_df.apply(
        lambda row: (
            row["ET"] - (row["percent_nan"] / 100 * row["ET"])
            if row["Year"] < OPENET_TRANSITION_DATE
            else row["avg_min"]
        ),
        axis=1,
    )
    main_df["et_ci_ymax"] = main_df.apply(
        lambda row: (
            row["ET"] + (row["percent_nan"] / 100 * row["ET"])
            if row["Year"] < OPENET_TRANSITION_DATE
            else row["avg_max"]
        ),
        axis=1,
    )

    agg_map = {
        "ET": "sum",
        "PET": "sum",
        "et_ci_ymin": "sum",
        "et_ci_ymax": "sum",
        "percent_nan": "mean",
    }
    if "ppt_avg" in main_df.columns:
        agg_map["ppt_avg"] = "sum"

    yearly_df = main_df.groupby("Year", as_index=False).agg(agg_map)
    yearly_df["et_ci_ymin"] = np.where(yearly_df["et_ci_ymin"] < yearly_df["ET"], yearly_df["et_ci_ymin"], yearly_df["ET"])
    yearly_df["et_ci_ymax"] = np.where(yearly_df["et_ci_ymax"] > yearly_df["ET"], yearly_df["et_ci_ymax"], yearly_df["ET"])
    return yearly_df.sort_values("Year").reset_index(drop=True)


def _yearly_xlim(num_years: int) -> tuple[float, float]:
    if num_years <= 1:
        return (-0.5, 0.5)
    return (0, num_years - 1)


def _yearly_metric_totals(main_df: pd.DataFrame) -> pd.DataFrame:
    agg_map = {"ET": "sum", "PET": "sum"}
    if "ppt_avg" in main_df.columns:
        agg_map["ppt_avg"] = "sum"
    return main_df.groupby("Year", as_index=False).agg(agg_map)


def generate_yearly_combined_figure(
    ROI_name: str,
    ROI_acres: float,
    creation_date: datetime,
    start_year: int,
    end_year: int,
    monthly_means_directory: str,
    monthly_nan_directory: str,
    figure_filename: str,
    status_filename: str = None,
    text_panel=None,
    root=None,
    requestor: dict[str, str] = None,
    units: ETUnit = MetricETUnit(),
    ppt_units: ETUnit = None,
    plain_filename: bool = False,
    combined_abs_min: float | None = None,
    combined_abs_max: float | None = None,
    ppt_min: float | None = None,
    ppt_max: float | None = None,
):
    if ppt_units is None:
        ppt_units = units

    fig = plt.figure(figsize=(11, 8.5))
    et_unit = units.abbreviation
    ppt_unit = ppt_units.abbreviation
    figure_filename = (
        figure_filename
        if plain_filename or units.units == "metric"
        else figure_filename.replace(".png", f"_{units.abbreviation}.png")
    )

    title_fontsize = 16
    axis_label_fontsize = 12

    requestor_name = ""
    if requestor:
        requestor_name = requestor.get("name", "") or requestor.get("email", "") or requestor.get("sub", "")
    if not requestor_name:
        requestor_name = "Unknown"

    title = f"Evapotranspiration For {ROI_name}"
    subtitle = (
        f"Years: {start_year}-{end_year}  Area: {ROI_acres} acres  "
        f"Created: {creation_date.date()}  Requested By: {requestor_name}"
    )

    gs = plt.GridSpec(4, 1, height_ratios=[0.08, 0.42, 0.15, 0.15], hspace=0.3)
    title_ax = fig.add_subplot(gs[0])
    title_ax.axis("off")
    fig.suptitle(title, fontsize=title_fontsize, ha="left", x=0.08, y=0.98, fontweight="bold")
    fig.text(0.08, 0.92, subtitle, fontsize=axis_label_fontsize, ha="left", fontweight="normal")

    ax = fig.add_subplot(gs[1])
    ax_precip = fig.add_subplot(gs[2])
    ax_cloud = fig.add_subplot(gs[3])

    main_df = _load_monthly_data(monthly_means_directory, monthly_nan_directory, start_year, end_year)
    yearly_metric = _yearly_metric_totals(main_df)
    yearly_df = _prepare_yearly_dataframe(main_df, units, ppt_units)
    years = yearly_df["Year"].astype(int).tolist()
    x = np.arange(len(years))
    xlim = _yearly_xlim(len(years))
    marker = "o"
    marker_size = 8 if len(years) == 1 else (4 if len(years) < 10 else 3)

    pet_color = "#9e3fff"
    et_color = "#fc8d59"
    ppt_color = "#2C77BF"

    ci_fields_exist = "et_ci_ymin" in yearly_df.columns and "et_ci_ymax" in yearly_df.columns
    is_ensemble_range_data_null = (
        not ci_fields_exist or yearly_df["et_ci_ymin"].isnull().all() or yearly_df["et_ci_ymax"].isnull().all()
    )
    if not is_ensemble_range_data_null:
        is_ensemble_range_data_null = yearly_df["et_ci_ymin"].eq(0).all() or yearly_df["et_ci_ymax"].eq(0).all()

    pet_label = "PET" if end_year < OPENET_TRANSITION_DATE else "ETo"
    ax.plot(x, yearly_df["PET"], color=pet_color, label=pet_label, marker=marker, markersize=marker_size, linewidth=2)
    ax.plot(x, yearly_df["ET"], color=et_color, label="ET", marker=marker, markersize=marker_size, linewidth=2)

    if not is_ensemble_range_data_null:
        ax.fill_between(x, yearly_df["et_ci_ymin"], yearly_df["et_ci_ymax"], color=et_color, alpha=0.1)

    if "ppt_avg" in yearly_df.columns:
        ax_precip.plot(
            x,
            yearly_df["ppt_avg"],
            color=ppt_color,
            label="Precipitation",
            marker=marker,
            markersize=marker_size,
            linewidth=2,
        )
        ax_precip.stackplot(x, yearly_df["ppt_avg"], colors=[ppt_color + "80"], labels=["Precipitation"])

    is_confidence_data_null = (
        yearly_df["percent_nan"].isnull().all()
        or yearly_df["percent_nan"].eq(0).all()
        or yearly_df["percent_nan"].eq(100).all()
    )

    if not is_confidence_data_null:
        ci_color = "#7F7F7F"
        ax_cloud.plot(
            x,
            yearly_df["percent_nan"],
            color=ci_color,
            alpha=0.8,
            linewidth=2,
            marker=marker,
            markersize=marker_size,
        )
        stack_data = np.ma.masked_invalid(yearly_df["percent_nan"].values)
        ax_cloud.stackplot(x, stack_data, colors=[ci_color + "80"])

    legend_items = {
        pet_label: {"color": pet_color, "alpha": 0.8, "lw": 2},
        "ET": {"color": et_color, "alpha": 0.8, "lw": 2},
    }
    if not is_ensemble_range_data_null:
        legend_items["Ensemble Min/Max"] = {"color": et_color, "alpha": 0.1, "lw": 4}
    else:
        legend_items["Ensemble Min/Max (Unavailable)"] = {"color": et_color, "alpha": 0.1, "lw": 4}

    legend_labels = legend_items.keys()
    legend_lines = [plt.Line2D([0], [0], color=v["color"], lw=v["lw"], alpha=v["alpha"]) for v in legend_items.values()]
    ax.legend(legend_lines, legend_labels, loc="upper left", fontsize=axis_label_fontsize / 2, frameon=False)

    if "ppt_avg" in yearly_df.columns:
        ax_precip.legend(
            [plt.Line2D([0], [0], color=ppt_color, lw=2, alpha=0.8)],
            ["Precipitation"],
            loc="upper left",
            fontsize=axis_label_fontsize / 2,
            frameon=False,
        )

    cloud_coverage_label = ["Avg Cloud Coverage & Missing Data"]
    if is_confidence_data_null:
        cloud_coverage_label = ["Avg Cloud Coverage (Unavailable)"]

    ax_cloud.legend(
        [plt.Line2D([0], [0], color="#7F7F7F", lw=2, alpha=0.8)],
        cloud_coverage_label,
        loc="upper left",
        fontsize=axis_label_fontsize / 2,
        frameon=False,
    )

    if combined_abs_max is not None:
        combined_abs_max = units.convert_from_metric(combined_abs_max)
    else:
        combined_abs_max = float(
            np.nanmax(np.concatenate([yearly_metric["ET"].values, yearly_metric["PET"].values]))
        )
    combined_range_values = convert_to_nice_number_range(0, combined_abs_max, units)
    top_tick = combined_range_values[-1]
    if units.units == "metric":
        headroom = max(150, top_tick * 0.25)
    elif units.units == "imperial":
        headroom = max(15, top_tick * 0.25)
    else:
        headroom = max(units.convert_from_metric(10), top_tick * 0.15)

    ax.set_ylim(0, top_tick + headroom)
    ax.set_yticks(combined_range_values)
    ax.set_yticklabels([f"{tick} {et_unit}" for tick in combined_range_values])

    if "ppt_avg" in yearly_df.columns and not yearly_df["ppt_avg"].empty and not yearly_df["ppt_avg"].isnull().all():
        if ppt_max is not None:
            ppt_max_metric = ppt_units.convert_from_metric(ppt_max)
        else:
            ppt_max_metric = float(yearly_metric["ppt_avg"].max())
        ppt_range_values = convert_to_nice_number_range(0, ppt_max_metric, ppt_units, subdivisions=3)
        ppt_top_tick = ppt_range_values[-1]
        if ppt_units.units == "metric":
            ppt_headroom = max(15, ppt_top_tick * 0.1)
        elif ppt_units.units == "imperial":
            ppt_headroom = max(15, ppt_top_tick * 0.25)
        else:
            ppt_headroom = max(ppt_units.convert_from_metric(15), ppt_top_tick * 0.15)
        ax_precip.set_ylim(0, ppt_top_tick + ppt_headroom)
        precip_ticks = list(ppt_range_values)
        if len(precip_ticks) == 0:
            precip_ticks = [0]
        elif len(precip_ticks) == 1:
            precip_ticks = [0, precip_ticks[0]]
        elif len(precip_ticks) >= 2 and precip_ticks[0] == precip_ticks[1]:
            precip_ticks = [0, precip_ticks[0]]
        elif len(precip_ticks) >= 3 and precip_ticks[1] == precip_ticks[2]:
            precip_ticks = [0, precip_ticks[1]]
    else:
        ax_precip.set_ylim(0, 1)
        precip_ticks = [0]

    ax_precip.set_yticks(precip_ticks)
    ax_precip.set_yticklabels([f"{tick} {ppt_unit}" for tick in precip_ticks])

    if not is_confidence_data_null:
        cloud_cover_max = float(yearly_df["percent_nan"].max())
        nice_cloud_cover_range = convert_to_nice_number_range(
            0, max(cloud_cover_max, 1), PercentageUnits(), subdivisions=3
        )
        ax_cloud.set_ylim(0, 100)
        ax_cloud.set_yticks(nice_cloud_cover_range)
        ax_cloud.set_yticklabels([f"{tick}%" for tick in nice_cloud_cover_range])

    for ax_plot in [ax, ax_precip, ax_cloud]:
        ax_plot.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")
        ax_plot.spines["top"].set_visible(False)
        ax_plot.spines["right"].set_visible(False)
        ax_plot.set_xlim(*xlim)

    ax.set_xticks(x)
    ax.set_xticklabels([])
    ax_precip.set_xticks(x)
    ax_precip.set_xticklabels([])

    x_tick_fontsize = axis_label_fontsize / 2 if len(years) <= 10 else axis_label_fontsize / 2.5
    ax_cloud.set_xticks(x)
    ax_cloud.set_xticklabels([str(year) for year in years], rotation=45, ha="right", fontsize=x_tick_fontsize)

    plt.subplots_adjust(left=0.08, right=0.95, top=0.95, bottom=0.1)
    ax.set_title("Annual Total Water Use, Precipitation, and Cloud Coverage", fontsize=axis_label_fontsize, pad=4, loc="left")

    start_date = datetime(start_year, 1, 1).date()
    available_et = get_available_variable_source_for_date("ET", start_date)
    if available_et and available_et.file_prefix == "OPENET_ENSEMBLE_":
        caption = (
            "Annual ET and ETo totals calculated from Landsat with the OpenET Ensemble "
            "(Melton et al. 2021) and the Idaho EPSCOR GRIDMET (Abatzoglou 2012) models"
        )
    else:
        caption = "Annual ET and PET totals calculated from Landsat with PT-JPL (Fisher et al. 2008)"
    caption += "\nPrecipitation data from PRISM Climate Group, Oregon State University, https://prism.oregonstate.edu"

    try:
        project_root = dirname(dirname(abspath(__file__)))
        package_json_path = join(project_root, "client", "package.json")
        with open(package_json_path, "r", encoding="utf-8") as f:
            version = json.load(f).get("version", "unknown")
            caption += f" (ET Tool version {version})"
    except Exception:
        pass

    plt.figtext(
        0.48,
        0.005,
        caption,
        wrap=True,
        linespacing=1.5,
        verticalalignment="bottom",
        horizontalalignment="center",
        fontsize=axis_label_fontsize / 2,
    )

    plt.tight_layout()

    ax.set_xlabel("")
    ax.set_ylabel("")
    ax_precip.set_xlabel("")
    ax_precip.set_ylabel("")
    ax_cloud.set_xlabel("")
    ax_cloud.set_ylabel("")

    subdir = dirname(figure_filename)
    if not exists(subdir):
        write_status(
            message=f"Creating subdir {subdir}\n",
            status_filename=status_filename,
            text_panel=text_panel,
            root=root,
        )
        makedirs(subdir)

    write_status(
        message=f"Saving yearly combined figure to {figure_filename}\n",
        status_filename=status_filename,
        text_panel=text_panel,
        root=root,
    )

    plt.savefig(figure_filename, dpi=300)
    plt.close(fig)
    logger.info("finished generating yearly combined figure")
