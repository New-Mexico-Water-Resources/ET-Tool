from datetime import datetime
from logging import getLogger
from os.path import join, exists, dirname
from os import makedirs
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
import seaborn as sns
from .write_status import write_status
from .variable_types import get_available_variable_source_for_date, OPENET_TRANSITION_DATE
from .plotting_helpers import convert_to_nice_number_range, MetricETUnit, ETUnit, PercentageUnits

logger = getLogger(__name__)


def generate_summary_figure(
    ROI_name: str,
    ROI_acres: float,
    creation_date: datetime,
    start_year: int,
    end_year: int,
    et_vmin: float,
    et_vmax: float,
    combined_abs_min: float,
    combined_abs_max: float,
    ppt_min: float,
    ppt_max: float,
    cloud_cover_min: float,
    cloud_cover_max: float,
    monthly_means_directory: str,
    monthly_nan_directory: str,
    figure_filename: str,
    status_filename: str = None,
    text_panel=None,
    root=None,
    requestor: dict[str, str] = None,
    units: ETUnit = MetricETUnit(),
):
    """
    Generate a summary figure displaying evapotranspiration data for all years in the record.

    Args:
        ROI_name (str): Name of the region of interest.
        ROI_acres (float): Area of the region of interest in acres.
        creation_date (datetime): Date of figure creation.
        start_year (int): Start year for the data.
        end_year (int): End year for the data.
        et_vmin (float): Minimum value for the color scale of the evapotranspiration data.
        et_vmax (float): Maximum value for the color scale of the evapotranspiration data.
        combined_abs_min (float): Minimum value for the color scale of the combined data.
        combined_abs_max (float): Maximum value for the color scale of the combined data.
        ppt_min (float): Minimum value for the color scale of the precipitation data.
        ppt_max (float): Maximum value for the color scale of the precipitation data.
        cloud_cover_min (float): Minimum value for the color scale of the cloud coverage data.
        cloud_cover_max (float): Maximum value for the color scale of the cloud coverage data.
        monthly_means_directory (str): Directory path for the monthly means data.
        monthly_nan_directory (str): Directory path for the monthly nan data.
        figure_filename (str): Filename for saving the generated figure.
        status_filename (str, optional): Filename for saving status messages. Defaults to None.
        text_panel (optional): Text panel for displaying messages. Defaults to None.
        root (optional): Root Tkinter window. Defaults to None.
        requestor (dict[str, str], optional): Requestor information. Defaults to None.
        units (ETUnit, optional): Units to use for the report. Defaults to MetricETUnit().
    """
    # Create a new figure in landscape orientation
    fig = plt.figure(figsize=(11, 8.5))
    et_unit = units.abbreviation
    figure_filename = (
        figure_filename if units.units == "metric" else figure_filename.replace(".png", f"_{units.abbreviation}.png")
    )

    title_fontsize = 16
    axis_label_fontsize = 12

    # Set up the title and subtitle
    requestor_name = ""
    if requestor:
        requestor_name = requestor.get("name", "")
        if not requestor_name:
            requestor_name = requestor.get("email", "")
        if not requestor_name:
            requestor_name = requestor.get("sub", "")

    if not requestor_name:
        requestor_name = "Unknown"

    title = f"Evapotranspiration For {ROI_name}"
    subtitle = f"Years: {start_year}-{end_year}  Area: {ROI_acres} acres  Created: {creation_date.date()}  Requested By: {requestor_name}"

    # Create a grid for the plots
    gs = plt.GridSpec(4, 1, height_ratios=[0.08, 0.42, 0.15, 0.15], hspace=0.3)

    # Add title and subtitle in the first row
    title_ax = fig.add_subplot(gs[0])
    title_ax.axis("off")
    fig.suptitle(title, fontsize=title_fontsize, ha="left", x=0.08, y=0.98, fontweight="bold")
    fig.text(0.08, 0.92, subtitle, fontsize=axis_label_fontsize, ha="left", fontweight="normal")

    # Add the main chart axis for ET/ETo
    ax = fig.add_subplot(gs[1])
    # Add a chart for precipitation
    ax_precip = fig.add_subplot(gs[2])
    # Add a chart for cloud coverage
    ax_cloud = fig.add_subplot(gs[3])

    # Combine all years of data
    all_data = []
    for year in range(start_year, end_year + 1):
        # Read monthly means data
        mm = pd.read_csv(f"{monthly_means_directory}/{year}_monthly_means.csv")

        # Read monthly nan data if it exists
        if exists(f"{monthly_nan_directory}/{year}.csv"):
            nd = pd.read_csv(f"{monthly_nan_directory}/{year}.csv")
        else:
            nd = pd.DataFrame(columns=["year", "month", "percent_nan"])

        # Merge the data
        df = pd.merge(left=mm, right=nd, how="left", left_on="Month", right_on="month")
        if "Year" not in df.columns and "Year_x" in df.columns:
            df = df.rename(columns={"Year_x": "Year"})
        df = df.replace(np.nan, 100)

        all_data.append(df)

    # Combine all years into one DataFrame
    main_df = pd.concat(all_data, ignore_index=True)

    # Convert units if necessary
    main_df["ET"] = units.convert_from_metric(main_df["ET"])
    main_df["PET"] = units.convert_from_metric(main_df["PET"])

    if "ppt_avg" in main_df.columns:
        main_df["ppt_avg"] = units.convert_from_metric(main_df["ppt_avg"])

    if "avg_min" in main_df.columns:
        main_df["avg_min"] = units.convert_from_metric(main_df["avg_min"])

    if "avg_max" in main_df.columns:
        main_df["avg_max"] = units.convert_from_metric(main_df["avg_max"])

    # Calculate confidence intervals
    main_df["pet_ci_ymin"] = main_df.apply(
        lambda row: (
            row["PET"] - (row["percent_nan"] / 100 * row["PET"]) if row["Year"] < OPENET_TRANSITION_DATE else row["avg_min"]
        ),
        axis=1,
    )
    main_df["pet_ci_ymax"] = main_df.apply(
        lambda row: (
            row["PET"] + (row["percent_nan"] / 100 * row["PET"]) if row["Year"] < OPENET_TRANSITION_DATE else row["avg_max"]
        ),
        axis=1,
    )

    main_df["et_ci_ymin"] = main_df.apply(
        lambda row: (
            row["ET"] - (row["percent_nan"] / 100 * row["ET"]) if row["Year"] < OPENET_TRANSITION_DATE else row["avg_min"]
        ),
        axis=1,
    )
    main_df["et_ci_ymax"] = main_df.apply(
        lambda row: (
            row["ET"] + (row["percent_nan"] / 100 * row["ET"]) if row["Year"] < OPENET_TRANSITION_DATE else row["avg_max"]
        ),
        axis=1,
    )

    # Create a datetime index for x-axis
    main_df["date"] = pd.to_datetime(main_df[["Year", "Month"]].assign(day=1))
    x = main_df["date"]

    # Create a list of all months in the date range
    all_months = pd.date_range(start=f"{start_year}-01-01", end=f"{end_year}-12-31", freq="MS")

    # Plot ET/ETo data
    pet_color = "#9e3fff"  # Purple
    et_color = "#fc8d59"  # Orange
    ppt_color = "#2C77BF"  # Blue
    marker = "o"
    marker_size = 4 if len(all_months) < 12 * 10 else 2

    # Check if ensemble range data is available
    ci_fields_exist = "et_ci_ymin" in main_df.columns and "et_ci_ymax" in main_df.columns
    is_ensemble_range_data_null = (
        not ci_fields_exist or main_df["et_ci_ymin"].isnull().all() or main_df["et_ci_ymax"].isnull().all()
    )
    if not is_ensemble_range_data_null:
        is_ensemble_range_data_null = main_df["et_ci_ymin"].eq(0).all() or main_df["et_ci_ymax"].eq(0).all()

    # Adjust PET/ETo values for years after transition date
    if end_year >= OPENET_TRANSITION_DATE:
        logger.info(f"Correcting ETo based on ET for years after {OPENET_TRANSITION_DATE}")
        # Make sure PET/ETo is never below ET_MAX or ET
        main_df["PET"] = np.maximum(main_df["PET"], main_df["et_ci_ymax"])
        main_df["PET"] = np.maximum(main_df["PET"], main_df["ET"])
        # Adjust confidence intervals
        main_df["et_ci_ymin"] = np.where(main_df["et_ci_ymin"] < main_df["ET"], main_df["et_ci_ymin"], main_df["ET"])
        main_df["et_ci_ymax"] = np.where(main_df["et_ci_ymax"] > main_df["ET"], main_df["et_ci_ymax"], main_df["ET"])

    # Plot ET/ETo data
    pet_label = "PET" if end_year < OPENET_TRANSITION_DATE else "ETo"
    sns.lineplot(
        x=main_df.index, y=main_df["PET"], ax=ax, color=pet_color, label=pet_label, marker=marker, markersize=marker_size
    )
    sns.lineplot(x=main_df.index, y=main_df["ET"], ax=ax, color=et_color, label="ET", marker=marker, markersize=marker_size)

    if not is_ensemble_range_data_null:
        ax.fill_between(main_df.index, main_df["et_ci_ymin"], main_df["et_ci_ymax"], color=et_color, alpha=0.1)

    # Plot precipitation data
    if "ppt_avg" in main_df.columns:
        sns.lineplot(
            x=main_df.index,
            y=main_df["ppt_avg"],
            ax=ax_precip,
            color=ppt_color,
            label="Precipitation",
            marker=marker,
            markersize=marker_size,
        )
        ax_precip.stackplot(main_df.index, main_df["ppt_avg"], colors=[ppt_color + "80"], labels=["Precipitation"])

    # Plot cloud coverage data
    is_confidence_data_null = (
        main_df["percent_nan"].isnull().all() or main_df["percent_nan"].eq(0).all() or main_df["percent_nan"].eq(100).all()
    )

    if not is_confidence_data_null:
        ci_color = "#7F7F7F"
        mask = main_df["percent_nan"].notna()
        sns.lineplot(
            x=main_df.index[mask],
            y=main_df["percent_nan"][mask],
            ax=ax_cloud,
            color=ci_color,
            alpha=0.8,
            lw=2,
            marker=marker,
            markersize=marker_size,
        )
        stack_data = np.ma.masked_invalid(main_df["percent_nan"].values)
        ax_cloud.stackplot(main_df.index, stack_data, colors=[ci_color + "80"])

    # Set up legends
    legend_items = {
        pet_label: {"color": pet_color, "alpha": 0.8, "lw": 2},
        "ET": {"color": et_color, "alpha": 0.8, "lw": 2},
    }

    if not is_ensemble_range_data_null:
        legend_items["Ensemble Min/Max"] = {"color": et_color, "alpha": 0.1, "lw": 4}
    else:
        legend_items["Ensemble Min/Max (Unavailable)"] = {"color": et_color, "alpha": 0.1, "lw": 4}

    legend_labels = legend_items.keys()
    legend_lines = [plt.Line2D([0], [0], color=v["color"], lw=v["lw"], alpha=v["alpha"]) for k, v in legend_items.items()]

    ax.legend(legend_lines, legend_labels, loc="upper left", fontsize=axis_label_fontsize / 2, frameon=False)

    if "ppt_avg" in main_df.columns:
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

    # Set up y-axis limits and labels
    combined_range_values = convert_to_nice_number_range(combined_abs_min, combined_abs_max, units)
    combined_abs_min = combined_range_values[0]
    combined_abs_max = combined_range_values[-1]

    et_padding = 10 if units.units == "metric" else units.convert_from_metric(10)
    adjusted_max = combined_abs_max + et_padding
    ax.set_ylim(0, adjusted_max)
    ax.set_yticks(combined_range_values)
    ax.set_yticklabels([f"{tick} {et_unit}" for tick in combined_range_values])

    if "ppt_avg" in main_df.columns and not main_df["ppt_avg"].empty and not main_df["ppt_avg"].isnull().all():
        ppt_padding = 15 if units.units == "metric" else units.convert_from_metric(15)
        ppt_range_values = convert_to_nice_number_range(ppt_min, ppt_max, units, subdivisions=3)
        ppt_min = ppt_range_values[0]
        ppt_max = ppt_range_values[-1]

        ax_precip.set_ylim(ppt_min, ppt_max + ppt_padding)
        precip_ticks = ppt_range_values
        if not precip_ticks or len(precip_ticks) == 0:
            precip_ticks = [0]
        elif len(precip_ticks) == 1:
            precip_ticks = [0, precip_ticks[0]]
        elif len(precip_ticks) == 2:
            if precip_ticks[0] == precip_ticks[1]:
                precip_ticks = [0, precip_ticks[0]]
            elif precip_ticks[1] == precip_ticks[2]:
                precip_ticks = [0, precip_ticks[1]]
    else:
        ax_precip.set_ylim(0, 0)
        precip_ticks = [0]

    ax_precip.set_yticks(precip_ticks)
    ax_precip.set_yticklabels([f"{tick} {et_unit}" for tick in precip_ticks])

    if not is_confidence_data_null:
        nice_cloud_cover_range = convert_to_nice_number_range(
            cloud_cover_min, cloud_cover_max, PercentageUnits(), subdivisions=3
        )
        min_cloud_coverage = nice_cloud_cover_range[0]
        max_cloud_coverage = nice_cloud_cover_range[-1]

        top_gap = min(max_cloud_coverage / 2, 10)
        ax_cloud.set_ylim(min_cloud_coverage, min(max_cloud_coverage + top_gap, 100))
        normalized_ticks = nice_cloud_cover_range
        ax_cloud.set_yticks(normalized_ticks)
        ax_cloud.set_yticklabels([f"{tick}%" for tick in normalized_ticks])

    # Add grid lines
    ax.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")
    ax_precip.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")
    ax_cloud.grid(True, linestyle="--", alpha=0.3, color="gray", axis="y")

    # Remove top and right spines
    for ax_plot in [ax, ax_precip, ax_cloud]:
        ax_plot.spines["top"].set_visible(False)
        ax_plot.spines["right"].set_visible(False)

    # Set up x-axis labels
    ax.set_xticks(range(len(all_months)))
    ax.set_xticklabels([])
    ax_precip.set_xticks(range(len(all_months)))
    ax_precip.set_xticklabels([])

    # Set x-axis limits to match the data range
    for ax_plot in [ax, ax_precip, ax_cloud]:
        ax_plot.set_xlim(0, len(all_months) - 1)

    # Set ticks and labels for cloud coverage plot
    ax_cloud.set_xticks(range(len(all_months)))

    # Adjust size based on total number of months
    x_tick_fontsize = axis_label_fontsize / 2
    if len(all_months) > 12 * 10:
        x_tick_fontsize = axis_label_fontsize / 3
    elif len(all_months) > 12 * 4:
        x_tick_fontsize = axis_label_fontsize / 2.5

    # Determine which ticks to show based on number of years
    if len(all_months) > 12 * 10:  # More than 10 years
        # Show ticks every 4 months, but always show first and last
        tick_indices = [i for i in range(0, len(all_months), 4)]
        if tick_indices[-1] != len(all_months) - 1:
            tick_indices.append(len(all_months) - 1)

        # Set up major and minor ticks for all plots
        for ax_plot in [ax, ax_precip, ax_cloud]:
            ax_plot.set_xticks(tick_indices)  # Major ticks every 4 months
            ax_plot.set_xticks(np.arange(0, len(all_months)), minor=True)  # Minor ticks for all months

            # Set major ticks to be longer
            ax_plot.tick_params(axis="x", which="major", length=6)
            ax_plot.tick_params(axis="x", which="minor", length=3)

        # Set the labels only for the bottom plot (cloud coverage)
        ax_cloud.set_xticklabels(
            [all_months[i].strftime("%b %Y") for i in tick_indices], rotation=45, ha="right", fontsize=x_tick_fontsize
        )
    else:
        # Show all monthly ticks
        ax_cloud.set_xticklabels(
            [d.strftime("%b %Y") for d in all_months], rotation=45, ha="right", fontsize=x_tick_fontsize
        )

    # Adjust layout to prevent x-axis labels from being cut off
    plt.subplots_adjust(left=0.08, right=0.95, top=0.95, bottom=0.1)

    ax.set_xlabel("")
    ax.set_ylabel("")
    ax_precip.set_xlabel("")
    ax_precip.set_ylabel("")
    ax_cloud.set_xlabel("")
    ax_cloud.set_ylabel("")

    # Add title
    ax.set_title(
        "Average Monthly Water Use, Precipitation, and Cloud Coverage", fontsize=axis_label_fontsize, pad=4, loc="left"
    )

    # Add caption
    start_date = datetime(start_year, 1, 1).date()
    available_et = get_available_variable_source_for_date("ET", start_date)
    if available_et and available_et.file_prefix == "OPENET_ENSEMBLE_":
        caption = f"ET and ETo calculated from Landsat with the OpenET Ensemble (Melton et al. 2021) and the Idaho EPSCOR GRIDMET (Abatzoglou 2012) models"
    else:
        caption = f"ET and PET calculated from Landsat with PT-JPL (Fisher et al. 2008)"
    caption += f"\nPrecipitation data from PRISM Climate Group, Oregon State University, https://prism.oregonstate.edu"

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

    # Save the figure
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
        message=f"Saving summary figure to {figure_filename}\n",
        status_filename=status_filename,
        text_panel=text_panel,
        root=root,
    )

    plt.savefig(figure_filename, dpi=300)
    plt.close(fig)

    logger.info("finished generating summary figure")
