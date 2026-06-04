import numpy as np
import pytest

from affine import Affine

from raster import Raster, RasterGrid
from water_rights_visualizer.constants import WGS84


@pytest.mark.unit
class TestRasterContain:
    def test_small_1x1_point_returns_raster(self):
        affine = Affine(0.0003, 0, -106.0, 0, -0.0003, 32.0)
        geometry = RasterGrid.from_affine(affine=affine, rows=1, cols=1, crs=WGS84)
        raster = Raster(np.array([[42.0]], dtype=np.float32), geometry=geometry)

        result = raster.contain(np.array([[7.0]], dtype=np.float32))

        assert isinstance(result, Raster)
        assert result.shape == (1, 1)
        assert result[0, 0] == pytest.approx(7.0)
