import pytest

pytest.importorskip("pygeos")

from pathlib import Path

import pandas as pd

from water_rights_visualizer.figure_generator import generate_all_figures


@pytest.mark.unit
class TestFigureGeneration:
    def test_generate_all_figures_creates_png_and_pdf_outputs(
        self,
        synthetic_datastore,
        test_target_geojson,
        tmp_path,
    ):
        roi_name = test_target_geojson.stem
        output_directory = tmp_path / "figure_output"
        monthly_means_directory = output_directory / "monthly_means" / roi_name
        monthly_nan_directory = output_directory / "monthly_nan" / roi_name
        monthly_sums_directory = output_directory / "monthly" / roi_name
        subset_directory = output_directory / "subset" / roi_name
        for directory in (
            monthly_means_directory,
            monthly_nan_directory,
            monthly_sums_directory,
            subset_directory,
        ):
            directory.mkdir(parents=True)

        monthly_means = pd.DataFrame(
            {
                "Year": [2021] * 12,
                "Month": list(range(1, 13)),
                "ET": [50 + month for month in range(1, 13)],
                "PET": [80 + month for month in range(1, 13)],
            }
        )
        monthly_means.to_csv(monthly_means_directory / "2021_monthly_means.csv", index=False)

        monthly_nan = pd.DataFrame(
            {
                "year": ["2021"] * 12,
                "month": list(range(1, 13)),
                "percent_nan": [10.0] * 12,
                "avg_min": [40 + month for month in range(1, 13)],
                "avg_max": [60 + month for month in range(1, 13)],
                "ppt_avg": [15 + month for month in range(1, 13)],
            }
        )
        monthly_nan.to_csv(monthly_nan_directory / "2021.csv", index=False)

        generate_all_figures(
            ROI_name=roi_name,
            ROI=str(test_target_geojson),
            output_directory=str(output_directory),
            start_year=2021,
            end_year=2021,
        )

        figure_directory = output_directory / "figures" / roi_name
        png_files = list(figure_directory.glob("*.png"))
        assert png_files, "Expected at least one figure PNG"
