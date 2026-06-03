import pytest
from affine import Affine
from rasterio.transform import array_bounds
from shapely.geometry import Polygon

from water_rights_visualizer.constants import WGS84
from water_rights_visualizer.generate_patch import generate_patch
from raster import RasterGrid


def _center_pixel_polygon(affine: Affine, rows: int, cols: int) -> Polygon:
    geometry = RasterGrid.from_affine(affine=affine, rows=rows, cols=cols, crs=WGS84)
    subset = geometry._subset_index(slice(1, 2), slice(1, 2))
    cell_size = abs(affine.a)
    west = subset.x_origin
    north = subset.y_origin
    east = west + cell_size
    south = north - cell_size
    return Polygon([(west, north), (east, north), (east, south), (west, south), (west, north)])


@pytest.mark.unit
class TestGeneratePatch:
    def test_geographic_patch_matches_center_pixel_bounds(self):
        cell_size = 0.0003
        cols = rows = 3
        x_min = -106.0
        y_max = 32.0
        affine = Affine(cell_size, 0, x_min, 0, -cell_size, y_max)
        roi = _center_pixel_polygon(affine, rows, cols)
        patch = generate_patch(roi)

        left, bottom, right, top = array_bounds(rows, cols, affine)
        xy = patch.get_xy()
        assert xy[0, 0] == pytest.approx(left + cell_size)
        assert xy[0, 1] == pytest.approx(top - cell_size)
        assert xy[1, 0] == pytest.approx(left + 2 * cell_size)
        assert xy[1, 1] == pytest.approx(top - cell_size)
        assert xy[2, 0] == pytest.approx(left + 2 * cell_size)
        assert xy[2, 1] == pytest.approx(top - 2 * cell_size)
        assert xy[3, 0] == pytest.approx(left + cell_size)
        assert xy[3, 1] == pytest.approx(top - 2 * cell_size)

    def test_pixel_patch_still_available_for_indexed_imshow(self):
        cell_size = 0.0003
        affine = Affine(cell_size, 0, -106.0, 0, -cell_size, 32.0)
        roi = _center_pixel_polygon(affine, rows=3, cols=3)
        patch = generate_patch(roi, affine=affine)
        xy = patch.get_xy()

        assert xy[0, 0] == pytest.approx(1.0)
        assert xy[0, 1] == pytest.approx(1.0)
        assert xy[1, 0] == pytest.approx(2.0)
        assert xy[1, 1] == pytest.approx(1.0)
