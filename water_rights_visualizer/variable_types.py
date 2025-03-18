from datetime import datetime
from typing import TypedDict

OPENET_TRANSITION_DATE = 2008


class VariableType:
    def __init__(
        self,
        name: str,
        variable: str,
        mapped_variable: str,
        file_prefix: str,
        monthly: bool,
        parent_dir: str,
        start: datetime.date,
        end: datetime.date,
        daylight_corrected: bool = True,
    ):
        self.name = name
        self.variable = variable
        self.mapped_variable = mapped_variable
        self.file_prefix = file_prefix
        self.monthly = monthly
        self.daylight_corrected = daylight_corrected
        self.parent_dir = parent_dir
        self.start = start
        self.end = end


VARIABLE_TYPES = [
    VariableType(
        name="Landsat PT-JPL ET",
        variable="ET",
        mapped_variable="ET",
        file_prefix="LC08_",
        monthly=False,
        parent_dir="",
        start=datetime(1983, 1, 1).date(),
        end=datetime(2008, 1, 1).date(),
    ),
    VariableType(
        name="Landsat PT-JPL ESI",
        variable="ESI",
        mapped_variable="ESI",
        file_prefix="LC08_",
        monthly=False,
        parent_dir="",
        start=datetime(1983, 1, 1).date(),
        end=datetime(2008, 1, 1).date(),
    ),
    VariableType(
        name="OpenET Ensemble ET",
        variable="ET",
        mapped_variable="ET",
        file_prefix="OPENET_ENSEMBLE_",
        monthly=True,
        parent_dir="monthly",
        start=datetime(2008, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
    VariableType(
        name="OpenET Ensemble CCOUNT",
        variable="CCOUNT",
        mapped_variable="CCOUNT",
        file_prefix="OPENET_ENSEMBLE_",
        monthly=True,
        parent_dir="monthly",
        start=datetime(2008, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
    VariableType(
        name="OpenET Ensemble ET MIN",
        variable="ET_MIN",
        mapped_variable="ET_MIN",
        file_prefix="OPENET_ENSEMBLE_",
        monthly=True,
        parent_dir="uncertainty/output/2019",
        start=datetime(2008, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
    VariableType(
        name="OpenET Ensemble ET MAX",
        variable="ET_MAX",
        mapped_variable="ET_MAX",
        file_prefix="OPENET_ENSEMBLE_",
        monthly=True,
        parent_dir="uncertainty/output/2019",
        start=datetime(2008, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
    VariableType(
        name="OpenET PTJPL Cloud Count",
        variable="COUNT",
        mapped_variable="COUNT",
        file_prefix="OPENET_PTJPL_",
        monthly=True,
        parent_dir="uncertainty/output/2019",
        start=datetime(2008, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
    VariableType(
        name="IDAHO EPSCOR GRIDMET ETO",
        variable="PET",
        mapped_variable="ETO",
        file_prefix="IDAHO_EPSCOR_GRIDMET_",
        monthly=True,
        daylight_corrected=False,
        parent_dir="monthly",
        start=datetime(2008, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
    VariableType(
        name="Oregon State PRISM PPT",
        variable="PPT",
        mapped_variable="PPT",
        file_prefix="OREGON_STATE_PRISM_",
        monthly=True,
        parent_dir="precipitation",
        start=datetime(1985, 1, 1).date(),
        end=datetime(2025, 1, 1).date(),
    ),
]


def get_available_variables_for_date(date: datetime.date) -> list[VariableType]:
    """
    Get the available variables for a given date.

    Args:
        date (datetime.date): The date for which to get available variables.

    Returns:
        list[VariableType]: The available variables for the given date.
    """
    variables = []
    for variable in VARIABLE_TYPES:
        if variable.start <= date < variable.end:
            variables.append(variable)
    return variables


def get_sources_for_variable(variable: str) -> list[VariableType]:
    """
    Get the available sources for a given variable.

    Args:
        variable (str): The variable for which to get available sources.

    Returns:
        list[VariableType]: The available sources for the given variable.
    """
    sources = []
    for variable_type in VARIABLE_TYPES:
        if variable_type.variable == variable:
            sources.append(variable_type)
    return sources


def get_available_variable_source_for_date(variable: str, date: datetime.date) -> VariableType | None:
    """
    Get the first available source for a given variable and date.

    Args:
        variable (str): The variable for which to get available sources.
        date (datetime.date): The date for which to get available sources.

    Returns:
        VariableType: The available source for the given variable and date.
    """
    for source in VARIABLE_TYPES:
        if source.variable == variable and date >= source.start and date < source.end:
            return source

    return None
