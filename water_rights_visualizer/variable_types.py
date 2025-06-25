import os
import yaml
from datetime import datetime
from typing import TypedDict


class VariableType:
    def __init__(
        self,
        id: str,
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
        self.id = id
        self.name = name
        self.variable = variable
        self.mapped_variable = mapped_variable
        self.file_prefix = file_prefix
        self.monthly = monthly
        self.daylight_corrected = daylight_corrected
        self.parent_dir = parent_dir
        self.start = start
        self.end = end


def _load_variable_types() -> list[VariableType]:
    """Load variable types from YAML configuration file."""
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
    except NameError:
        project_root = os.getcwd()

    yaml_path = os.path.join(project_root, "variables.yaml")

    try:
        with open(yaml_path, "r") as file:
            config = yaml.safe_load(file)

        openet_transition_date = datetime.strptime(config["openet_transition_date"], "%Y-%m-%d").date()

        variable_types = []
        for var_config in config["sources"]:
            start_date = datetime.strptime(var_config["start"], "%Y-%m-%d").date()
            end_date = datetime.strptime(var_config["end"], "%Y-%m-%d").date()

            variable_type = VariableType(
                id=var_config["id"],
                name=var_config["name"],
                variable=var_config["variable"],
                mapped_variable=var_config["mapped_variable"],
                file_prefix=var_config["file_prefix"],
                monthly=var_config["monthly"],
                parent_dir=var_config["parent_dir"],
                start=start_date,
                end=end_date,
                daylight_corrected=var_config.get("daylight_corrected", True),
            )
            variable_types.append(variable_type)

        return variable_types, openet_transition_date

    except FileNotFoundError:
        raise FileNotFoundError(f"Configuration file not found: {yaml_path}")
    except yaml.YAMLError as e:
        raise ValueError(f"Error parsing YAML configuration: {e}")
    except KeyError as e:
        raise ValueError(f"Missing required key in configuration: {e}")


VARIABLE_TYPES, OPENET_TRANSITION_DATE = _load_variable_types()


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
