import pytest

from tests.support.report_outputs import (
    EXPECTED_MONTHLY_MEANS_COLUMNS,
    read_monthly_means,
    read_monthly_nan,
)


@pytest.mark.integration
class TestEndToEndReport:
    def test_single_year_report_generation(self, integration_report_output):
        output_directory = integration_report_output["output_directory"]
        roi_name = integration_report_output["roi_name"]
        year = integration_report_output["year"]

        monthly_means = read_monthly_means(output_directory, roi_name, year)
        monthly_nan = read_monthly_nan(output_directory, roi_name, year)

        assert len(monthly_means) == 12
        assert len(monthly_nan) == 12
        assert set(monthly_means.columns) == EXPECTED_MONTHLY_MEANS_COLUMNS

        figure_directory = output_directory / "figures" / roi_name
        assert figure_directory.exists()
        assert list(figure_directory.glob("*.png"))
        assert list(figure_directory.glob("*.pdf"))

        subset_directory = output_directory / "subset" / roi_name
        assert list(subset_directory.glob("*_ET_subset.tif"))
        assert list(subset_directory.glob("*_PET_subset.tif"))
        assert list(subset_directory.glob("*_PPT_subset.tif"))
