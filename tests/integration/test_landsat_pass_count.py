import pytest

from water_rights_visualizer.landsat_pass_count import count_landsat_passes_for_month


@pytest.mark.integration
class TestLandsatPassCount:
    def test_landsat_pass_count_returns_non_negative_integer(self, test_roi_polygon, tmp_path):
        pass_count = count_landsat_passes_for_month(
            roi=test_roi_polygon,
            month=6,
            year=2021,
            subset_directory=str(tmp_path / "landsat_cache"),
        )
        assert isinstance(pass_count, int)
        assert pass_count >= 0
        assert pass_count <= 31

    def test_landsat_pass_count_uses_cache_on_second_call(self, test_roi_polygon, tmp_path):
        cache_dir = tmp_path / "landsat_cache"
        first = count_landsat_passes_for_month(
            roi=test_roi_polygon,
            month=7,
            year=2021,
            subset_directory=str(cache_dir),
        )
        second = count_landsat_passes_for_month(
            roi=test_roi_polygon,
            month=7,
            year=2021,
            subset_directory=str(cache_dir),
        )
        assert first == second
