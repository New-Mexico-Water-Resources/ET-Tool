import pytest
from datetime import date

from water_rights_visualizer.variable_types import (
    get_available_variable_source_for_date,
    get_available_variables_for_date,
    get_sources_for_variable,
)


@pytest.mark.unit
class TestVariableTypes:
    def test_openet_ensemble_et_available_after_transition(self):
        source = get_available_variable_source_for_date("ET", date(2021, 6, 1))
        assert source is not None
        assert source.file_prefix == "OPENET_ENSEMBLE_"
        assert source.monthly is True
        assert source.daylight_corrected is True

    def test_gridmet_eto_available_after_transition(self):
        source = get_available_variable_source_for_date("PET", date(2021, 6, 1))
        assert source is not None
        assert source.mapped_variable == "ETO"
        assert source.daylight_corrected is True

    def test_pre_transition_landsat_et_not_used_after_transition(self):
        source = get_available_variable_source_for_date("ET", date(2021, 1, 1))
        assert source.file_prefix == "OPENET_ENSEMBLE_"

    def test_pre_transition_date_uses_landsat_et(self):
        source = get_available_variable_source_for_date("ET", date(1984, 6, 1))
        assert source.file_prefix == "LC08_"
        assert source.monthly is False

    def test_post_transition_variables_include_core_products(self):
        variables = {source.variable for source in get_available_variables_for_date(date(2021, 1, 1))}
        assert {"ET", "PET", "PPT", "ET_MIN", "ET_MAX"}.issubset(variables)

    def test_each_variable_has_at_most_one_active_source(self):
        for variable in ("ET", "PET", "PPT", "ET_MIN", "ET_MAX"):
            active_sources = [
                source
                for source in get_sources_for_variable(variable)
                if source.start <= date(2021, 1, 1) < source.end
            ]
            assert len(active_sources) == 1
