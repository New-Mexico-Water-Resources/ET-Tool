import pytest

from water_rights_visualizer.select_tiles import select_tiles


@pytest.mark.unit
class TestSelectTiles:
    def test_test_target_intersects_expected_tile(self, test_roi_polygon):
        tiles = select_tiles(test_roi_polygon)
        assert "010014" in tiles

    def test_empty_geometry_far_from_tiles_returns_no_matches(self):
        from shapely.geometry import Polygon

        far_polygon = Polygon([(-120.0, 45.0), (-119.9, 45.0), (-119.9, 45.1), (-120.0, 45.1)])
        tiles = select_tiles(far_polygon)
        assert tiles == []
