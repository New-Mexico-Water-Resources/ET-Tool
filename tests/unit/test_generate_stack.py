import numpy as np
import pytest

pytest.importorskip("pygeos")

from datetime import date

from water_rights_visualizer.generate_stack import generate_stack
from water_rights_visualizer.file_path_source import FilepathSource
from water_rights_visualizer.process_monthly import process_monthly


@pytest.mark.unit
class TestGenerateStack:
    def test_monthly_pet_is_not_daylight_scaled(
        self,
        synthetic_datastore,
        test_roi_polygon,
        synthetic_tile_hv,
    ):
        roi_latlon = test_roi_polygon
        roi_acres = 10.0
        dates_available = [date(2021, month, 1) for month in range(1, 13)]
        input_datastore = FilepathSource(directory=str(synthetic_datastore))

        et_stack, pet_stack, affine = generate_stack(
            ROI_name="test_target",
            ROI_latlon=roi_latlon,
            year=2021,
            ROI_acres=roi_acres,
            input_datastore=input_datastore,
            subset_directory=str(synthetic_datastore / "subsets"),
            dates_available=dates_available,
            stack_filename=str(synthetic_datastore / "stack.h5"),
            use_stack=False,
            daily_interpolation=False,
        )

        june_index = 5
        june_pet = pet_stack[june_index]
        assert np.nanmean(june_pet) == pytest.approx(80.0 + 6, rel=0.01)

    def test_monthly_et_values_match_synthetic_inputs(
        self,
        synthetic_datastore,
        test_roi_polygon,
    ):
        dates_available = [date(2021, month, 1) for month in range(1, 13)]
        input_datastore = FilepathSource(directory=str(synthetic_datastore))

        et_stack, _, _ = generate_stack(
            ROI_name="test_target",
            ROI_latlon=test_roi_polygon,
            year=2021,
            ROI_acres=10.0,
            input_datastore=input_datastore,
            subset_directory=str(synthetic_datastore / "subsets"),
            dates_available=dates_available,
            stack_filename=str(synthetic_datastore / "stack.h5"),
            use_stack=False,
            daily_interpolation=False,
        )

        march_index = 2
        assert np.nanmean(et_stack[march_index]) == pytest.approx(50.0 + 3, rel=0.01)


@pytest.mark.unit
class TestProcessMonthly:
    def test_process_monthly_means_for_synthetic_stack(
        self,
        synthetic_datastore,
        test_roi_polygon,
    ):
        dates_available = [date(2021, month, 1) for month in range(1, 13)]
        input_datastore = FilepathSource(directory=str(synthetic_datastore))

        et_stack, pet_stack, affine = generate_stack(
            ROI_name="test_target",
            ROI_latlon=test_roi_polygon,
            year=2021,
            ROI_acres=10.0,
            input_datastore=input_datastore,
            subset_directory=str(synthetic_datastore / "subsets"),
            dates_available=dates_available,
            stack_filename=str(synthetic_datastore / "stack.h5"),
            use_stack=False,
            daily_interpolation=False,
        )

        monthly_means = process_monthly(
            ET_stack=et_stack,
            PET_stack=pet_stack,
            ROI_latlon=test_roi_polygon,
            ROI_name="test_target",
            subset_affine=affine,
            CRS="+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs",
            year=2021,
            monthly_sums_directory=str(synthetic_datastore / "monthly_sums"),
            monthly_means_directory=str(synthetic_datastore / "monthly_means"),
            daily_interpolation=False,
        )

        assert list(monthly_means.columns) == ["Year", "Month", "ET", "PET"]
        assert len(monthly_means) == 12
        assert monthly_means.loc[monthly_means["Month"] == 3, "ET"].iloc[0] == pytest.approx(53.0, rel=0.01)
        assert monthly_means.loc[monthly_means["Month"] == 3, "PET"].iloc[0] == pytest.approx(83.0, rel=0.01)
