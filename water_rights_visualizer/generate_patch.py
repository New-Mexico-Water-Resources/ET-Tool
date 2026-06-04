import numpy as np
from affine import Affine
from shapely.geometry import MultiPolygon, Polygon
from matplotlib.patches import Polygon as PatchPolygon


def generate_patch(polygon: Polygon, affine: Affine | None = None) -> PatchPolygon:
    """
    Generate a patch for a given polygon using an affine transformation.

    Parameters:
    polygon (Polygon): The input polygon.
    affine (Affine): The affine transformation to be applied.

    Returns:
    Polygon: The generated patch.

    """
    # If the input polygon is a MultiPolygon, take the first polygon
    if isinstance(polygon, MultiPolygon):
        polygon = list(polygon.geoms)[0]

    if affine is None:
        polygon_coords = list(polygon.exterior.coords)
    else:
        # Apply the affine transformation to the coordinates of the polygon
        polygon_coords = [~affine * coords[:2] for coords in polygon.exterior.coords]

    # Create a patch using the transformed coordinates
    return PatchPolygon(polygon_coords, fill=None, edgecolor="black", linewidth=1)
