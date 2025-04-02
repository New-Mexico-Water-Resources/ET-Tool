import numpy as np
from scipy.interpolate import interp1d


def interpolate_stack(stack: np.ndarray) -> np.ndarray:
    """
    This function interpolates a 3D numpy array along the time axis (0th axis).
    It uses nearest interpolation to fill in missing values in the time series data for each pixel.

    Parameters:
    stack (np.ndarray): A 3D numpy array representing a stack of 2D images over time.

    Returns:
    np.ndarray: The interpolated stack.
    """
    days, rows, cols = stack.shape

    # Reshape the stack to 2D (time, pixels) for vectorized operations
    stack_2d = stack.reshape(days, -1)
    filled_stack_2d = np.full_like(stack_2d, np.nan, dtype=np.float32)

    # Create time axis once
    x = np.arange(days)

    # Process each pixel column in the 2D array
    for i in range(stack_2d.shape[1]):
        pixel_timeseries = stack_2d[:, i]
        known_indices = ~np.isnan(pixel_timeseries)

        # Skip if too few known values
        if np.sum(known_indices) < 3:
            continue

        # Get known values and their indices
        known_days = x[known_indices]
        known_values = pixel_timeseries[known_indices]

        # Create interpolation function
        f = interp1d(known_days, known_values, kind="nearest", fill_value="extrapolate")

        # Fill in missing values
        filled_stack_2d[:, i] = f(x)

    # Reshape back to 3D
    return filled_stack_2d.reshape(days, rows, cols)
