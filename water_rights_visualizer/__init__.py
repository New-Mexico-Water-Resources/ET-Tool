__all__ = ["water_rights_visualizer", "count_landsat_passes_for_month"]


def __getattr__(name: str):
    if name == "count_landsat_passes_for_month":
        from .landsat_pass_count import count_landsat_passes_for_month

        return count_landsat_passes_for_month
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def water_rights_visualizer(*args, **kwargs):
    from .water_rights_visualizer import water_rights_visualizer as run_water_rights_visualizer

    return run_water_rights_visualizer(*args, **kwargs)
