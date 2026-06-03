from .landsat_pass_count import count_landsat_passes_for_month


def water_rights_visualizer(*args, **kwargs):
    from .water_rights_visualizer import water_rights_visualizer as run_water_rights_visualizer

    return run_water_rights_visualizer(*args, **kwargs)


__all__ = ["water_rights_visualizer", "count_landsat_passes_for_month"]
