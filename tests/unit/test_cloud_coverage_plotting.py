import io

import numpy as np
import pandas as pd
import pytest

from water_rights_visualizer.plotting_helpers import (
    cloud_coverage_data_unavailable,
    continuous_valid_segments,
    fill_missing_report_columns,
)


@pytest.mark.unit
class TestCloudCoveragePlotting:
    def test_fill_missing_report_columns_preserves_zero_and_nan_percent_nan(self):
        df = pd.DataFrame(
            {
                "percent_nan": [11.52, np.nan, 0.0, 6.9],
                "avg_min": [np.nan, 1.0, np.nan, 2.0],
                "avg_max": [np.nan, 3.0, np.nan, 4.0],
                "ppt_avg": [np.nan, 5.0, np.nan, 6.0],
            }
        )

        prepared = fill_missing_report_columns(df)

        assert prepared["percent_nan"].iloc[0] == 11.52
        assert pd.isna(prepared["percent_nan"].iloc[1])
        assert prepared["percent_nan"].iloc[2] == 0.0
        assert prepared["percent_nan"].iloc[3] == 6.9
        assert prepared["avg_min"].tolist() == [0.0, 1.0, 0.0, 2.0]
        assert prepared["avg_max"].tolist() == [0.0, 3.0, 0.0, 4.0]
        assert prepared["ppt_avg"].tolist() == [0.0, 5.0, 0.0, 6.0]

    def test_empty_percent_nan_stays_missing_after_merge(self):
        monthly_means = pd.DataFrame(
            {
                "Year": [2025] * 3,
                "Month": [1, 2, 3],
                "ET": [21.0, 24.0, 35.0],
                "PET": [83.0, 115.0, 162.0],
            }
        )
        monthly_nan = pd.read_csv(
            io.StringIO(
                "year,month,percent_nan,avg_min,avg_max,ppt_avg\n"
                "2025,1,11.52,0,0,3.4\n"
                "2025,2,,0,0,0\n"
                "2025,3,0,0,0,2.37\n"
            )
        )

        merged = pd.merge(left=monthly_means, right=monthly_nan, how="left", left_on="Month", right_on="month")
        prepared = fill_missing_report_columns(merged)

        assert prepared.loc[prepared["Month"] == 1, "percent_nan"].iloc[0] == 11.52
        assert pd.isna(prepared.loc[prepared["Month"] == 2, "percent_nan"].iloc[0])
        assert prepared.loc[prepared["Month"] == 3, "percent_nan"].iloc[0] == 0.0

    def test_cloud_coverage_data_unavailable_only_when_all_missing(self):
        assert cloud_coverage_data_unavailable(pd.DataFrame({"percent_nan": [0.0, 0.0]})) is False
        assert cloud_coverage_data_unavailable(pd.DataFrame({"percent_nan": [0.0, np.nan]})) is False
        assert cloud_coverage_data_unavailable(pd.DataFrame({"percent_nan": [np.nan, np.nan]})) is True
        assert cloud_coverage_data_unavailable(pd.DataFrame({"ET": [1.0]})) is True

    def test_continuous_valid_segments_splits_on_gaps(self):
        valid = np.array([True, True, False, True, True, True, False, True])
        assert continuous_valid_segments(valid) == [(0, 2), (3, 6), (7, 8)]
