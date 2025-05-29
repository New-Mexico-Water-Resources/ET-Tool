import math
import numpy as np
import pandas as pd


def mm_to_in(mm: float | pd.DataFrame) -> float:
    return mm / 25.4


def convert_to_nice_number_range(start: float, end: float, metric_units: bool, subdivisions: int = 5) -> list[float]:
    """
    Convert a range of values to "nice" numbers in the given units (assumes input is in mm).
    The nice numbers are readable multiples of the subdivision.

    Args:
        start (float): The start value to convert (in mm).
        end (float): The end value to convert (in mm).
        metric_units (bool): Whether the units are metric.
        subdivisions (int): The target number of subdivisions to use for the nice number range.

    Returns:
        list[float]: A list of nice numbers that encompass the input range
    """

    if subdivisions <= 0:
        raise ValueError("subdivisions must be positive")

    try:
        start = float(start)
        end = float(end)
    except (TypeError, ValueError):
        raise ValueError("start and end must be numeric values")

    # Handle NaN inputs
    if pd.isna(start):
        if pd.isna(end):
            return [0, 1]
        else:
            return [0, end]
    elif pd.isna(end):
        return [start]

    # Handle invalid range
    if start > end:
        start, end = end, start  # Swap values to ensure start <= end

    start = mm_to_in(start) if not metric_units else start
    end = mm_to_in(end) if not metric_units else end

    # If start and end are the same, return a single value
    if start == end:
        return [start]

    # Set minimum increment based on units
    min_increment = 0.5 if metric_units else 0.1

    # Calculate the range and ideal increment size
    data_range = end - start
    increment = max(min_increment, data_range / subdivisions)

    # Round increment up to a nice number (0.5, 1, 2, 5, 10, etc for metric)
    # or (0.1, 0.2, 0.5, 1, 2, 5, 10, etc for inches)
    magnitude = 10 ** math.floor(math.log10(increment))
    normalized = increment / magnitude

    # Define nice number increments based on units
    increments = [0.1, 0.2, 0.5, 1, 2, 5, 10] if not metric_units else [0.5, 1, 2, 5, 10]

    # Find first increment larger than normalized value
    try:
        nice_increment = magnitude * next(x for x in increments if x >= normalized)
    except StopIteration:
        nice_increment = magnitude * increments[-1]

    if not nice_increment:
        nice_increment = 1

    # Calculate nice start and end values
    nice_start = math.floor(start / nice_increment) * nice_increment
    nice_end = math.ceil(end / nice_increment) * nice_increment

    # Calculate all nice numbers in the range
    try:
        nice_numbers = np.arange(nice_start, nice_end + nice_increment, nice_increment)
    except (ValueError, MemoryError) as e:
        return [nice_start, nice_end]

    # Convert to ints if all numbers are whole numbers and not NaN
    if np.all(np.equal(np.mod(nice_numbers, 1), 0)) and not np.any(np.isnan(nice_numbers)):
        nice_numbers = nice_numbers.astype(int)

    return nice_numbers.tolist()
