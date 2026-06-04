import warnings

import pytest

from tests.support.data_quality_report import (
    build_comparison_row,
    choose_data_quality_month,
    data_quality_comparison_csv_path,
    write_data_quality_csv,
)
from tests.support.external_references import (
    OpenETApiClient,
    fetch_gridmet_monthly_mean_mm,
    fetch_ppt_monthly_mean_mm,
    fetch_s3_ppt_tile_mean_mm,
    openet_api_available,
    parse_openet_monthly_values,
)
from tests.support.report_outputs import monthly_report_rows_from_means


@pytest.mark.data_quality
class TestReferenceAverages:
    def test_sampled_month_matches_reference_sources(
        self,
        integration_report_output,
        test_target_geojson,
    ):
        year = integration_report_output["year"]
        output_directory = integration_report_output["output_directory"]
        roi_name = integration_report_output["roi_name"]
        month = choose_data_quality_month()

        report_rows = monthly_report_rows_from_means(output_directory, roi_name, year)
        report_row = next(row for row in report_rows if row.month == month)

        comparisons = []

        if openet_api_available():
            client = OpenETApiClient()
            api_rows = client.monthly_polygon_mean(
                variable="et",
                start_date=f"{year}-01-01",
                end_date=f"{year}-12-31",
                geojson_path=test_target_geojson,
            )
            api_by_month = parse_openet_monthly_values(api_rows, ("et", "ET"))
            et_reference = api_by_month.get(month)
            if et_reference is not None:
                comparisons.append(
                    build_comparison_row(
                        year=year,
                        month=month,
                        variable="ET",
                        report_mm=report_row.et_mm,
                        reference_mm=et_reference,
                        reference_source="OpenET API (ensemble)",
                        tolerance_pct=0.10,
                    )
                )

        eto_reference = fetch_gridmet_monthly_mean_mm(year, month, test_target_geojson)
        comparisons.append(
            build_comparison_row(
                year=year,
                month=month,
                variable="ETo",
                report_mm=report_row.eto_mm,
                reference_mm=eto_reference,
                reference_source="gridMET NetCDF (monthly sum)",
                tolerance_pct=0.15,
            )
        )

        ppt_reference = fetch_ppt_monthly_mean_mm(
            year,
            month,
            output_directory,
            roi_name,
            test_target_geojson,
        )
        s3_ppt_reference = fetch_s3_ppt_tile_mean_mm(
            year,
            month,
            output_directory / "data_quality_temp",
            test_target_geojson,
        )
        comparisons.append(
            build_comparison_row(
                year=year,
                month=month,
                variable="PPT",
                report_mm=report_row.ppt_mm,
                reference_mm=ppt_reference,
                reference_source="PPT nan subset (pipeline ROI mask)",
                tolerance_pct=0.01,
                upstream_reference_mm=s3_ppt_reference,
                upstream_reference_source=(
                    "S3 OREGON_STATE_PRISM PPT tile" if s3_ppt_reference is not None else None
                ),
            )
        )

        csv_path = write_data_quality_csv(
            data_quality_comparison_csv_path(year, month),
            comparisons,
        )
        latest_csv_path = write_data_quality_csv(
            csv_path.parent / "data_quality_comparison.csv",
            comparisons,
        )

        if not comparisons:
            pytest.skip("No reference comparisons were available for this run")

        warnings.warn(
            f"Data quality comparison CSV written to:\n  {csv_path}\n  {latest_csv_path}",
            UserWarning,
            stacklevel=1,
        )

        failures = [
            (
                f"{row.variable} month {row.month}: report={row.report_mm:.2f} mm, "
                f"{row.reference_source}={row.reference_mm:.2f} mm, "
                f"abs diff={row.absolute_diff_mm:.2f} mm, rel diff={row.relative_diff_pct:.1f}% "
                f"(tolerance {row.tolerance_pct:.0f}%)"
            )
            for row in comparisons
            if not row.passed
        ]
        assert not failures, "Data quality comparison failed:\n" + "\n".join(failures) + f"\nCSV: {csv_path}"
