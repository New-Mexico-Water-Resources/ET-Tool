from datetime import datetime, date
from logging import getLogger
from os.path import join, exists, dirname
from os import makedirs
from tkinter import Text, Tk
from tkinter.scrolledtext import ScrolledText

import matplotlib.pyplot as plt
import calendar
import pandas as pd
import rasterio
import seaborn as sns
from affine import Affine
from matplotlib.colors import LinearSegmentedColormap, to_rgba
from shapely.geometry import Polygon
import numpy as np
from matplotlib.collections import PolyCollection


from .constants import START_MONTH, END_MONTH
from .display_image_tk import display_image_tk

# from .display_text_tk import display_text_tk
from .generate_patch import generate_patch

from .write_status import write_status
from .variable_types import get_available_variable_source_for_date, OPENET_TRANSITION_DATE

logger = getLogger(__name__)


def mm_to_in(mm: float | pd.DataFrame) -> float:
    return mm / 25.4


def generate_figure(
    ROI_name: str,
    ROI_latlon: Polygon,
    ROI_acres: float,
    creation_date: date,
    year: int,
    vmin: float,
    vmax: float,
    affine: Affine,
    main_df: pd.DataFrame,
    monthly_sums_directory: str,
    figure_filename: str,
    start_month: int = START_MONTH,
    end_month: int = END_MONTH,
    root: Tk = None,
    text_panel: ScrolledText = None,
    image_panel: Text = None,
    status_filename: str = None,
    requestor: dict[str, str] = None,
    metric_units: bool = True,
):
    """
    Generate a figure displaying evapotranspiration data for a specific region of interest (ROI).

    Args:
        ROI_name (str): Name of the region of interest.
        ROI_latlon (Polygon): Polygon representing the region of interest.
        ROI_acres (float): Area of the region of interest in acres.
        creation_date (date): Date of figure creation.
        year (int): Year for which the evapotranspiration data is generated.
        vmin (float): Minimum value for the color scale of the evapotranspiration data.
        vmax (float): Maximum value for the color scale of the evapotranspiration data.
        affine (Affine): Affine transformation for mapping coordinates to pixels.
        main_df (pd.DataFrame): DataFrame containing the main data for generating the figure.
        monthly_sums_directory (str): Directory path for the monthly sums data.
        figure_filename (str): Filename for saving the generated figure.
        start_month (int, optional): Starting month for the data. Defaults to START_MONTH.
        end_month (int, optional): Ending month for the data. Defaults to END_MONTH.
        root (Tk, optional): Root Tkinter window. Defaults to None.
        text_panel (ScrolledText, optional): Text panel for displaying messages. Defaults to None.
        image_panel (Text, optional): Image panel for displaying the generated figure. Defaults to None.
        status_filename (str, optional): Filename for saving status messages. Defaults to None.
        metric_units (bool, optional): Whether to use metric units for the report. Defaults to True.
    """

    # Create a new figure
    fig = plt.figure(figsize=(8.5, 11))
    et_unit = "mm" if metric_units else "in"
    figure_filename = figure_filename if metric_units else figure_filename.replace(".png", "_in.png")

    # title_fontsize = 14
    # axis_label_fontsize = 10
    title_fontsize = 16
    axis_label_fontsize = 12

    max_length_short = 15
    max_length_medium = 30

    requestor_name = ""
    if requestor:
        requestor_name = requestor.get("name", "")
        if not requestor_name:
            requestor_name = requestor.get("email", "")
        if not requestor_name:
            requestor_name = requestor.get("sub", "")

    if not requestor_name:
        requestor_name = "Unknown"

    if len(ROI_name) <= max_length_short:
        title = f"Evapotranspiration For {ROI_name}"
        subtitle = f"Year: {year}\nArea: {ROI_acres} acres\nCreated: {creation_date.date()}\nRequested By: {requestor_name}"
    elif len(ROI_name) <= max_length_medium:
        title_fontsize = 12
        title = f"Evapotranspiration For {ROI_name}"
        subtitle = f"Year: {year}\nArea: {ROI_acres} acres\nCreated: {creation_date.date()}\nRequested By: {requestor_name}"
    else:
        title_fontsize = 12
        short_name = ROI_name[:max_length_medium] + "..."
        title = f"Evapotranspiration For {short_name}"
        subtitle = f"Year: {year}\nArea: {ROI_acres} acres\nCreated: {creation_date.date()}\nRequested By: {requestor_name}"

    fig.suptitle(title, fontsize=title_fontsize, ha="left", x=0.125, fontweight="bold")
    fig.text(0.125, 0.895, subtitle, fontsize=axis_label_fontsize, ha="left", fontweight="normal")

    n_months = end_month - start_month + 1
    grid_cols = int(n_months / 3)
    grid_rows = int(n_months / grid_cols)

    grid = plt.GridSpec(grid_rows + 3, grid_cols, wspace=0.4, hspace=0.3)

    # Generate sub-figures for each month
    for i, month in enumerate(range(start_month, end_month + 1)):
        logger.info(f"rendering month: {month} sub-figure: {i}")
        # subfigure_title = datetime(year, month, 1).date().strftime("%Y-%m")
        subfigure_title = calendar.month_name[month]
        logger.info(f"sub-figure title: {subfigure_title}")
        ET_monthly_filename = join(monthly_sums_directory, f"{year:04d}_{month:02d}_{ROI_name}_ET_monthly_sum.tif")

        # Check if the monthly sum file exists
        if not exists(ET_monthly_filename):
            raise IOError(f"monthly sum file not found: {ET_monthly_filename}")

        # Read the monthly sum data from the file
        with rasterio.open(ET_monthly_filename, "r") as f:
            monthly = f.read(1)

        # Create a subplot for the current month
        ax = plt.subplot(grid[int(i / grid_cols), i % grid_cols])
        ax.get_xaxis().set_visible(False)
        ax.get_yaxis().set_visible(False)

        # Define the colors for the evapotranspiration data
        ET_COLORS = ["#f6e8c3", "#d8b365", "#99974a", "#53792d", "#6bdfd2", "#1839c5"]

        # Create a colormap for the evapotranspiration data
        cmap = LinearSegmentedColormap.from_list("ET", ET_COLORS)
        im = ax.imshow(monthly, vmin=vmin, vmax=vmax, cmap=cmap)
        ax.add_patch(generate_patch(ROI_latlon, affine))
        ax.set_title(subfigure_title, loc="left", fontsize=axis_label_fontsize / 2, pad=4)

        # Set the thickness of the border around the subplot
        for spine in ax.spines.values():
            spine.set_linewidth(0.5)

    # Adjust the layout of the figure
    fig.subplots_adjust(right=0.78)
    fig.subplots_adjust(top=0.88, bottom=0.075)  # Add more space at the top and bottom

    top_y = grid[0, 0].get_position(fig).y1
    bottom_y = grid[grid_rows - 1, 0].get_position(fig).y0
    cbar_height = top_y - bottom_y - 0.0085
    cbar_ax = fig.add_axes([0.85, bottom_y + 0.005, 0.05, cbar_height])
    cbar = fig.colorbar(
        im,
        cax=cbar_ax,
        ticks=[],
    )

    # Convert the min and max values to inches if necessary afte
    vmin = vmin if metric_units else mm_to_in(vmin)
    vmax = vmax if metric_units else mm_to_in(vmax)

    bottom_label = f"{round(vmin)} {et_unit}"
    top_label = f"{round(vmax)} {et_unit}"

    # Add the min and max labels without rotation
    cbar.ax.text(
        0.5,
        -0.01,
        bottom_label,  # Bottom label for min value
        transform=cbar.ax.transAxes,
        ha="center",
        va="top",
        fontsize=axis_label_fontsize / 2,
    )
    cbar.ax.text(
        0.5,
        1.01,
        top_label,  # Top label for max value
        transform=cbar.ax.transAxes,
        ha="center",
        va="bottom",
        fontsize=axis_label_fontsize / 2,
    )

    # Create a subplot for the main data
    # Get the positions for alignment
    left_x = grid[0, 0].get_position(fig).x0  # Left boundary of the grid
    right_x = cbar_ax.get_position(fig).x1  # Right boundary of the colorbar
    bottom_y = grid[grid_rows, :].get_position(fig).y0  # Bottom boundary of the grid
    top_y = grid[grid_rows, :].get_position(fig).y1  # Top boundary of the grid

    chart_start_y = bottom_y - 0.1
    gap = 0.02
    small_chart_height = 0.075
    big_chart_height = top_y - bottom_y + 0.1
    # Add the main bottom chart axis, spanning the full width to align with the colorbar
    ax = fig.add_axes([left_x, chart_start_y, right_x - left_x, big_chart_height])
    # Add a small chart below for precipitation
    ax_precip = fig.add_axes([left_x, chart_start_y - small_chart_height - gap, right_x - left_x, small_chart_height])
    # Add a small chart below for cloud coverage
    ax_cloud = fig.add_axes([left_x, chart_start_y - small_chart_height * 2 - gap * 2, right_x - left_x, small_chart_height])

    df = main_df[main_df["Year"] == year]
    x = df["Month"]

    df["ET"] = df["ET"] if metric_units else mm_to_in(df["ET"])
    df["PET"] = df["PET"] if metric_units else mm_to_in(df["PET"])

    y = df["PET"]
    y2 = df["ET"]

    if "ppt_avg" in df.columns:
        df["ppt_avg"] = df["ppt_avg"] if metric_units else mm_to_in(df["ppt_avg"])

    if "avg_min" in df.columns:
        df["avg_min"] = df["avg_min"] if metric_units else mm_to_in(df["avg_min"])

    if "avg_max" in df.columns:
        df["avg_max"] = df["avg_max"] if metric_units else mm_to_in(df["avg_max"])

    df["pet_ci_ymin"] = df.apply(
        lambda row: (
            row["PET"] - (row["percent_nan"] / 100 * row["PET"]) if row["year"] < OPENET_TRANSITION_DATE else row["avg_min"]
        ),
        axis=1,
    )
    df["pet_ci_ymax"] = df.apply(
        lambda row: (
            row["PET"] + (row["percent_nan"] / 100 * row["PET"]) if row["year"] < OPENET_TRANSITION_DATE else row["avg_max"]
        ),
        axis=1,
    )

    df["et_ci_ymin"] = df.apply(
        lambda row: (
            row["ET"] - (row["percent_nan"] / 100 * row["ET"]) if row["year"] < OPENET_TRANSITION_DATE else row["avg_min"]
        ),
        axis=1,
    )
    df["et_ci_ymax"] = df.apply(
        lambda row: (
            row["ET"] + (row["percent_nan"] / 100 * row["ET"]) if row["year"] < OPENET_TRANSITION_DATE else row["avg_max"]
        ),
        axis=1,
    )

    # pet_color = "blue"
    # et_color = "green"

    pet_color = "#9e3fff"  # Purple
    et_color = "#fc8d59"  # Orange
    ppt_color = "#2C77BF"  # Blue

    marker = "o"
    marker_size = 4

    # Check if et_ci_ymin or et_ci_ymax are NaN (ie. data missing). If so, don't plot the shaded region
    ci_fields_exist = "et_ci_ymin" in df.columns and "et_ci_ymax" in df.columns
    is_ensemble_range_data_null = not ci_fields_exist or df["et_ci_ymin"].isnull().all() or df["et_ci_ymax"].isnull().all()
    if not is_ensemble_range_data_null:
        # Check if it's all 0
        is_ensemble_range_data_null = df["et_ci_ymin"].eq(0).all() or df["et_ci_ymax"].eq(0).all()

    pet_label = "PET" if year < OPENET_TRANSITION_DATE else "ETo"

    if year >= OPENET_TRANSITION_DATE:
        logger.info(f"Correcting ETo based on ET for year {year} (ET < ETo)")
        # y = np.where(y < y2, df["et_ci_ymax"], y)
        y = np.maximum(y, df["et_ci_ymax"])
        y = np.maximum(y, y2)
        # Go through et_ci and make sure ymin is less than y2 and ymax is greater than y2, if not, set et_ci to y2
        df["et_ci_ymin"] = np.where(df["et_ci_ymin"] < y2, df["et_ci_ymin"], y2)
        df["et_ci_ymax"] = np.where(df["et_ci_ymax"] > y2, df["et_ci_ymax"], y2)

    sns.lineplot(x=x, y=y, ax=ax, color=pet_color, label=pet_label, marker=marker, markersize=marker_size)
    sns.lineplot(x=x, y=y2, ax=ax, color=et_color, label="ET", marker=marker, markersize=marker_size)
    if int(year) >= OPENET_TRANSITION_DATE and not is_ensemble_range_data_null:
        ax.fill_between(x, df["et_ci_ymin"], df["et_ci_ymax"], color=et_color, alpha=0.1)

    legend_items = {
        pet_label: {"color": pet_color, "alpha": 0.8, "lw": 2},
        "ET": {"color": et_color, "alpha": 0.8, "lw": 2},
        "Ensemble Min/Max": {"color": et_color, "alpha": 0.1, "lw": 4},
    }

    # Ensure ppt_avg is in df
    if "ppt_avg" in df.columns:
        sns.lineplot(
            x=x, y=df["ppt_avg"], ax=ax_precip, color=ppt_color, label="Precipitation", marker=marker, markersize=marker_size
        )
        ax_precip.stackplot(x, df["ppt_avg"], colors=[ppt_color + "80"], labels=["Precipitation"])

    precipitation_legend_items = {
        "Precipitation": {"color": ppt_color, "alpha": 0.8, "lw": 2},
    }

    if int(year) < OPENET_TRANSITION_DATE or is_ensemble_range_data_null:
        del legend_items["Ensemble Min/Max"]

    if is_ensemble_range_data_null:
        legend_items["Ensemble Min/Max (Unavailable)"] = {"color": et_color, "alpha": 0.1, "lw": 4}

    legend_labels = legend_items.keys()
    left_legend_lines = [
        plt.Line2D([0], [0], color=v["color"], lw=v["lw"], alpha=v["alpha"]) for k, v in legend_items.items()
    ]

    precip_legend_labels = precipitation_legend_items.keys()
    precip_legend_lines = [
        plt.Line2D([0], [0], color=v["color"], lw=v["lw"], alpha=v["alpha"]) for k, v in precipitation_legend_items.items()
    ]

    ax.legend(left_legend_lines, legend_labels, loc="upper left", fontsize=axis_label_fontsize / 2, frameon=False)
    ax_precip.legend(
        precip_legend_lines, precip_legend_labels, loc="upper left", fontsize=axis_label_fontsize / 2, frameon=False
    )
    ax.set(xlabel="", ylabel="")
    ax_precip.set(xlabel="", ylabel="")

    et_df = y2
    pet_df = y

    et_ci_ymin = df["et_ci_ymin"]
    et_ci_ymax = df["et_ci_ymax"]
    pet_ci_ymin = df["pet_ci_ymin"]
    pet_ci_ymax = df["pet_ci_ymax"]

    ymin = min(min(et_df), min(pet_df), min(pet_ci_ymin), min(et_ci_ymin))
    ymax = max(max(et_df), max(pet_df), max(pet_ci_ymax), max(et_ci_ymax))

    normalized_min = 0
    normalized_max = 100
    df["normalized_nan"] = (df["percent_nan"] - normalized_min) / (normalized_max - normalized_min) * (ymax - ymin) + ymin

    is_confidence_data_null = (
        df["percent_nan"].isnull().all() or df["percent_nan"].eq(0).all() or df["percent_nan"].eq(100).all()
    )

    if not is_confidence_data_null:
        ci_color = "#7F7F7F"
        # Mask out NaN values so they create gaps in the plot
        mask = df["percent_nan"].notna()
        sns.lineplot(
            x=x[mask],
            y=df["percent_nan"][mask],
            ax=ax_cloud,
            color=ci_color,
            alpha=0.8,
            lw=2,
            marker=marker,
            markersize=marker_size,
        )
        # For the stackplot, we need to handle NaN values differently
        # Create a masked array where NaN values are set to 0
        stack_data = np.ma.masked_invalid(df["percent_nan"].values)
        ax_cloud.stackplot(x, stack_data, colors=[ci_color + "80"])

        ax_cloud.set(xlabel="", ylabel="")
        # Only consider non-NaN values when calculating limits
        valid_data = df["percent_nan"].dropna()
        if not valid_data.empty:
            max_cloud_coverage = valid_data.max()
            top_gap = min(max_cloud_coverage / 2, 10)
            min_non_nan = valid_data.min()
            min_cloud_coverage = max(min_non_nan - 5, 0)
            ax_cloud.set_ylim(min_cloud_coverage, min(max_cloud_coverage + top_gap, 100))
            normalized_ticks = np.linspace(min_cloud_coverage, max_cloud_coverage, 3)
            ax_cloud.set_yticks(normalized_ticks)
            ax_cloud.set_yticklabels([f"{int(tick)}%" for tick in normalized_ticks])
            ax_cloud.tick_params(axis="y", labelsize=6)

    cloud_coverage_label = (
        ["Avg Cloud Coverage & Missing Data"] if year >= OPENET_TRANSITION_DATE else ["Avg Cloud Coverage & Missing Data"]
    )
    legend_labels = cloud_coverage_label if not is_confidence_data_null else ["Avg Cloud Coverage (Unavailable)"]
    legend_colors = ["gray"]
    custom_lines = [plt.Line2D([0], [0], color=legend_colors[i], lw=2, alpha=0.8) for i in range(len(legend_labels))]
    ax_cloud.legend(custom_lines, legend_labels, loc="upper left", fontsize=axis_label_fontsize / 2, frameon=False)

    et_padding = 10 if metric_units else mm_to_in(10)
    adjusted_max = ymax + et_padding
    ax.set_ylim(0, adjusted_max)

    if metric_units:
        et_ticks = np.linspace(int(ymin), int(ymax), 6)
    else:
        et_ticks = np.linspace(ymin, ymax, 6)
    ax.set_yticks(et_ticks)
    ax.set_yticklabels([f"{round(tick * 10) / 10} {et_unit}" for tick in et_ticks])

    if "ppt_avg" in df.columns and not df["ppt_avg"].empty and not df["ppt_avg"].isnull().all():
        ppt_padding = 15 if metric_units else mm_to_in(15)
        ax_precip.set_ylim(0, max(df["ppt_avg"]) + ppt_padding)
        precip_ticks = np.linspace(0, max(df["ppt_avg"]), 3)
        if precip_ticks[0] == precip_ticks[1] or precip_ticks[1] == precip_ticks[2]:
            precip_ticks = [0, precip_ticks[1]]
    else:
        ax_precip.set_ylim(0, 0)
        precip_ticks = [0]
    ax_precip.set_yticks(precip_ticks)
    ax_precip.set_yticklabels([f"{round(tick * 10) / 10} {et_unit}" for tick in precip_ticks])

    ax.tick_params(axis="y", labelsize=6)
    ax_precip.tick_params(axis="y", labelsize=6)

    ax.set_xticks([])
    ax.set_xticklabels([])

    ax_precip.set_xticks([])
    ax_precip.set_xticklabels([])

    ax_cloud.set_xticks(range(1, 13))  # Set ticks for each month (1–12)
    ax_cloud.set_xticklabels([calendar.month_abbr[i] for i in range(1, 13)], fontsize=axis_label_fontsize / 2)

    # Remove top and right spines
    ax.spines["top"].set_visible(False)
    # ax.spines["bottom"].set_visible(False)
    ax_precip.spines["top"].set_visible(False)
    # ax_precip.spines["bottom"].set_visible(False)
    ax_cloud.spines["top"].set_visible(False)

    # All right off
    ax.spines["right"].set_visible(False)
    ax_precip.spines["right"].set_visible(False)
    ax_cloud.spines["right"].set_visible(False)

    x_start, x_end = 1, 12  # January - December
    padding = 0.1

    # Standardize the x-axis limits for both subplots
    ax.set_xlim(x_start - padding, x_end + padding)
    ax_precip.set_xlim(x_start - padding, x_end + padding)
    ax_cloud.set_xlim(x_start - padding, x_end + padding)

    # Set the title and captions for the figure
    ax.set_title(
        "Average Monthly Water Use, Precipitation, and Cloud Coverage", fontsize=axis_label_fontsize, pad=4, loc="left"
    )

    start_date = datetime(year, start_month, 1).date()
    available_et = get_available_variable_source_for_date("ET", start_date)
    if available_et and available_et.file_prefix == "OPENET_ENSEMBLE_":
        caption = f"ET and ETo calculated from Landsat with the OpenET Ensemble (Melton et al. 2021) and the Idaho EPSCOR GRIDMET (Abatzoglou 2012) models"
    else:
        caption = f"ET and PET calculated from Landsat with PT-JPL (Fisher et al. 2008)"
    # caption += (
    #     f"\nCloud coverage and missing data shown as a percentage of the total number of pixels in the area of interest"
    # )
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

    end_time = datetime.now().strftime("%H%M")

    write_status(
        message=f"generate_figure end time:{end_time}\n",
        status_filename=status_filename,
        text_panel=text_panel,
        root=root,
    )

    # check to make sure the subdir exists first before writing the file(think matlab savfig does not create it?)
    subdir = dirname(figure_filename)
    if not exists(subdir):
        write_status(
            message=f"Creating subdir {subdir}\n", status_filename=status_filename, text_panel=text_panel, root=root
        )
        makedirs(subdir)

    # Display messages in the text panel
    write_status(
        message=f"Saving figure to {figure_filename}\n",
        status_filename=status_filename,
        text_panel=text_panel,
        root=root,
    )

    # Save the figure to a file
    plt.savefig(figure_filename, dpi=300)

    # Close the figure
    plt.close(fig)

    # Display the generated figure in the image panel
    display_image_tk(filename=figure_filename, image_panel=image_panel)

    logger.info("finished generating figure")
