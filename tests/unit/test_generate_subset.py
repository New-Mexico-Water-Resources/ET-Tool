import pytest

pytest.importorskip("pygeos")

from datetime import date

from water_rights_visualizer.errors import FileUnavailable
from water_rights_visualizer.file_path_source import FilepathSource
from water_rights_visualizer.generate_subset import generate_subset

from tests.support.synthetic_raster import build_synthetic_openet_year


@pytest.mark.unit
class TestGenerateSubset:
    def test_generate_subset_reuses_existing_file(self, tmp_path, test_roi_polygon, synthetic_tile_hv):
        datastore = tmp_path / "datastore"
        build_synthetic_openet_year(datastore, synthetic_tile_hv, year=2021)
        input_datastore = FilepathSource(directory=str(datastore))
        subset_directory = tmp_path / "subsets"
        subset_directory.mkdir()

        first = generate_subset(
            input_datastore=input_datastore,
            acquisition_date=date(2021, 3, 1),
            ROI_name="test_target",
            ROI_latlon=test_roi_polygon,
            ROI_acres=10.0,
            variable_name="ET",
            subset_filename=str(subset_directory / "2021.03.01_test_target_ET_subset.tif"),
        )
        second = generate_subset(
            input_datastore=input_datastore,
            acquisition_date=date(2021, 3, 1),
            ROI_name="test_target",
            ROI_latlon=test_roi_polygon,
            ROI_acres=10.0,
            variable_name="ET",
            subset_filename=str(subset_directory / "2021.03.01_test_target_ET_subset.tif"),
        )
        assert first.shape == second.shape

    def test_generate_subset_raises_for_missing_source(self, tmp_path, test_roi_polygon):
        empty_store = tmp_path / "empty"
        empty_store.mkdir()
        (empty_store / "monthly").mkdir()
        input_datastore = FilepathSource(directory=str(empty_store))

        with pytest.raises(FileUnavailable):
            generate_subset(
                input_datastore=input_datastore,
                acquisition_date=date(2021, 3, 1),
                ROI_name="test_target",
                ROI_latlon=test_roi_polygon,
                ROI_acres=10.0,
                variable_name="ET",
                subset_filename=str(tmp_path / "missing_subset.tif"),
            )
