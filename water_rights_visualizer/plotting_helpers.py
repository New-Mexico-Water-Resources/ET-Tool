import math
import numpy as np
import pandas as pd
import abc


def mm_to_in(mm: float | pd.DataFrame) -> float:
    return mm / 25.4


def in_to_mm(inches: float | pd.DataFrame) -> float:
    return inches * 25.4


class ETUnit(abc.ABC):
    units: str
    min_increment: float
    nice_increments: list[float]
    abbreviation: str

    def __init__(self, units: str, min_increment: float, nice_increments: list[float], abbreviation: str):
        self.units = units
        self.min_increment = min_increment
        self.nice_increments = nice_increments
        self.abbreviation = abbreviation

    @abc.abstractmethod
    def convert_from_metric(self, metric_value: float | pd.DataFrame) -> float | pd.DataFrame:
        pass

    @abc.abstractmethod
    def convert_to_metric(self, value: float | pd.DataFrame) -> float | pd.DataFrame:
        pass


class MetricETUnit(ETUnit):
    def __init__(self, min_increment: float = 0.5, nice_increments: list[float] = [0.5, 1, 2, 5, 10]):
        super().__init__("metric", min_increment, nice_increments, "mm")

    def convert_from_metric(self, metric_value: float | pd.DataFrame) -> float | pd.DataFrame:
        return metric_value

    def convert_to_metric(self, value: float | pd.DataFrame) -> float | pd.DataFrame:
        return value


class ImperialETUnit(ETUnit):
    def __init__(self, min_increment: float = 0.1, nice_increments: list[float] = [0.1, 0.2, 0.5, 1, 2, 5, 10]):
        super().__init__("imperial", min_increment, nice_increments, "in")

    def convert_from_metric(self, metric_value: float | pd.DataFrame) -> float | pd.DataFrame:
        return mm_to_in(metric_value)

    def convert_to_metric(self, value: float | pd.DataFrame) -> float | pd.DataFrame:
        return in_to_mm(value)


class PercentageUnits(ETUnit):
    def __init__(self, min_increment: float = 1, nice_increments: list[float] = [1, 5, 10, 25, 50, 75, 100]):
        super().__init__("percentage", min_increment, nice_increments, "%")

    def convert_from_metric(self, metric_value: float | pd.DataFrame) -> float | pd.DataFrame:
        return np.clip(metric_value, 0, 100)

    def convert_to_metric(self, value: float | pd.DataFrame) -> float | pd.DataFrame:
        return np.clip(value, 0, 100)


class AcreFeetETUnit(ETUnit):
    def __init__(
        self, min_increment: float = 0.1, nice_increments: list[float] = [0.1, 0.2, 0.5, 1, 2, 5, 10], acres: float = 1
    ):
        super().__init__("acre-feet", min_increment, nice_increments, "AF")
        self.acres = acres

    def convert_from_metric(self, metric_value: float | pd.DataFrame) -> float | pd.DataFrame:
        return metric_value * self.acres * 0.003259

    def convert_to_metric(self, value: float | pd.DataFrame) -> float | pd.DataFrame:
        return value / (self.acres * 0.003259)


def convert_to_nice_number_range(start: float, end: float, units: ETUnit, subdivisions: int = 5) -> list[float]:
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

    start = units.convert_from_metric(start)
    end = units.convert_from_metric(end)

    # If start and end are the same, return a single value
    if start == end:
        return [start]

    # Set minimum increment based on units
    min_increment = units.min_increment

    # Calculate the range and ideal increment size
    data_range = end - start
    increment = max(min_increment, data_range / subdivisions)

    # Round increment up to a nice number (0.5, 1, 2, 5, 10, etc for metric)
    # or (0.1, 0.2, 0.5, 1, 2, 5, 10, etc for inches)
    magnitude = 10 ** math.floor(math.log10(increment))
    normalized = increment / magnitude

    # Define nice number increments based on units
    increments = units.nice_increments

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
