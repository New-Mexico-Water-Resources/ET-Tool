import numpy as np
import pytest

from water_rights_visualizer.interpolate_stack import interpolate_stack


@pytest.mark.unit
class TestInterpolateStack:
    def test_interpolate_stack_fills_internal_gap(self):
        stack = np.full((5, 2, 2), np.nan, dtype=np.float32)
        stack[0, :, :] = 1.0
        stack[4, :, :] = 5.0
        stack[2, 0, 0] = 3.0

        filled = interpolate_stack(stack)

        assert not np.isnan(filled[1, 0, 0])
        assert filled[1, 0, 0] == pytest.approx(1.0)
        assert filled[3, 0, 0] == pytest.approx(3.0)

    def test_interpolate_stack_leaves_sparse_pixels_when_too_few_observations(self):
        stack = np.full((5, 2, 2), np.nan, dtype=np.float32)
        stack[0, 0, 0] = 2.0
        stack[4, 0, 0] = 4.0

        filled = interpolate_stack(stack)
        assert np.isnan(filled[:, 1, 1]).all()

    def test_generate_sparse_stack_shape(self):
        from water_rights_visualizer.generate_stack import generate_sparse_stack

        stack = generate_sparse_stack(365, 10, 12)
        assert stack.shape == (365, 10, 12)
        assert np.isnan(stack).all()
