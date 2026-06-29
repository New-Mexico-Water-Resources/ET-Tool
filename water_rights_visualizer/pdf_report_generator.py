import glob
import logging
import shutil
import subprocess
import numpy as np
from os import makedirs, remove
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


def generate_custom_pdf_report(figure_directory, ROI_name):
    """Generates a PDF report from custom-generated figures (no unit suffix in filenames)."""
    report_filename = join(figure_directory, f"{ROI_name}_Report.pdf")
    pdf = PdfPages(report_filename)

    years = get_sorted_years(figure_directory)
    for year in years:
        image_path = join(figure_directory, f"{year}_{ROI_name}.png")
        try:
            img_array = load_and_resize_image(image_path)
        except Exception as e:
            logger.error(f"Error loading image {image_path} (skipping): {e}")
            continue
        fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
        ax = fig.add_axes([0, 0, 1, 1])
        ax.imshow(img_array)
        ax.axis("off")
        pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
        plt.close(fig)

    summary_image_path = join(figure_directory, f"summary_{ROI_name}.png")
    if exists(summary_image_path):
        try:
            img_array = load_and_resize_image(summary_image_path)
            fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
            ax = fig.add_axes([0, 0, 1, 1])
            img_array = np.rot90(img_array)
            ax.imshow(img_array)
            ax.axis("off")
            pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
            plt.close(fig)
        except Exception as e:
            logger.error(f"Error loading summary image {summary_image_path} (skipping): {e}")

    yearly_combined_image_path = join(figure_directory, f"yearly_combined_{ROI_name}.png")
    if exists(yearly_combined_image_path):
        try:
            img_array = load_and_resize_image(yearly_combined_image_path)
            fig = plt.figure(figsize=(19.2, 14.4), tight_layout=True)
            ax = fig.add_axes([0, 0, 1, 1])
            img_array = np.rot90(img_array)
            ax.imshow(img_array)
            ax.axis("off")
            pdf.savefig(fig, bbox_inches="tight", pad_inches=0)
            plt.close(fig)
        except Exception as e:
            logger.error(f"Error loading yearly combined image {yearly_combined_image_path} (skipping): {e}")

    pdf.close()
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
    data_documentation_filename = join(abspath(dirname(__file__)), "et_tool_data_docs.pdf")
    if not exists(data_documentation_filename):
        logger.error("Documentation PDF not found: %s", data_documentation_filename)
        raise FileNotFoundError(f"Documentation PDF not found: {data_documentation_filename}")

    tmp_filename = f"{report_filename}.with_docs.tmp"
    try:
        merger = PdfMerger()
        merger.append(report_filename)
        merger.append(data_documentation_filename)
        merger.write(tmp_filename)
        merger.close()
        shutil.move(tmp_filename, report_filename)
    except Exception:
        if exists(tmp_filename):
            remove(tmp_filename)
        raise

    return report_filename


DOC_PREVIEW_CACHE_DIR = join(abspath(dirname(__file__)), "documentation_preview_cache")


def get_documentation_preview_cache_path(page_number: int) -> str:
    """Return the persistent cache path for a documentation preview page."""
    return join(DOC_PREVIEW_CACHE_DIR, f"page_{page_number}.png")


def render_documentation_page(page_number: int, output_png: str) -> str:
    """Render a single documentation PDF page to PNG using pdftoppm."""
    makedirs(DOC_PREVIEW_CACHE_DIR, exist_ok=True)
    cache_path = get_documentation_preview_cache_path(page_number)
    if exists(cache_path):
        if output_png != cache_path:
            shutil.copy2(cache_path, output_png)
            return output_png
        return cache_path

    pdf_path = join(abspath(dirname(__file__)), "et_tool_data_docs.pdf")
    if not exists(pdf_path):
        raise FileNotFoundError(f"Documentation PDF not found: {pdf_path}")

    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("pdftoppm is required to preview documentation pages")

    output_prefix = cache_path[:-4] if cache_path.endswith(".png") else cache_path

    result = subprocess.run(
        [
            pdftoppm,
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            "-png",
            "-singlefile",
            pdf_path,
            output_prefix,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Failed to render documentation page")

    if not exists(cache_path):
        raise RuntimeError(f"Documentation preview was not created: {cache_path}")

    if output_png != cache_path:
        makedirs(dirname(output_png), exist_ok=True)
        shutil.copy2(cache_path, output_png)

    return output_png if output_png != cache_path else cache_path


def generate_final_reports(figure_directory, ROI_name, status_filename, text_panel, root):
    """Generates final metric and imperial reports and merges data documentation into each report."""
    metric_report_filename = generate_metric_report(figure_directory, ROI_name, status_filename, text_panel, root)
    append_data_documentation(metric_report_filename)

    imperial_report_filename = generate_imperial_report(figure_directory, ROI_name, status_filename, text_panel, root)
    append_data_documentation(imperial_report_filename)

    acre_feet_report_filename = generate_acre_feet_report(figure_directory, ROI_name, status_filename, text_panel, root)
    append_data_documentation(acre_feet_report_filename)
