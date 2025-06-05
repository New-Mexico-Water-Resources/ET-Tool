import glob
import logging
import numpy as np
from os.path import join, basename, abspath, dirname, exists
from matplotlib import pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from PIL import Image
from .write_status import write_status
from PyPDF2 import PdfMerger

logger = logging.getLogger(__name__)


def load_and_resize_image(filepath, max_size=1650):
    """Loads an image from filepath and resizes it if its largest dimension exceeds max_size, preserving aspect ratio."""
    with Image.open(filepath) as img:
        width, height = img.size
        if max(width, height) > max_size:
            scale = max_size / max(width, height)
            new_size = (int(width * scale), int(height * scale))
            img = img.resize(new_size, Image.LANCZOS)
        return np.array(img)


def get_sorted_years(figure_directory):
    """Scans the figure_directory for png files and extracts unique years from filenames."""
    png_files = glob.glob(join(figure_directory, "*.png"))
    years = []
    for filepath in png_files:
        filename = basename(filepath)
        parts = filename.split("_")
        if parts and parts[0].isdigit():
            years.append(int(parts[0]))
    return sorted(set(years))


def generate_report(figure_directory, ROI_name, units, status_filename, text_panel, root):
    """Base function to generate a PDF report with the given units."""
    filename_unit_ids = {
        "metric": "_Report",
        "imperial": "_Imperial_Report",
        "acre-feet": "_AF_Report",
    }
    input_filename_unit_ids = {
        "metric": "",
        "imperial": "_in",
        "acre-feet": "_AF",
    }

    report_filename_extension = filename_unit_ids[units]
    input_filename_extension = input_filename_unit_ids[units]

    report_filename = join(figure_directory, f"{ROI_name}{report_filename_extension}.pdf")
    pdf = PdfPages(report_filename)

    # Include individual year figures
    years = get_sorted_years(figure_directory)
    for year in years:
        image_path = join(figure_directory, f"{year}_{ROI_name}{input_filename_extension}.png")
        try:
            img_array = load_and_resize_image(image_path)
        except Exception as e:
            logger.error(f"Error loading image {image_path} (skipping): {e}")
            continue  # skip if image not found or error
        fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
        ax = fig.add_axes([0, 0, 1, 1])
        ax.imshow(img_array)
        ax.axis("off")
        pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
        plt.close(fig)

    # Check for and include summary figure if it exists
    summary_image_path = join(figure_directory, f"summary_{ROI_name}{input_filename_extension}.png")
    if exists(summary_image_path):
        try:
            img_array = load_and_resize_image(summary_image_path)
            # Swap width and height for landscape orientation
            fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
            ax = fig.add_axes([0, 0, 1, 1])
            # Rotate image 90 degrees counterclockwise for landscape
            img_array = np.rot90(img_array)
            ax.imshow(img_array)
            ax.axis("off")
            pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
            plt.close(fig)
        except Exception as e:
            logger.error(f"Error loading summary image {summary_image_path} (skipping): {e}")

    pdf.close()
    write_status(
        message=f"{units} report saved to {report_filename}\n",
        status_filename=status_filename,
        text_panel=text_panel,
        root=root,
    )
    return report_filename


def generate_metric_report(figure_directory, ROI_name, status_filename, text_panel, root):
    """Generates the metric PDF report."""
    return generate_report(figure_directory, ROI_name, "metric", status_filename, text_panel, root)


def generate_imperial_report(figure_directory, ROI_name, status_filename, text_panel, root):
    """Generates the imperial PDF report."""
    return generate_report(figure_directory, ROI_name, "imperial", status_filename, text_panel, root)


def generate_acre_feet_report(figure_directory, ROI_name, status_filename, text_panel, root):
    """Generates the acre-feet PDF report."""
    return generate_report(figure_directory, ROI_name, "acre-feet", status_filename, text_panel, root)


def append_data_documentation(report_filename):
    """Appends the data documentation to the report."""
    # Merge data documentation into each report
    data_documentation_filename = join(abspath(dirname(__file__)), "et_tool_data_docs.pdf")

    merger = PdfMerger()
    merger.append(report_filename)
    merger.append(data_documentation_filename)
    merger.write(report_filename)
    merger.close()


def generate_final_reports(figure_directory, ROI_name, status_filename, text_panel, root):
    """Generates final metric and imperial reports and merges data documentation into each report."""
    metric_report_filename = generate_metric_report(figure_directory, ROI_name, status_filename, text_panel, root)
    append_data_documentation(metric_report_filename)

    imperial_report_filename = generate_imperial_report(figure_directory, ROI_name, status_filename, text_panel, root)
    append_data_documentation(imperial_report_filename)

    acre_feet_report_filename = generate_acre_feet_report(figure_directory, ROI_name, status_filename, text_panel, root)
    append_data_documentation(acre_feet_report_filename)
