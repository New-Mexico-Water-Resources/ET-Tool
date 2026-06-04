import pytest

from tests.support.paths import MAX_ET_MM_PER_MONTH, MAX_ETO_MM_PER_MONTH, MAX_PPT_MM_PER_MONTH
from tests.support.report_outputs import (
    assert_combined_csv_structure,
    assert_monthly_value_ranges,
    read_combined_csv,
    read_monthly_means,
    read_monthly_nan,
)


@pytest.mark.integration
class TestReportProducts:
    def test_monthly_means_values_are_within_expected_ranges(self, integration_report_output):
        monthly_means = read_monthly_means(
            integration_report_output["output_directory"],
            integration_report_output["roi_name"],
            integration_report_output["year"],
        )
        assert_monthly_value_ranges(monthly_means, max_mm=MAX_ET_MM_PER_MONTH)

    def test_monthly_nan_precipitation_is_non_negative(self, integration_report_output):
        monthly_nan = read_monthly_nan(
            integration_report_output["output_directory"],
            integration_report_output["roi_name"],
            integration_report_output["year"],
        )
        assert (monthly_nan["ppt_avg"].fillna(0) >= 0).all()
        assert (monthly_nan["ppt_avg"].fillna(0) <= MAX_PPT_MM_PER_MONTH).all()

    def test_combined_csv_has_expected_headers(self, integration_report_output):
        combined = read_combined_csv(
            integration_report_output["output_directory"],
            integration_report_output["roi_name"],
        )
        assert_combined_csv_structure(combined)

    def test_eto_values_are_non_negative(self, integration_report_output):
        monthly_means = read_monthly_means(
            integration_report_output["output_directory"],
            integration_report_output["roi_name"],
            integration_report_output["year"],
        )
        assert (monthly_means["PET"] >= 0).all()
        assert (monthly_means["PET"] <= MAX_ETO_MM_PER_MONTH).all()

    def test_et_min_is_not_greater_than_et_max(self, integration_report_output):
        monthly_nan = read_monthly_nan(
            integration_report_output["output_directory"],
            integration_report_output["roi_name"],
            integration_report_output["year"],
        )
        valid_rows = monthly_nan.dropna(subset=["avg_min", "avg_max"])
        if valid_rows.empty:
            pytest.skip("No ET min/max values available for this year")
        assert (valid_rows["avg_min"] <= valid_rows["avg_max"]).all()
