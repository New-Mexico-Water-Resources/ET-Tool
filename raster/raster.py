"""
This package manages the geographic information associated with data points in both swath and grid rasters.
"""
from __future__ import annotations

import io
import json
import locale
import logging
import math
import os
# from memory_profiler import profile
import pickle
import warnings
from abc import abstractmethod
from collections import OrderedDict
from collections.abc import Iterable
from os import makedirs
from os.path import dirname, exists, abspath, expanduser, splitext
from typing import List, Tuple, Iterator, Union, Any, Optional

# from numpy import clip
import PIL
import geopandas as gpd
import h5py
import matplotlib.pyplot as plt
import numpy as np
import pygeos
import pyproj
import rasterio
import shapely
import skimage
import skimage.transform
from PIL import Image
from affine import Affine
from astropy.visualization import MinMaxInterval, AsymmetricPercentileInterval
from matplotlib import colors
from matplotlib.colors import Colormap
from matplotlib.figure import Figure
from matplotlib.ticker import FuncFormatter
from mpl_toolkits.axes_grid1 import make_axes_locatable
from numpy.core.umath import logical_or, isfinite
from pyproj import CRS, Transformer
from pyproj import transform
from pyproj._crs import _CRS

from pyresample import SwathDefinition, AreaDefinition
from pyresample.kd_tree import get_neighbour_info, get_sample_from_neighbour_info
from rasterio import DatasetReader
# from rasterio.crs import CRS as RasterioCRS
from rasterio.enums import MergeAlg
from rasterio.features import geometry_mask
from rasterio.warp import reproject, Resampling
from rasterio.windows import Window
from scipy.ndimage import zoom
from scipy.ndimage.interpolation import shift
from scipy.spatial import cKDTree as KDTree
from shapely.geometry import Point, LinearRing, MultiPoint
from shapely.geometry.base import BaseGeometry, CAP_STYLE, JOIN_STYLE, geom_factory
from shapely.ops import transform as shapely_transform
from six import string_types

import raster

__author__ = "Gregory Halverson"

DEFAULT_MATPLOTLIB_STYLE = "dark_background"

CELL_SIZE_TO_SEARCH_DISTANCE_FACTOR = 3

GEOTIFF_DRIVER = "GTiff"
GEOPACKAGE_DRIVER = "GPKG"
GEOPNG_DRIVER = "PNG"
GEOJPEG_DRIVER = "JPEG"
COG_DRIVER = "COG"

RASTERIO_RESAMPLING_METHODS = {
    "nearest": Resampling.nearest,
    "linear": Resampling.bilinear,
    "cubic": Resampling.cubic,
    "cubic_spline": Resampling.cubic_spline,
    "lanczos": Resampling.lanczos,
    "average": Resampling.average,
    "mode": Resampling.mode,
    "gauss": Resampling.gauss,
    "max": Resampling.max,
    "min": Resampling.min,
    "med": Resampling.med,
    "q1": Resampling.q1,
    "q3": Resampling.q3
}

SKIMAGE_RESAMPLING_METHODS = {
    "nearest": 0,
    "linear": 1,
    "quadratic": 2,
    "cubic": 3,
    "quartic": 4,
    "quintic": 5
}

DEFAULT_CMAP = "jet"
DEFAULT_FIGSIZE = (7, 5)
DEFAULT_DPI = 200

DEFAULT_ASCII_SHAPE = (15, 50)
DEFAULT_ASCII_RAMP = "@%#*+=-:. "[::-1]
DEFAULT_NODATA_CHARACTER = " "

try:
    locale.setlocale(locale.LC_ALL, "")
except Exception as e:
    pass


class CRS(pyproj.CRS):
    def __init__(self, projparams: Any = None, **kwargs) -> None:
        super(CRS, self).__init__(projparams=projparams, **kwargs)

    def __repr__(self) -> str:
        epsg_string = self.epsg_string

        if epsg_string is None:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return self.to_proj4()
        else:
            return epsg_string

    def __eq__(self, other: Union[CRS, str]) -> bool:
        if self.to_epsg() is not None and other.to_epsg() is not None:
            return self.to_epsg() == other.to_epsg()

        return super(CRS, self).__eq__(other=other)

    # needed to override this because of issues with pickle loading
    # somehow the _local attribute was disappearing in pickle loading
    @property
    def _crs(self):
        """
        Retrieve the Cython based _CRS object for this thread.
        """
        if not hasattr(self, "_local") or self._local is None:
            from pyproj.crs.crs import CRSLocal
            self._local = CRSLocal()

        if self._local.crs is None:
            self._local.crs = _CRS(self.srs)
        return self._local.crs

    # factories

    @classmethod
    def center_aeqd(cls, center_coord: Point) -> CRS:
        """
        Generate Azimuthal Equal Area CRS centered at given lat/lon.
        :param center_coord: shapely.geometry.Point object containing latitute and longitude point of center of CRS
        :return: pyproj.CRS object of centered CRS
        """
        return CRS(f"+proj=aeqd +lat_0={center_coord.y} +lon_0={center_coord.x}")

    @classmethod
    def local_UTM_proj4(cls, point_latlon: Union[Point, str]) -> CRS:
        if isinstance(point_latlon, str):
            point_latlon = shapely.wkt.loads(point_latlon)

        lat = point_latlon.y
        lon = point_latlon.x
        UTM_zone = (math.floor((lon + 180) / 6) % 60) + 1
        UTM_proj4 = CRS(
            f"+proj=utm +zone={UTM_zone} {'+south ' if lat < 0 else ''}+ellps=WGS84 +datum=WGS84 +units=m +no_defs")

        return UTM_proj4

    # properties

    @property
    def epsg_string(self) -> Optional[str]:
        epsg_code = self.to_epsg()

        if epsg_code is None:
            return None

        epsg_string = f"EPSG:{epsg_code}"

        return epsg_string

    @property
    def epsg_url(self) -> Optional[str]:
        epsg_code = self.to_epsg()

        if epsg_code is None:
            return None

        epsg_url = f"http://www.opengis.net/def/crs/EPSG/9.9.1/{epsg_code}"

        return epsg_url

    @property
    def coverage(self) -> OrderedDict:
        coverage = OrderedDict()
        coverage["coordinates"] = ["x", "y"]
        system = OrderedDict()

        if self.is_geographic:
            system["type"] = "GeographicCRS"
        else:
            system["type"] = "ProjectedCRS"

        epsg_url = self.epsg_url

        if epsg_url is not None:
            system["id"] = epsg_url

        coverage["system"] = system

        return coverage

    # this was causing problems with pickle loading
    # @property
    # def __dict__(self) -> dict:
    #     return self.coverage

    def to_pyproj(self) -> pyproj.CRS:
        return pyproj.CRS(self.to_wkt())

    @property
    def pyproj(self) -> pyproj.CRS:
        return self.to_pyproj()

    @property
    def proj4(self) -> str:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return self.to_proj4()


WGS84 = CRS("EPSG:4326")


class SpatialGeometry:
    def __init__(self, *args, crs: Union[CRS, str] = WGS84, **kwargs):
        if not isinstance(crs, CRS):
            crs = CRS(crs)

        self._crs = crs

    @property
    def crs(self) -> CRS:
        return self._crs

    @property
    @abstractmethod
    def bbox(self) -> BBox:
        pass

    @abstractmethod
    def to_crs(self, CRS: Union[CRS, "str"]) -> SpatialGeometry:
        pass

    @property
    def latlon(self) -> SpatialGeometry:
        return self.to_crs(WGS84)

    @property
    @abstractmethod
    def centroid(self) -> Point:
        raise NotImplementedError(f"centroid property not implemented by {self.__class__.__name__}")

    @property
    def centroid_latlon(self) -> Point:
        return self.centroid.latlon

    @property
    def local_UTM_proj4(self) -> str:
        centroid = self.centroid.latlon
        lat = centroid.y
        lon = centroid.x
        UTM_zone = (math.floor((lon + 180) / 6) % 60) + 1
        UTM_proj4 = f"+proj=utm +zone={UTM_zone} {'+south ' if lat < 0 else ''}+ellps=WGS84 +datum=WGS84 +units=m +no_defs"

        return UTM_proj4


class VectorGeometry(SpatialGeometry):
    def contain(self, other, crs: CRS = None, **kwargs) -> VectorGeometry:
        return self.__class__(other, crs=crs, **kwargs)

    def to_crs(self, crs: Union[CRS, str]) -> VectorGeometry:
        crs = CRS(crs)
        result = self.contain(
            shapely.ops.transform(Transformer.from_crs(self.crs, crs, always_xy=True).transform, self.geometry),
            crs=crs)
        return result

    @property
    def latlon(self):
        return self.to_crs(WGS84)

    @property
    def UTM(self):
        return self.to_crs(self.local_UTM_proj4)

    @property
    def mapping(self) -> dict:
        return shapely.geometry.mapping(self)

    def to_shapely(self):
        return shapely.geometry.shape(self.mapping)

    @property
    def shapely(self):
        return self.to_shapely()

    @property
    def gdf(self) -> gpd.GeoDataFrame:
        return gpd.GeoDataFrame({}, geometry=[self.shapely], crs=self.crs.proj4)

    def to_geojson(self, filename: str):
        self.gdf.to_file(filename, driver="GeoJSON")

    @property
    def is_geographic(self) -> bool:
        return self.crs.is_geographic

    @property
    def projected(self):
        if self.is_geographic:
            return self.to_crs(self.local_UTM_proj4)
        else:
            return self

    def distances(self, points: Union[MultiPoint, Iterable[Point]]) -> gpd.GeoDataFrame:
        points = [wrap_geometry(point) for point in points]

        geometry = []
        distance_column = []

        for point in points:
            geometry.append(shapely.geometry.LineString([self, point]))
            distance_column.append(self.projected.distance(point.projected))

        distances = gpd.GeoDataFrame({"distance": distance_column}, geometry=geometry)

        return distances


class SingleVectorGeometry(VectorGeometry):
    pass


class MultiVectorGeometry(VectorGeometry):
    pass


class Point(SingleVectorGeometry):
    def __init__(self, *args, crs: Union[CRS, str] = WGS84):
        if isinstance(args[0], Point):
            geometry = args[0].geometry
            crs = args[0].crs
        else:
            geometry = shapely.geometry.Point(*args)

        VectorGeometry.__init__(self, crs=crs)

        self.geometry = geometry

    @property
    def latlon(self) -> Point:
        return self.contain(
            gpd.GeoDataFrame({}, geometry=[self.geometry], crs=str(self.crs)).to_crs(str(WGS84)).geometry[0],
            crs=CRS(WGS84))

    @property
    def centroid(self) -> Point:
        return self

    @property
    def x(self):
        return self.geometry.x

    @property
    def y(self):
        return self.geometry.y

    def buffer(
            self,
            distance,
            resolution=16,
            quadsegs=None,
            cap_style=CAP_STYLE.round,
            join_style=JOIN_STYLE.round,
            mitre_limit=5.0,
            single_sided=False) -> Polygon:
        return Polygon(
            shapely.geometry.Point.buffer(
                self.geometry,
                distance=distance,
                resolution=resolution,
                quadsegs=quadsegs,
                cap_style=cap_style,
                join_style=join_style,
                mitre_limit=mitre_limit,
                single_sided=single_sided
            ),
            crs=self.crs
        )


class MultiPoint(MultiVectorGeometry):
    def __init__(self, points, crs: Union[CRS, str] = WGS84):
        if isinstance(points[0], MultiPoint):
            geometry = points[0].geometry
            crs = points[0].crs
        else:
            geometry = shapely.geometry.MultiPoint(points)

        VectorGeometry.__init__(self, crs=crs)

        self.geometry = geometry

class Polygon(SingleVectorGeometry):
    def __init__(self, *args, crs: Union[CRS, str] = WGS84):
        if isinstance(args[0], Polygon):
            geometry = args[0].geometry
            crs = args[0].crs
        else:
            geometry = shapely.geometry.Polygon(*args)

        VectorGeometry.__init__(self, crs=crs)

        self.geometry = geometry

    @property
    def centroid(self) -> Point:
        """Returns the geometric center of the object"""
        return Point(self.geometry.centroid, crs=self.crs)

    @property
    def exterior(self):
        return self.geometry.exterior

    @property
    def is_empty(self):
        return self.geometry.is_empty

    @property
    def geom_type(self):
        return self.geometry.geom_type

    @property
    def bounds(self):
        return self.geometry.bounds

    @property
    def interiors(self):
        return self.geometry.interiors

    @property
    def wkt(self):
        return self.geometry.wkt

    @property
    def bbox(self) -> BBox:
        x, y = self.exterior.xy
        x = np.array(x)
        y = np.array(y)
        x_min = float(np.nanmin(x))
        y_min = float(np.nanmin(y))
        x_max = float(np.nanmax(x))
        y_max = float(np.nanmax(y))
        bbox = BBox(x_min, y_min, x_max, y_max, crs=self.crs)

        return bbox


class MultiPolygon(MultiVectorGeometry, shapely.geometry.MultiPolygon):
    def __init__(self, *args, crs: Union[CRS, str] = WGS84):
        if isinstance(args[0], MultiPolygon):
            geometry = args[0].geometry
            crs = args[0].crs
        else:
            geometry = shapely.geometry.MultiPolygon(*args)

        VectorGeometry.__init__(self, crs=crs)

        self.geometry = geometry

    @property
    def bbox(self) -> BBox:
        return BBox(*self.geometry.bounds, crs=self.crs)

def wrap_geometry(geometry: Any, crs: Union[CRS, str] = None) -> SpatialGeometry:
    if isinstance(geometry, SpatialGeometry):
        return geometry

    if crs is None:
        crs = WGS84

    if isinstance(geometry, str):
        geometry = shapely.geometry.shape(geometry)

    if isinstance(geometry, shapely.geometry.Point):
        return Point(geometry, crs=crs)
    elif isinstance(geometry, shapely.geometry.MultiPoint):
        return MultiPoint(geometry, crs=crs)
    elif isinstance(geometry, shapely.geometry.Polygon):
        return Polygon(geometry, crs=crs)
    elif isinstance(geometry, shapely.geometry.MultiPolygon):
        return MultiPolygon(geometry, crs=crs)
    else:
        raise ValueError(f"unsupported geometry type: {type(geometry)}")


class BBox(SpatialGeometry):
    def __init__(self, xmin: float, ymin: float, xmax: float, ymax: float, crs: Union[CRS, str] = WGS84):
        super(BBox, self).__init__(crs=crs)

        self.x_min = xmin
        self.y_min = ymin
        self.x_max = xmax
        self.y_max = ymax

    def __repr__(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return f'BBox(xmin={self.x_min}, ymin={self.y_min}, xmax={self.x_max}, ymax={self.y_max}, crs="{self.crs.__repr__()}")'

    def __iter__(self):
        for element in (self.x_min, self.y_min, self.x_max, self.y_max):
            yield element

    def __eq__(self, other: BBox) -> bool:
        return all([
            self.x_min == other.x_min,
            self.y_min == other.y_min,
            self.x_max == other.x_max,
            self.y_max == other.y_max,
            self.crs == other.crs
        ])

    @classmethod
    def merge(cls, bboxes: List[BBox], crs: CRS = None) -> BBox:
        if crs is None:
            crs = bboxes[0].crs

        bboxes = [bbox.to_crs(crs) for bbox in bboxes]
        xmin = min([bbox.x_min for bbox in bboxes])
        xmax = max([bbox.x_max for bbox in bboxes])
        ymin = min([bbox.y_min for bbox in bboxes])
        ymax = min([bbox.y_max for bbox in bboxes])
        bbox = BBox(xmin=xmin, ymin=ymin, xmax=xmax, ymax=ymax, crs=crs)

        return bbox

    @property
    def polygon(self) -> Polygon:
        return Polygon(
            [
                (self.x_min, self.y_max),
                (self.x_max, self.y_max),
                (self.x_max, self.y_min),
                (self.x_min, self.y_min)
            ],
            crs=self.crs
        )

    def transform(self, crs: Union[CRS, str]) -> BBox:
        return self.polygon.to_crs(crs).bbox

    def to_crs(self, crs: Union[CRS, str]) -> BBox:
        return self.transform(crs=crs)

    @property
    def latlon(self):
        return self.transform(WGS84)

    @property
    def round(self) -> BBox:
        return BBox(
            xmin=round(self.x_min),
            ymin=round(self.y_min),
            xmax=round(self.x_max),
            ymax=round(self.y_max),
            crs=self.crs
        )

    @property
    def width(self) -> float:
        return self.x_max - self.x_min

    @property
    def height(self) -> float:
        return self.y_max - self.y_min

    def buffer(self, buffer) -> BBox:
        return BBox(
            xmin=self.x_min - buffer,
            ymin=self.y_min - buffer,
            xmax=self.x_max + buffer,
            ymax=self.y_max + buffer,
            crs=self.crs
        )

    @property
    def bbox(self) -> BBox:
        return self


class KDTree:
    def __init__(
            self,
            source_geometry: RasterGeometry,
            target_geometry: RasterGeometry,
            radius_of_influence: float = None,
            neighbours: int = 1,
            epsilon: float = 0,
            reduce_data: bool = True,
            nprocs: int = 1,
            segments=None,
            resample_type="nn",
            **kwargs):
        self.neighbours = neighbours
        self.epsilon = epsilon
        self.reduce_data = reduce_data
        self.nprocs = nprocs
        self.segments = segments
        self.resample_type = resample_type

        # validate destination geometry
        if not isinstance(target_geometry, RasterGeometry):
            raise TypeError("destination geometry must be a RasterGeometry object")

        # build pyresample data structure for source
        if isinstance(source_geometry, RasterGeolocation):
            # transform swath geolocation arrays to lat/lon
            source_lat, source_lon = source_geometry.latlon_matrices
            self.source_geo_def = SwathDefinition(lats=source_lat, lons=source_lon)
        elif isinstance(source_geometry, RasterGrid):
            source_proj4 = source_geometry.proj4

            source_area_extent = [
                source_geometry.x_min,
                source_geometry.y_min,
                source_geometry.x_max,
                source_geometry.y_max
            ]

            source_rows, source_cols = source_geometry.shape

            self.source_geo_def = AreaDefinition(
                area_id="source",
                description=source_proj4,
                proj_id=source_proj4,
                projection=source_proj4,
                width=source_cols,
                height=source_rows,
                area_extent=source_area_extent
            )
        else:
            raise ValueError("source type must be swath or grid")

        self.source_geometry = source_geometry
        self.target_geometry = target_geometry

        # build pyresample data structure for destination
        if isinstance(target_geometry, RasterGeolocation):
            # transform grid geolocation arrays to lat/lon
            dest_lat, dest_lon = target_geometry.latlon_matrices
            self.target_geo_def = SwathDefinition(lats=dest_lat, lons=dest_lon)
        elif isinstance(target_geometry, RasterGrid):
            destination_proj4 = target_geometry.proj4

            # Area extent as a list of ints (LL_x, LL_y, UR_x, UR_y)
            destination_area_extent = [
                target_geometry.x_min,
                target_geometry.y_min,
                target_geometry.x_max,
                target_geometry.y_max
            ]

            # destination_proj_dict = proj4_str_to_dict(destination_proj4)
            destination_rows, destination_cols = target_geometry.shape

            self.target_geo_def = AreaDefinition(
                area_id="destination",
                description=destination_proj4,
                proj_id=destination_proj4,
                projection=destination_proj4,
                width=destination_cols,
                height=destination_rows,
                area_extent=destination_area_extent
            )
        else:
            raise ValueError("destination type must be swath or grid")

        if radius_of_influence is None:
            source_cell_size = source_geometry.cell_size_meters
            destination_cell_size = target_geometry.cell_size_meters

            self.radius_of_influence = CELL_SIZE_TO_SEARCH_DISTANCE_FACTOR * np.nanmax([
                source_cell_size,
                destination_cell_size
            ])
        else:
            self.radius_of_influence = radius_of_influence

        self.radius_of_influence = float(self.radius_of_influence)

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore")

            self.valid_input_index, self.valid_output_index, self.index_array, self.distance_array = \
                get_neighbour_info(
                    source_geo_def=self.source_geo_def,
                    target_geo_def=self.target_geo_def,
                    radius_of_influence=self.radius_of_influence,
                    neighbours=self.neighbours,
                    epsilon=self.epsilon,
                    reduce_data=self.reduce_data,
                    nprocs=self.nprocs,
                    segments=self.segments,
                    **kwargs
                )

    def save(self, filename: str):
        makedirs(dirname(filename), exist_ok=True)
        with open(filename, "wb") as file:
            pickle.dump(self, file)

    @classmethod
    def load(cls, filename: str):
        with open(filename, "rb") as file:
            return pickle.load(file)

    def resample(
            self,
            source,
            fill_value=0,
            **kwargs):
        source = np.array(source)

        if not source.shape == self.source_geo_def.shape:
            raise ValueError("source data does not match source geometry")

        bool_conversion = str(source.dtype) == "bool"

        if bool_conversion:
            source = source.astype(np.uint16)

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore")

            resampled_data = get_sample_from_neighbour_info(
                resample_type=self.resample_type,
                output_shape=self.target_geo_def.shape,
                data=source,
                valid_input_index=self.valid_input_index,
                valid_output_index=self.valid_output_index,
                index_array=self.index_array,
                distance_array=self.distance_array,
                fill_value=fill_value,
                **kwargs
            )

        if bool_conversion:
            resampled_data = resampled_data.astype(bool)

        output_raster = Raster(
            array=resampled_data,
            geometry=self.target_geometry,
            nodata=fill_value
        )

        return output_raster


class RasterGeometry(SpatialGeometry):
    """
    This is the base class for encapsulating a raster's geography.
    Child classes will implement behaviour for the coordinate field of a swath and transform of a grid.
    """
    logger = logging.getLogger(__name__)

    geometry_type = None

    def __init__(self, crs: Union[CRS, str] = WGS84, **kwargs):
        """
        :param crs: CRS as proj4 string or pyproj.CRS object
        """
        if isinstance(crs, CRS):
            self._crs = crs
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self._crs = CRS(crs)

        # create empty geographic geolocation arrays
        self._lat = None
        self._lon = None
        self._cell_size_meters = None
        self._bbox = None
        self._crosses_antimeridian = None

    def __repr__(self):
        x_min, y_min, x_max, y_max = self.bbox

        display_dict = {
            "dimensions": {
                "rows": self.rows,
                "cols": self.cols
            },
            "bbox": {
                "xmin": x_min,
                "ymin": y_min,
                "xmax": x_max,
                "ymax": y_max
            },
            "crs": self.crs.__repr__(),
            "resolution": {
                "cell_width": self.cell_width,
                "cell_height": self.cell_height
            }
        }

        display_string = json.dumps(display_dict, indent=2)
        # display_string = yaml.dump(display_dict)

        return display_string

    @abstractmethod
    def __eq__(self, other: RasterGeometry) -> bool:
        pass

    def __getitem__(self, key: (slice, int, tuple)):
        if isinstance(key, (slice, int, tuple)):
            return self._key(key)

        else:
            raise KeyError('unrecognized key')

    @abstractmethod
    def _subset_index(self, y_slice: slice, x_slice: slice):
        pass

    @abstractmethod
    def _slice_coords(self, y_slice: slice, x_slice: slice):
        pass

    def _slice(self, y_slice: slice, x_slice: slice) -> RasterGeometry:
        if any([any([isinstance(index, float) for index in (slice.start, slice.stop, slice.step)]) for slice in
                (y_slice, x_slice)]):
            return self._slice_coords(y_slice, x_slice)

        y_start, y_end, y_step = y_slice.indices(self.rows)
        x_start, x_end, x_step = x_slice.indices(self.cols)

        if y_end - y_start == 1 and x_end - x_start == 1:
            return Point(self.x[y_start, x_start], self.y[y_start, x_start], crs=self.crs)

        if y_step != 1 or x_step != 1:
            raise NotImplementedError('stepped slicing is not implemented')

        return self._subset_index(slice(y_start, y_end, None), slice(x_start, x_end))

    def _key(self, key: int or tuple or Ellipsis) -> RasterGeometry:

        if key is Ellipsis:
            return self

        if isinstance(key, int):
            key = (key,)
        elif not isinstance(key, tuple):
            raise KeyError(f"invalid key: {key}")

        slices = []

        for i in range(2):
            if i > len(key) - 1:
                slices.append(slice(None, None, None))
            elif isinstance(key[i], int):
                slices.append(slice(key[i], key[i] + 1, None))
            elif isinstance(key[i], slice):
                slices.append(key[i])
            else:
                raise KeyError(f"invalid index: {key[i]}")

        y_slice, x_slice = slices

        return self._slice(y_slice, x_slice)

    @property
    def _matplotlib_extent(self) -> List[float]:
        return [self.x_min, self.x_max, self.y_min, self.y_max]

    @property
    def boundary_indices(self) -> (np.ndarray, np.ndarray):
        height = self.rows
        width = self.cols

        if height == 1 and width == 1:
            return np.full((1, 1), 0, dtype=np.int32), np.full((1, 1), 0, dtype=np.int32)

        y_top = np.full((width,), 0, dtype=np.int32)
        x_top = np.arange(width)
        y_right = np.arange(1, height)
        x_right = np.full((height - 1,), width - 1, dtype=np.int32)
        y_bottom = np.full((width - 1,), height - 1, dtype=np.int32)
        x_bottom = np.flipud(np.arange(width - 1))
        y_left = np.flipud(np.arange(1, height - 1))
        x_left = np.full((height - 2,), 0, dtype=np.int32)
        x_indices = np.concatenate([x_top, x_right, x_bottom, x_left])
        y_indices = np.concatenate([y_top, y_right, y_bottom, y_left])

        return y_indices, x_indices

    @property
    @abstractmethod
    def grid(self) -> RasterGrid:
        pass

    @property
    def is_geographic(self) -> bool:
        return self.crs.is_geographic

    @property
    def proj4(self) -> str:
        """
        CRSection as proj4 string
        """
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return self.crs.to_proj4()
        # if self.is_geographic:
        #     proj4 = self.crs.to_latlong().srs
        # else:
        #     proj4 = self.crs.srs
        #
        # if isinstance(proj4, bytes):
        #     proj4 = proj4.decode()
        #
        # proj4 = proj4.strip()
        #
        # if proj4 == "+proj=latlong +datum=WGS84 +ellps=WGS84 +towgs84=0,0,0":
        #     proj4 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
        #
        # return proj4

    @property
    def local_UTM_EPSG(self) -> str:
        centroid = self.centroid_latlon
        lat = centroid.y
        lon = centroid.x
        EPSG_code = int(f"{326 if lat >= 0 else 327}{((math.floor((lon + 180) / 6) % 60) + 1):02d}")

        return EPSG_code

    @property
    def local_UTM_proj4(self) -> str:
        centroid = self.centroid.latlon
        lat = centroid.y
        lon = centroid.x
        UTM_zone = (math.floor((lon + 180) / 6) % 60) + 1
        UTM_proj4 = f"+proj=utm +zone={UTM_zone} {'+south ' if lat < 0 else ''}+ellps=WGS84 +datum=WGS84 +units=m +no_defs"

        return UTM_proj4

    @property
    def is_point(self) -> bool:
        """
        Raster reduces to a point if all dimensions are a single value in length
        """
        return all([dim == 1 for dim in self.shape])

    @property
    def point(self) -> Point:
        if not self.is_point:
            return ValueError("not a single point")

        x = self.x[0, 0]
        y = self.y[0, 0]

        point = Point(x, y, crs=self.crs)

        return point

    @abstractmethod
    def index_point(self, point: Point) -> (int, int):
        pass

    @abstractmethod
    def index(self, geometry: RasterGeometry or Point or Polygon or (float, float, float, float)):
        pass

    @property
    @abstractmethod
    def x(self) -> np.ndarray:
        """
        Geolocation array of x-coordinates.
        """
        pass

    @property
    @abstractmethod
    def y(self) -> np.ndarray:
        """
        Geolocation array of y-coordinates.
        """
        pass

    @property
    @abstractmethod
    def xy(self) -> (np.ndarray, np.ndarray):
        pass

    @property
    def latlon_matrices(self) -> (np.ndarray, np.ndarray):
        if self._lat is None or self._lon is None:
            if self.is_geographic:
                self._lon, self._lat = self.xy
            else:
                x = self.x
                y = self.y
                lat, lon = Transformer.from_crs(self.crs, WGS84).transform(x, y)
                self._lon = lon
                self._lat = lat

        warnings.filterwarnings('ignore')
        self._lat = np.where(self._lat < -90, np.nan, self._lat)
        self._lat = np.where(self._lat > 90, np.nan, self._lat)
        self._lon = np.where(self._lon < -180, np.nan, self._lon)
        self._lon = np.where(self._lon > 180, np.nan, self._lon)
        warnings.resetwarnings()

        return self._lat, self._lon

    @property
    def lat(self) -> np.ndarray:
        """
        Geolocation array of latitude.
        """
        lat, lon = self.latlon_matrices

        if np.all(np.isnan(lat)):
            raise ValueError("blank latitude array generated")

        return lat

    @property
    def lon(self) -> np.ndarray:
        """
        Geolocation array of longitude.
        """
        lat, lon = self.latlon_matrices

        if np.all(np.isnan(lon)):
            raise ValueError("blank longitude array generated")

        return lon

    @abstractmethod
    def rows(self) -> int:
        """
        Y-dimension of surface in rows.
        """
        pass

    @abstractmethod
    def cols(self) -> int:
        """
        X-dimension of surface in columns.
        """
        pass

    @property
    def shape(self) -> (int, int):
        """
        Dimensions of surface in rows and columns.
        """
        return self.rows, self.cols

    @abstractmethod
    def resize(self, dimensions: (int, int)) -> RasterGeometry:
        """
        Reshape dimensions of surface to target (rows, cols) tuple.
        """
        pass

    def zoom(self, factor: float) -> RasterGeometry:
        return self.resize((int(self.rows * factor), int(self.cols * factor)))

    @abstractmethod
    def width(self) -> float:
        """
        Width of extent in projected units.
        """
        pass

    @property
    @abstractmethod
    def height(self) -> float:
        """
        Height of extent in projected units.
        """
        pass

    @property
    @abstractmethod
    def cell_width(self) -> float:
        """
        Positive cell width in units of CRS.
        """
        pass

    @property
    @abstractmethod
    def cell_height(self) -> float:
        """
        Negative cell height in units of CRS.
        """
        pass

    @property
    @abstractmethod
    def x_min(self) -> float:
        pass

    @property
    @abstractmethod
    def x_max(self) -> float:
        pass

    @property
    @abstractmethod
    def y_min(self) -> float:
        pass

    @property
    @abstractmethod
    def y_max(self) -> float:
        pass

    @property
    def x_center(self) -> float:
        x_cent = (self.x_min + self.x_max) / 2.0

        if self.is_geographic and (x_cent < -180 or x_cent > 180):
            raise ValueError(f"invalid center longitude: {x_cent}")

        return x_cent

    @property
    def y_center(self) -> float:
        y_cent = (self.y_min + self.y_max) / 2.0

        if self.is_geographic and (y_cent < -90 or y_cent > 90):
            raise ValueError(f"invalid center latitude {y_cent}")

        return y_cent

    @property
    def centroid(self) -> Point:
        return Point(self.x_center, self.y_center, crs=self.crs)

    @property
    def centroid_latlon(self) -> Point:
        return self.centroid.latlon

    @property
    def center_aeqd(self) -> CRS:
        return CRS.center_aeqd(self.centroid_latlon)

    def get_bbox(self, crs: Union[CRS, str] = None) -> BBox:
        if crs is None:
            crs = self.crs

        if not isinstance(crs, CRS):
            crs = CRS(crs)

        if crs == self.crs:
            boundary = self.boundary
        else:
            boundary = self.boundary.to_crs(crs)

        x, y = boundary.exterior.xy
        x = np.array(x)
        y = np.array(y)

        if crs.is_geographic and self.crosses_antimeridian:
            x_min = float(np.nanmin(x[x > 0]))
            y_min = float(np.nanmin(y))
            x_max = float(np.nanmax(x[x < 0]))
            y_max = float(np.nanmax(y))
        else:
            x_min = float(np.nanmin(x))
            y_min = float(np.nanmin(y))
            x_max = float(np.nanmax(x))
            y_max = float(np.nanmax(y))

        bbox = BBox(x_min, y_min, x_max, y_max, crs=crs)

        return bbox

    bbox = property(get_bbox)

    @property
    @abstractmethod
    def corner_polygon(self) -> Polygon:
        """
        Draw polygon through the corner coordinates of geolocation arrays.
        :return: shapely.geometry.Polygon of corner coordinate boundary
        """
        pass

    @property
    def corner_polygon_latlon(self) -> Polygon:
        return self.corner_polygon.to_crs(WGS84)

    def get_boundary(self, crs: Union[CRS, str] = None) -> Polygon:
        if crs is None:
            crs = self.crs

        if not isinstance(crs, CRS):
            crs = CRS(crs)

        boundary = self.boundary
        transformed_boundary = self.boundary.to_crs(crs)

        return transformed_boundary

    @property
    @abstractmethod
    def boundary(self):
        pass

    @property
    def boundary_latlon(self) -> Polygon:
        return self.get_boundary(WGS84)

    @property
    def crosses_antimeridian(self) -> bool:
        if self._crosses_antimeridian is not None:
            return self._crosses_antimeridian

        def to_polar(lon, lat):
            phi = np.pi / 180. * lon
            radius = np.pi / 180. * (90. - sign * lat)

            # nudge points at +/- 180 out of the way so they don't intersect the testing wedge
            phi = np.sign(phi) * np.where(np.abs(phi) > np.pi - 1.5 * epsilon, np.pi - 1.5 * epsilon, abs(phi))
            radius = np.where(radius < 1.5 * epsilon, 1.5 * epsilon, radius)

            x = radius * np.sin(phi)
            y = radius * np.cos(phi)

            if (isinstance(lon, list)):
                x = x.tolist()
                y = y.tolist()
            elif (isinstance(lon, tuple)):
                x = tuple(x)
                y = tuple(y)

            return (x, y)

        epsilon = 1e-14

        antimeridian_wedge = shapely.geometry.Polygon([
            (epsilon, -np.pi),
            (epsilon ** 2, -epsilon),
            (0, epsilon),
            (-epsilon ** 2, -epsilon),
            (-epsilon, -np.pi),
            (epsilon, -np.pi)
        ])

        feature_shape = self.boundary_latlon.geometry
        sign = 2. * (0.5 * (feature_shape.bounds[1] + feature_shape.bounds[3]) >= 0.) - 1.
        polar_shape = shapely_transform(to_polar, feature_shape)

        self._crosses_antimeridian = polar_shape.intersects(antimeridian_wedge)

        return self._crosses_antimeridian

    def intersects(self, geometry: BaseGeometry or RasterGeometry) -> bool:
        if isinstance(geometry, RasterGeometry):
            geometry = geometry.get_boundary(crs=self.crs)

        if hasattr(geometry, "geometry"):
            geometry = geometry.geometry

        if not isinstance(geometry, BaseGeometry):
            raise ValueError("invalid geometry for intersection")

        result = self.boundary.geometry.intersects(geometry)

        return result

    @property
    def geolocation(self) -> RasterGeolocation:
        return RasterGeolocation(x=self.x, y=self.y, crs=self.crs)

    def to_crs(self, crs: Union[CRS, str] = WGS84) -> RasterGeolocation:
        # validate destination CRS
        if not isinstance(crs, CRS):
            crs = CRS(crs)

        if self.crs == crs:
            return self

        if self.is_geographic:
            x, y = transform(self.crs, crs, self.y, self.x)
        else:
            x, y = transform(self.crs, crs, self.x, self.y)

        if crs.is_geographic:
            x = np.where(logical_or(x < -180, x > 180), np.nan, x)
            y = np.where(logical_or(y < -90, y > 90), np.nan, y)

        geolocation = RasterGeolocation(x=x, y=y, crs=crs)

        return geolocation

    # def maximum_distance(self, distance_crs: Union[CRS, str] = None) -> float:
    #     """
    #     Calculate the maximum distance in meters between adjacent points in lat/lon geolocation arrays.
    #     :return: maximum distance in meters
    #     """
    #     # calculate centroid of boundary
    #     centroid = self.to_crs(crs=WGS84).centroid
    #
    #     # generate centered Azimuthal Equal Area CRS
    #     if distance_crs is None:
    #         distance_crs = CRS.center_aeqd(centroid)
    #
    #     # transform geolocation arrays to centered CRS
    #     x, y = transform(self.crs, distance_crs, self.x, self.y)
    #
    #     # find maximum difference between adjacent cells of projected geolocation arrays in both dimensions
    #     maximum_distance = np.nanmax([
    #         np.nanmax(np.diff(x, axis=0)),
    #         np.nanmax(np.diff(x, axis=1)),
    #         np.nanmax(np.diff(y, axis=0)),
    #         np.nanmax(np.diff(y, axis=1))
    #     ])
    #
    #     return maximum_distance

    def shifted_distances(self, rows, cols) -> np.ndarray:
        x = self.x
        y = self.y
        x_shifted = shift(x, (rows, cols), cval=np.nan)
        lat_shifted = shift(y, (rows, cols), cval=np.nan)
        differences = np.stack([x.flatten(), y.flatten()]) - np.stack([x_shifted.flatten(), lat_shifted.flatten()])
        differences = differences[:, ~np.any(np.isnan(differences), axis=0)]
        distances = np.linalg.norm(differences, axis=0)

        return distances

    @property
    def row_distances(self) -> np.ndarray:
        return self.shifted_distances(1, 0)

    @property
    def col_distances(self) -> np.ndarray:
        return self.shifted_distances(0, 1)

    @property
    def cell_size(self) -> float:
        return min([self.cell_width, abs(self.cell_height)])

    def cell_size_proj(self, crs: Union[CRS, str] = None) -> float:
        if crs is None:
            crs = self.center_aeqd

        projected_boundary = self.get_boundary(crs)
        x, y = projected_boundary.exterior.xy
        cell_width = (np.nanmax(x) - np.nanmin(x)) / self.cols
        cell_height = (np.nanmax(y) - np.nanmin(y)) / self.rows
        cell_size = np.nanmax([cell_width, cell_height])

        return cell_size

    @property
    def cell_size_meters(self) -> float:
        EQUATOR_CIRCUMFERENCE = 40075017.0
        if self._cell_size_meters is not None:
            return self._cell_size_meters

        if not self.is_geographic:
            return self.cell_size

        self._cell_size_meters = self.cell_size / 180.0 * EQUATOR_CIRCUMFERENCE

        return self._cell_size_meters

    def grid_to_size(
            self,
            cell_size_meters: float,
            target_crs: Union[CRS, str] = None,
            intermediate_crs: Union[CRS, str] = None,
            adjust_cell_size: bool = False):
        if intermediate_crs is None:
            intermediate_crs = self.center_aeqd

        if target_crs is None:
            target_crs = self.crs

        # validate destination CRS
        if not isinstance(target_crs, CRS):
            target_crs = CRS(target_crs)

        if np.isinf(cell_size_meters) or not cell_size_meters > 0:
            raise ValueError(f"invalid cell size {cell_size_meters}")

        # knowing spatial sampling rate in meters
        # calculate the number of rows and columns required to space evenly
        # between edges of extent
        x_min_cent, y_min_cent, x_max_cent, y_max_cent = self.bbox.transform(intermediate_crs)

        width_meters = x_max_cent - x_min_cent
        height_meters = y_max_cent - y_min_cent
        rows = max(int(height_meters / cell_size_meters), 1)
        cols = max(int(width_meters / cell_size_meters), 1)

        if not (rows > 0 and cols > 0):
            raise ValueError("invalid shape ({}, {}) calculated from width: {} height: {} cell: {} bbox: {}".format(
                rows,
                cols,
                width_meters,
                height_meters,
                cell_size_meters,
                (x_min_cent, y_min_cent, x_max_cent, y_max_cent)
            ))

        # now that you know the ideal dimensions, apply this size to the target coordinate system
        x_min_dest, y_min_dest, x_max_dest, y_max_dest = self.bbox.transform(target_crs)
        width_dest = x_max_dest - x_min_dest
        height_dest = y_max_dest - y_min_dest

        if adjust_cell_size or target_crs.is_geographic:
            cell_width = width_dest / cols
            cell_height = height_dest / rows
        else:
            cell_width = cell_size_meters
            cell_height = cell_size_meters

        # generate grid object
        grid = RasterGrid(x_min_dest, y_max_dest, cell_width, -cell_height, rows, cols, crs=target_crs)

        return grid

    def UTM(self, cell_size_meters: float) -> RasterGrid:
        crs = self.local_UTM_proj4

        grid = self.grid_to_size(
            cell_size_meters,
            target_crs=crs,
            intermediate_crs=crs
        )

        return grid

    def geographic(self, cell_size_degrees: float, snap=True) -> RasterGrid:
        crs = WGS84
        lon_min, lat_min, lon_max, lat_max = self.bbox.latlon

        if np.isinf(cell_size_degrees) or not cell_size_degrees > 0:
            raise ValueError(f"invalid cell size {cell_size_degrees}")

        width = lon_max - lon_min
        height = lat_max - lat_min
        rows = max(int(height / cell_size_degrees), 1)
        cols = max(int(width / cell_size_degrees), 1)

        if snap:
            lat_origin = int(lat_max / cell_size_degrees) * cell_size_degrees
            lon_origin = int(lon_min / cell_size_degrees) * cell_size_degrees
        else:
            lat_origin = lat_max
            lon_origin = lon_min

        # generate grid object
        grid = RasterGrid(
            lon_origin,
            lat_origin,
            cell_size_degrees,
            -cell_size_degrees,
            rows,
            cols,
            crs=crs
        )

        return grid

    def grid_to_shape(
            self,
            rows: int,
            cols: int,
            dest_crs: Union[CRS, str] = None) -> RasterGrid:
        if dest_crs is None:
            dest_crs = self.crs

        # validate destination CRS
        if not isinstance(dest_crs, CRS):
            dest_crs = CRS(dest_crs)

        # now that you know the ideal dimensions, apply this size to the target coordinate system
        x_min_dest, y_min_dest, x_max_dest, y_max_dest = self.bbox.transform(dest_crs)
        width_dest = x_max_dest - x_min_dest
        height_dest = y_max_dest - y_min_dest

        cell_width = width_dest / cols
        cell_height = height_dest / rows

        # generate grid object
        grid = RasterGrid(x_min_dest, y_max_dest, cell_width, -cell_height, rows, cols, crs=dest_crs)

        return grid

    def grid_to_crs(
            self,
            target_crs: Union[CRS, str] = None,
            target_cell_size: float = None) -> RasterGrid:
        if target_crs is None:
            target_crs = self.crs

        # validate destination CRS
        if not isinstance(target_crs, CRS):
            target_crs = CRS(target_crs)

        x = self.x
        y = self.y

        if self.is_geographic:
            warnings.filterwarnings('ignore')

            invalid = logical_or(
                logical_or(x < -180, x > 180),
                logical_or(y < -90, y > 90)
            )

            x = np.where(invalid, np.nan, x)
            y = np.where(invalid, np.nan, y)

            warnings.resetwarnings()

        # transform source geolocation arrays to destination CRS

        source_x_trans, source_y_trans = Transformer.from_crs(self.crs, target_crs).transform(x, y)

        # source_x_trans, source_y_trans = transform(source_crs, target_crs, x, y)

        if not (isfinite(source_x_trans).any() or isfinite(source_y_trans).any()):
            raise ValueError(
                f"transformed x {source_x_trans} and transformed y {source_y_trans} from x {x} and y {y}")

        # calculate average cell size of source coordinate field in destination CRS
        if target_cell_size is None:
            target_cell_size = self.to_crs(crs=target_crs).cell_size

        if not isfinite(target_cell_size):
            raise ValueError(f"invalid cell size from x {self.x} and y {self.y}")

        # calculate the western boundary of the grid
        x_min = np.nanmin(source_x_trans[isfinite(source_x_trans)]) - target_cell_size / 2.0

        if not isfinite(x_min):
            raise ValueError("invalid x minimum")

        # calculate the eastern boundary of the grid
        x_max = np.nanmax(source_x_trans[isfinite(source_x_trans)]) + target_cell_size / 2.0

        if not isfinite(x_max):
            raise ValueError("invalid x maximum")

        # calculate the width of the grid in projected units
        width = x_max - x_min

        if not isfinite(width):
            raise ValueError(f"width {width} from x max {x_max} and x min {x_min}")

        try:
            # calculate the number of array columns needed to represent the projected width at its cell size
            cols = int(width / target_cell_size)
        except Exception as e:
            raise ValueError(f"can't compute cols from width {width} and cell size {target_cell_size}")

        # calculate the southern boundary of the grid
        y_min = np.nanmin(source_y_trans[isfinite(source_y_trans)]) - target_cell_size / 2.0

        if not isfinite(y_min):
            raise ValueError("invalid y minimum")

        # calculate the northern boundary of the grid
        y_max = np.nanmax(source_y_trans[isfinite(source_y_trans)]) + target_cell_size / 2.0

        if not isfinite(y_max):
            raise ValueError("invalid y maximum")

        # calculate the height of the grid in projected units
        height = y_max - y_min

        # calculate the number of array rows needed to represent the projected height at its cell size
        rows = int(height / target_cell_size)

        # generate grid object
        grid = RasterGrid(x_min, y_max, target_cell_size, -target_cell_size, rows, cols, crs=target_crs)

        return grid

    def generate_grid(
            self,
            dest_crs: Union[CRS, str] = None,
            cell_size: float = None,
            cell_size_meters: float = None,
            rows: int = None,
            cols: int = None):
        """
        This method generates a projected grid in the same extent and resolution as a given swath.
        :param dest_crs: coordinate reference system of the desired CRS as proj4 string or pyproj.CRS
        :return: CoordinateGrid object
        """
        if rows is not None and cols is not None:
            return self.grid_to_shape(rows, cols, dest_crs=dest_crs)
        if cell_size_meters is not None:
            return self.grid_to_size(cell_size_meters, target_crs=dest_crs)
        else:
            return self.grid_to_crs(target_crs=dest_crs, target_cell_size=cell_size)

    def reproject(self, crs: Union[CRS, str], cell_size: float):
        return self.generate_grid(dest_crs=crs, cell_size=cell_size)

    @classmethod
    def from_dict(cls, parameters):
        """
        Parse dictionary of CRS parameters into RasterGeometry object.
        :return: new RasterGeolocation or RasterGrid object encapsulating parameters read from dict
        """

        # TODO this should conform to the CoverageJSON standard

        if 'type' not in parameters:
            raise ValueError("CRS parameters must specify 'type' as 'swath' or 'grid'")

        geometry_type = parameters['type']

        try:
            geometry_type = geometry_type.decode()
        except:
            pass

        if 'crs' not in parameters:
            raise ValueError("CRS parameters must specify 'crs' as proj4 string")

        proj4_string = parameters['crs']

        try:
            proj4_string = proj4_string.decode()
        except:
            pass

        try:
            crs = CRS(proj4_string)
        except Exception as e:
            cls.logger.exception(e)
            raise ValueError(f"problem with CRS string: {proj4_string}")

        if geometry_type == 'swath':
            # validate coordinate field

            if 'x' in parameters and 'y' in parameters:
                x = np.array(parameters['x'])
                y = np.array(parameters['y'])
            elif crs.is_geographic and 'latitude' in parameters and 'longitude' in parameters:
                x = np.array(parameters['longitude'])
                y = np.array(parameters['latitude'])
            elif crs.is_geographic and 'lat' in parameters and 'lon' in parameters:
                x = np.array(parameters['lon'])
                y = np.array(parameters['lat'])
            else:
                raise ValueError("coordinate field must specify 'x' and 'y' geolocation arrays")

            return RasterGeolocation(crs=crs, x=x, y=y)

        elif geometry_type == 'grid':
            # validate coordinate grid

            if 'rows' not in parameters or 'cols' not in parameters:
                raise ValueError("coordinate grid must specify 'rows' and 'cols'")

            rows = int(parameters['rows'])
            cols = int(parameters['cols'])

            if 'cell_width' not in parameters:
                raise ValueError("coordinate grid must specify 'cell_width'")

            cell_width = float(parameters['cell_width'])

            if not cell_width > 0:
                raise ValueError("parameter 'cell_width' must be positive width of cell in units of CRS")

            if 'cell_height' not in parameters:
                raise ValueError("coordinate grid must specify 'cell_height")

            cell_height = float(parameters['cell_height'])

            if not cell_height < 0:
                raise ValueError("parameter 'cell_height' must be negative height of cell in units of CRS")

            if 'x_origin' not in parameters:
                raise ValueError("coordinate grid must specify 'x_origin' x-coordinate of top-left corner of extent")

            x_origin = float(parameters['x_origin'])

            if 'y_origin' not in parameters:
                raise ValueError("coordinate grid must specify 'y_origin' y-coordinate of top-left corner of extent")

            y_origin = float(parameters['y_origin'])

            return RasterGrid(
                x_origin=x_origin,
                y_origin=y_origin,
                cell_width=cell_width,
                cell_height=cell_height,
                rows=rows,
                cols=cols,
                crs=crs
            )
        else:
            raise ValueError("geometry {} not recognized, must specify 'swath' or 'grid'".format(geometry_type))

    @abstractmethod
    def to_dict(self):
        pass

    @property
    def to_json(self) -> str:
        # TODO implement CoverageJSON
        # https://www.w3.org/TR/covjson-overview/
        raise NotImplementedError()

    def mosaic_geometry(
            self,
            source_geometries,
            source_cell_size_meters=None,
            target_cell_size_meters=None,
            rows=None,
            cols=None,
            mosaic_to_target_cell_size=False):

        if source_cell_size_meters is None:
            if self.is_geographic:
                # noinspection PyTypeChecker
                source_cell_size_meters = float(np.mean([
                    geometry.cell_size_meters
                    for geometry
                    in source_geometries
                ]))

        if source_cell_size_meters is not None and target_cell_size_meters is not None:
            if source_cell_size_meters == target_cell_size_meters:
                return self

        if self.shape == (rows, cols):
            return self

        if source_cell_size_meters is not None and target_cell_size_meters is not None:
            if mosaic_to_target_cell_size:
                mosaic_cell_size_meters = target_cell_size_meters
            else:
                mosaic_cell_size_meters = source_cell_size_meters

            if target_cell_size_meters > source_cell_size_meters:
                mosaic_cell_size_meters = target_cell_size_meters

        else:
            mosaic_cell_size_meters = None

        if mosaic_cell_size_meters is not None and np.isinf(mosaic_cell_size_meters):
            mosaic_cell_size_meters = None

        # mosaic geometry needs a buffer around it to prevent gaps at edge of scene
        mosaic_geometry = self.generate_grid(
            cell_size_meters=mosaic_cell_size_meters,
            rows=rows,
            cols=cols
        ).buffer(3)

        return mosaic_geometry

    # @profile
    def kd_tree(self, geometry: RasterGeometry) -> KDTree:
        return KDTree(self, geometry)

    # @property
    # def pixel_centroids(self) -> gpd.GeoDataFrame:
    #     x, y = self.xy
    #     df = pd.DataFrame.from_dict({"x": x.flatten(), "y": y.flatten()})
    #     geometry = df.apply(lambda point: shapely.geometry.Point(point.x, point.y), axis=1)
    #     gdf = gpd.GeoDataFrame({}, geometry=geometry, crs=self.crs)
    #
    #     return gdf

    @property
    def pixel_centroids(self) -> MultiPoint:
        x, y = self.xy
        pixel_centroids = wrap_geometry(MultiPoint(np.stack([x.flatten(), y.flatten()], axis=1)), crs=self.crs)

        return pixel_centroids

    @property
    def pixel_outlines(self) -> MultiPolygon:
        x, y = self.xy
        x = x.flatten()
        y = y.flatten()
        x_min = x - self.cell_width / 2
        x_max = x + self.cell_width / 2
        y_min = y + self.cell_height / 2
        y_max = y - self.cell_height / 2

        ul = np.stack([x_min, y_max], axis=1)
        ur = np.stack([x_max, y_max], axis=1)
        lr = np.stack([x_max, y_min], axis=1)
        ll = np.stack([x_min, y_min], axis=1)
        stack = np.stack([ul, ur, lr, ll], axis=1)

        pixel_outlines = MultiPolygon(
            gpd.GeoDataFrame({}, geometry=[pygeos.creation.multipolygons(stack)]).geometry[0],
            crs=self.crs
        )

        return pixel_outlines


class RasterGeolocation(RasterGeometry):
    """
    This class encapsulates the geolocation of swath data using geolocation arrays.
    """

    def __init__(
            self,
            x: np.ndarray,
            y: np.ndarray,
            crs: Union[CRS, str] = WGS84,
            **kwargs):
        """
        :param x: two-dimensional x-coordinate geolocation array
        :param y: two-dimensional y-coordinate geolocation array
        :param crs: CRS as proj4 string or pyproj.CRS object
        """
        super(RasterGeolocation, self).__init__(crs=crs, **kwargs)

        if np.any(np.isnan(x)):
            raise ValueError("x coordinate array contains NaN")

        if np.any(np.isnan(y)):
            raise ValueError("y coordinate array contains NaN")

        if not (isfinite(x).any() or isfinite(y).any()):
            raise ValueError("no valid coordinates given for coordinate field")

        self._x = x
        self._y = y

        if self.is_geographic:
            # self._x = where(logical_or(self._x <= 180, self._x >= 180), nan, self._x)
            # self._y = where(logical_or(self._y <= -90, self._y >= 90), nan, self._y)
            self._x = np.clip(self._x, -180, 179.9999)
            self._y = np.clip(self._y, -90, 90)

    def __eq__(self, other: RasterGeolocation) -> bool:
        return isinstance(other, RasterGeolocation) and \
               self.crs == other.crs and \
               np.array_equal(self.x, other.x) and \
               np.array_equal(self.y, other.y)

    def _slice(self, y_slice: slice, x_slice: slice) -> RasterGeometry:
        crs = self.crs
        x = self.x[y_slice, x_slice]
        y = self.y[y_slice, x_slice]
        subset = RasterGeolocation(x=x, y=y, crs=crs)

        return subset

    @classmethod
    def from_vectors(
            cls,
            x_vector: np.ndarray,
            y_vector: np.ndarray,
            crs: Union[CRS, str] = WGS84) -> RasterGeolocation:
        x, y = np.meshgrid(x_vector, y_vector)
        geolocation = RasterGeolocation(x, y, crs=crs)

        return geolocation

    def index_point(self, point: Point) -> (int, int):
        dist, index = KDTree(np.c_[self.x.ravel(), self.y.ravel()]).query((point.x, point.y))
        index = np.unravel_index(index, self.shape)

        return index

    def index(self, geometry: RasterGeometry or Point or Polygon or (float, float, float, float)):
        geometry = wrap_geometry(geometry)
        xmin, ymin, xmax, ymax = geometry.bbox.transform(self.crs)

        index = np.logical_and(
            np.logical_and(
                self.x >= xmin,
                self.x <= xmax
            ),
            np.logical_and(
                self.y >= ymin,
                self.y <= ymax
            )
        )

        return index

    @property
    def x(self) -> np.ndarray:
        return self._x

    @property
    def y(self) -> np.ndarray:
        return self._y

    @property
    def xy(self) -> (np.ndarray, np.ndarray):
        return self.x, self.y

    @property
    def rows(self) -> int:
        return self.x.shape[0]

    @property
    def cols(self) -> int:
        return self.y.shape[1]

    @property
    def x_min(self) -> float:
        return self.bbox.x_min

    @property
    def x_max(self) -> float:
        return self.bbox.x_max

    @property
    def y_min(self) -> float:
        return self.bbox.y_min

    @property
    def y_max(self) -> float:
        return self.bbox.y_max

    @property
    def width(self) -> float:
        """
        Width of extent in projected units.
        """

        x_max = self.x_max
        x_min = self.x_min

        if self.is_geographic and self.crosses_antimeridian:
            if x_max < 0:
                x_max += 360

            if x_min < 0:
                x_min += 360

        return x_max - x_min

    @property
    def height(self) -> float:
        """
        Height of extent in projected units.
        """
        return self.y_max - self.y_min

    @property
    def cell_size(self) -> float:
        return float(min(np.nanmedian(self.row_distances), np.nanmedian(self.col_distances)))

    @property
    def cell_width(self) -> float:
        """
        Positive cell width in units of CRS.
        """
        # FIXME this assumes north orientation
        # return self.width / self.cols
        return self.cell_size

    @property
    def cell_height(self) -> float:
        """
        Negative cell height in units of CRS.
        """
        # FIXME this assumes north orientation
        # return -1.0 * (self.height / self.rows)
        return -1 * self.cell_size

    @property
    def boundary(self) -> Polygon:
        y_indices, x_indices = self.boundary_indices
        x_boundary = self.x[y_indices, x_indices]
        y_boundary = self.y[y_indices, x_indices]
        points = np.c_[x_boundary, y_boundary]
        boundary = Polygon(points, crs=self.crs)

        return boundary

    @property
    def corner_polygon(self) -> Polygon:
        """
        Draw polygon through the corner coordinates of geolocation arrays.
        :return: shapely.geometry.Polygon of corner coordinate boundary
        """
        return Polygon([
            (self.x[0, 0], self.y[0, 0]),
            (self.x[0, self.x.shape[1] - 1], self.y[0, self.y.shape[1] - 1]),
            (self.x[self.x.shape[0] - 1, self.x.shape[1] - 1], self.y[self.y.shape[0] - 1, self.y.shape[1] - 1]),
            (self.x[self.x.shape[0] - 1, 0], self.y[self.y.shape[0] - 1, 0])
        ])

    def resize(self, dimensions: (int, int), order=2) -> RasterGeometry:
        if len(dimensions) != 2:
            raise ValueError("coordinate field dimensionality must be two-dimensional")

        rows_target, cols_target = dimensions

        if not isinstance(rows_target, int) or not isinstance(cols_target, int):
            raise ValueError(f"dimensions must be two-tuple of ints, not ({type(rows_target)}, {type(cols_target)})")

        zoom_factors = (float(rows_target) / float(self.rows), float(cols_target) / float(self.cols))
        use_shift = self.is_geographic and self.crosses_antimeridian

        x = self._x
        y = self._y

        if use_shift:
            x = np.where(x < 0, 360.0 + x, x)

        x = zoom(x, zoom_factors, order=order)
        y = zoom(y, zoom_factors, order=order)

        if use_shift:
            x = np.where(x >= 180.0, x - 360.0, x)

        resized_field = RasterGeolocation(x, y, crs=self.crs)

        return resized_field

    @property
    def grid(self) -> RasterGrid:
        return self.generate_grid(dest_crs=self.crs)

    def to_dict(self, output_dict=None, write_geolocation_arrays=False):
        # FIXME this should conform to the CoverageJSON standard
        if output_dict is None:
            output_dict = {}

        output_dict['type'] = 'swath'
        output_dict['crs'] = self.proj4
        output_dict['x'] = self.x
        output_dict['y'] = self.y
        output_dict['rows'] = self.rows
        output_dict['cols'] = self.cols

        if write_geolocation_arrays:
            lat, lon = self.latlon_matrices
            output_dict['latitude'] = lat
            output_dict['longitude'] = lon

        return output_dict


class OutOfBoundsError(Exception):
    """
    target geometry outside of given geometry
    """
    pass


class RasterGrid(RasterGeometry):
    """
    This class encapsulates the georeferencing of gridded data using affine transforms.
    Gridded surfaces are assumed north-oriented. Row and column rotation are not supported.
    """
    geometry_type = "grid"

    def __init__(
            self,
            x_origin: float,
            y_origin: float,
            cell_width: float,
            cell_height: float,
            rows: int,
            cols: int,
            crs: Union[CRS, str] = WGS84,
            **kwargs):
        super(RasterGrid, self).__init__(crs=crs, **kwargs)

        # assemble affine transform
        self._affine = Affine(cell_width, 0, x_origin, 0, cell_height, y_origin)

        # store dimensions
        self._rows = int(rows)
        self._cols = int(cols)

        # create blank geolocation attributes
        self._x = None
        self._y = None

    def _subset_index(self, y_slice: slice, x_slice: slice) -> RasterGrid:
        y_start, y_end, y_step = y_slice.indices(self.rows)
        x_start, x_end, x_step = x_slice.indices(self.cols)

        rows = y_end - y_start
        cols = x_end - x_start

        if y_start > 0:
            y_origin = self.y_origin + y_start * self.cell_height
        else:
            y_origin = self.y_origin

        if x_start > 0:
            x_origin = self.x_origin + x_start * self.cell_width
        else:
            x_origin = self.x_origin

        affine = Affine(
            self.affine.a,
            self.affine.b,
            x_origin,
            self.affine.d,
            self.affine.e,
            y_origin
        )

        subset = RasterGrid.from_affine(affine, rows, cols, self.crs)

        return subset

    def __eq__(self, other: RasterGrid) -> bool:
        return isinstance(other,
                          RasterGrid) and self.crs == other.crs and self.affine == other.affine and self.shape == other.shape

    @classmethod
    def from_affine(cls, affine: Affine, rows: int, cols: int, crs: Union[CRS, str] = WGS84):
        if not isinstance(affine, Affine):
            raise ValueError("affine is not an Affine object")

        return RasterGrid(affine.c, affine.f, affine.a, affine.e, rows, cols, crs)

    @classmethod
    def from_rasterio(cls, file: DatasetReader, crs: Union[CRS, str] = None, **kwargs) -> RasterGrid:
        # FIXME old version of rasterio uses affine, new version uses transform

        if hasattr(file, "affine"):
            affine = file.affine
        else:
            affine = file.transform

        if crs is None:
            if file.crs is None:
                crs = WGS84
            else:
                crs = file.crs

        return cls.from_affine(affine, file.height, file.width, crs)

    @classmethod
    def from_raster_file(cls, filename: str, **kwargs) -> RasterGrid:
        os.environ["CPL_ZIP_ENCODING"] = "UTF-8"

        with rasterio.open(filename, "r", **kwargs) as file:
            return cls.from_rasterio(file, **kwargs)

    @classmethod
    def open(cls, filename: str, **kwargs) -> RasterGrid:
        return cls.from_raster_file(filename=filename, **kwargs)

    @classmethod
    def from_vectors(cls, x_vector: np.ndarray, y_vector: np.ndarray, crs: Union[CRS, str] = WGS84):
        cols = len(x_vector)
        rows = len(y_vector)

        cell_width = np.nanmean(np.diff(x_vector))
        cell_height = np.nanmean(np.diff(y_vector))

        x_origin = x_vector[0] - cell_width / 2.0
        y_origin = y_vector[0] + cell_height / 2.0

        grid = RasterGrid(
            x_origin=x_origin,
            y_origin=y_origin,
            cell_width=cell_width,
            cell_height=cell_height,
            rows=rows,
            cols=cols,
            crs=crs
        )

        return grid

    @classmethod
    def from_bbox(
            cls,
            bbox: Union[BBox, Tuple[float]],
            shape: (int, int) = None,
            cell_size: float = None,
            cell_width: float = None,
            cell_height: float = None,
            crs: Union[CRS, str] = None):
        if (cell_width is None or cell_height is None) and cell_size is not None:
            cell_width = cell_size
            cell_height = -cell_size

        if crs is None and isinstance(bbox, BBox):
            crs = bbox.crs

        if crs is None:
            crs = WGS84

        xmin, ymin, xmax, ymax = bbox
        width = xmax - xmin
        height = ymax - ymin
        x_origin = xmin
        y_origin = ymax

        if shape is None:
            if cell_width is None or cell_height is None:
                raise ValueError("no cell size given")

            cell_width = float(cell_width)
            cell_height = float(cell_height)
            cols = width / cell_width
            rows = height / abs(cell_height)
        else:
            rows, cols = shape
            cell_width = width / cols
            cell_height = -height / rows

        grid = RasterGrid(
            x_origin=x_origin,
            y_origin=y_origin,
            cell_width=cell_width,
            cell_height=cell_height,
            rows=rows,
            cols=cols,
            crs=crs
        )

        return grid

    @classmethod
    def merge(cls, geometries: List[RasterGeometry], crs: CRS = None, cell_size: float = None) -> RasterGrid:
        if crs is None:
            crs = geometries[0].crs

        geometries = [geometry.to_crs(crs) for geometry in geometries]
        bbox = BBox.merge([geometry.bbox for geometry in geometries], crs=crs)

        if cell_size is None:
            cell_size = min([geometry.cell_size for geometry in geometries])

        geometry = RasterGrid.from_bbox(bbox=bbox, cell_size=cell_size, crs=crs)

        return geometry

    def get_bbox(self, CRS: Union[CRS, str] = None) -> BBox:
        bbox = BBox(xmin=self.x_min, ymin=self.y_min, xmax=self.x_max, ymax=self.y_max, crs=self.crs)

        if CRS is not None:
            bbox = bbox.transform(CRS)

        return bbox

    bbox = property(get_bbox)

    @property
    def affine(self) -> Affine:
        """
        Affine transform of top-left corners of cells.
        """
        return self._affine

    @property
    def affine_center(self) -> Affine:
        """
        Affine transform of cell centroids.
        """
        return self.affine * Affine.translation(0.5, 0.5)

    @property
    def cell_width(self) -> float:
        """
        Positive cell width in units of CRS.
        """
        return self.affine.a

    @property
    def width(self) -> float:
        return self.cell_width * self.cols

    @property
    def x_origin(self) -> float:
        """
        X-coordinate of top-left corner of extent.
        """
        return self.affine.c

    @property
    def cell_height(self) -> float:
        """
        Negative cell height in units of CRS.
        """
        return self.affine.e

    @property
    def height(self) -> float:
        return abs(self.cell_height) * self.rows

    @property
    def y_origin(self) -> float:
        """
        Y-coordinate of top-left corner of extent.
        """
        return self.affine.f

    @property
    def rows(self) -> int:
        """
        Height of gridded surface in rows.
        """
        return self._rows

    @property
    def cols(self) -> int:
        """
        Width of gridded surface in columns.
        """
        return self._cols

    @property
    def grid(self) -> RasterGrid:
        return RasterGrid.from_affine(self.affine, self.rows, self.cols, self.crs)

    @property
    def corner_polygon(self) -> Polygon:
        """
        Draw polygon through the corner coordinates of geolocation arrays.
        :return: shapely.geometry.Polygon of corner coordinate boundary
        """
        return Polygon([
            (self.x_origin, self.y_origin),
            (self.x_origin + self.width, self.y_origin),
            (self.x_origin + self.width, self.y_origin - self.height),
            (self.x_origin, self.y_origin - self.height)
        ], crs=self.crs)

    @property
    def corner_polygon_latlon(self) -> Polygon:
        """
        Draw polygon through the corner coordinates of geolocation arrays in lat/lon.
        :return: shapely.geometry.Polygon of corner coordinate boundary
        """
        polygon = Polygon([
            (self.x_origin, self.y_origin),
            (self.x_origin + self.width, self.y_origin),
            (self.x_origin + self.width, self.y_origin - self.height),
            (self.x_origin, self.y_origin - self.height)
        ], crs=self.crs)

        polygon_latlon = polygon.to_crs(WGS84)

        return polygon_latlon

    @property
    def boundary(self) -> Polygon:
        if self.shape == (1, 1):
            return Polygon(LinearRing([
                (self.x_min, self.y_max),
                (self.x_max, self.y_max),
                (self.x_max, self.y_min),
                (self.x_min, self.y_min)
            ]))

        y_indices, x_indices = self.boundary_indices
        x_boundary, y_boundary = self.affine_center * (x_indices, y_indices)
        points = np.c_[x_boundary, y_boundary]
        boundary = Polygon(points, crs=self.crs)

        return boundary

    def resolution(self, cell_size: float or (float, float)) -> RasterGrid:
        if len(cell_size) == 1:
            cell_width = cell_size
            cell_height = -cell_size
        elif len(cell_size) == 2:
            cell_width, cell_height = cell_size
        else:
            raise ValueError(f"invalid cell size: {cell_size}")

        rows = int(self.height / abs(cell_height))
        cols = int(self.width / cell_width)
        affine = self.affine
        new_affine = Affine(cell_width, affine.b, affine.c, affine.d, cell_height, affine.f)
        grid = RasterGrid.from_affine(new_affine, rows, cols, crs=self.crs)

        return grid

    def resize(self, dimensions: (int, int), keep_square=True) -> RasterGeometry:
        rows, cols = dimensions
        cell_height = self.cell_height * (float(self.rows) / float(rows))
        cell_width = self.cell_width * (float(self.cols) / float(cols))

        if abs(cell_height) != cell_width:
            cell_height = -cell_width

        resized_grid = RasterGrid(
            self.x_origin,
            self.y_origin,
            cell_width,
            cell_height,
            rows,
            cols,
            self.crs
        )

        return resized_grid

    def rescale(self, cell_size: float = None, rows: int = None, cols: int = None):
        if rows is None and cols is None:
            rows = int(self.height / cell_size)
            cols = int(self.width / cell_size)

        if cell_size is None:
            cell_width = self.width / cols
            cell_height = -1 * (self.height / rows)
        else:
            cell_width = cell_size
            cell_height = -cell_size

        grid = RasterGrid(
            x_origin=self.x_origin,
            y_origin=self.y_origin,
            cell_width=cell_width,
            cell_height=cell_height,
            rows=rows,
            cols=cols,
            crs=self.crs
        )

        return grid

    def buffer(self, pixels: int) -> RasterGrid:
        return RasterGrid(
            x_origin=self.x_origin - (pixels * self.cell_width),
            y_origin=self.y_origin - (pixels * self.cell_height),
            cell_width=self.cell_width,
            cell_height=self.cell_height,
            rows=self.rows + pixels * 2,
            cols=self.cols + pixels * 2,
            crs=self.crs
        )

    @property
    def x_vector(self) -> np.ndarray:
        """
        Vector of x-coordinates.
        """
        return (self.affine_center * (np.arange(self.cols), np.full(self.cols, 0, dtype=np.float32)))[0]

    @property
    def y_vector(self) -> np.ndarray:
        """
        Vector of y-coordinates.
        """
        return (self.affine_center * (np.full(self.rows, 0, dtype=np.float32), np.arange(self.rows)))[1]

    @property
    def xy(self) -> (np.ndarray, np.ndarray):
        """
        Geolocation arrays.
        """
        return self.affine_center * np.meshgrid(np.arange(self.cols), np.arange(self.rows))

    def index_point(self, point: Point) -> (int, int):
        native_point = point.to_crs(self.crs)
        x = native_point.x
        y = native_point.y
        col, row = ~self.affine_center * (x, y)
        col = int(round(col))
        row = int(round(row))
        index = (row, col)

        return index

    def index(self, geometry: Union[SpatialGeometry, (float, float, float, float)]):
        geometry = wrap_geometry(geometry)
        xmin, ymin, xmax, ymax = geometry.bbox.transform(self.crs)

        row_start, col_start = self.index_point(Point(xmin, ymax, crs=self.crs))
        row_end, col_end = self.index_point(Point(xmax, ymin, crs=self.crs))
        row_end += 1
        col_end += 1

        rows, cols = self.shape

        if row_end < 0 or col_end < 0 or row_start > rows or col_start > cols:
            raise OutOfBoundsError(
                f"target geometry is not within source geometry row_start: {row_start} row_end: {row_end} col_start: {col_start} col_end: {col_end} rows: {rows} cols: {cols}\nsource geometry:\n{self}\ntarget geometry:\n{geometry}")

        row_start = max(row_start, 0)
        col_start = max(col_start, 0)
        row_end = min(row_end, rows)
        col_end = min(col_end, cols)

        index = (slice(row_start, row_end), slice(col_start, col_end))

        return index

    def window(
            self,
            geometry: Union[SpatialGeometry, (float, float, float, float)],
            buffer: int = None) -> Window:
        geometry = wrap_geometry(geometry)
        xmin, ymin, xmax, ymax = geometry.bbox.transform(self.crs)

        row_start, col_start = self.index_point(Point(xmin, ymax, crs=self.crs))
        row_end, col_end = self.index_point(Point(xmax, ymin, crs=self.crs))
        row_end += 1
        col_end += 1

        rows, cols = self.shape

        if row_end < 0 or col_end < 0 or row_start > rows or col_start > cols:
            raise OutOfBoundsError("target geometry is not within source geometry")

        if buffer is not None:
            row_start -= buffer
            col_start -= buffer
            row_end += buffer
            col_end += buffer

        row_start = max(row_start, 0)
        col_start = max(col_start, 0)
        row_end = min(row_end, rows)
        col_end = min(col_end, cols)

        window = Window(
            col_off=col_start,
            row_off=row_start,
            width=(col_end - col_start),
            height=(row_end - row_start)
        )

        return window

    def subset(self, target: Union[Window, Point, Polygon, BBox, RasterGeometry]) -> RasterGrid:
        if not isinstance(target, Window):
            target = self.window(target)

        slices = target.toslices()
        subset = self[slices]

        return subset

    @property
    def x(self) -> np.ndarray:
        """
        Geolocation array of x-coordinates.
        """
        # cache x-coordinate array
        if self._x is None:
            self._x = self.xy[0]

        return self._x

    @property
    def y(self) -> np.ndarray:
        """
        Geolocation array of y-coordinates.
        """
        # cache y-coordinate array
        if self._y is None:
            self._y = self.xy[1]

        return self._y

    @property
    def x_min(self) -> float:
        """
        Western boundary of extent.
        """
        return self.x_origin

    @property
    def x_max(self) -> float:
        """
        Eastern boundary of extent.
        """
        return self.x_origin + self.width

    @property
    def y_min(self) -> float:
        return self.y_origin - self.height

    @property
    def y_max(self) -> float:
        return self.y_origin

    def rasterize(
            self,
            shapes,
            shape_crs=None,
            fill=0,
            all_touched=False,
            merge_alg=MergeAlg.replace,
            default_value=1,
            dtype=None) -> Raster:
        if not isinstance(shapes, Iterable):
            shapes = [shapes]

        shapes = [
            wrap_geometry(shape, crs=shape_crs).to_crs(self.crs)
            for shape
            in shapes
        ]

        image = Raster(
            rasterio.features.rasterize(
                shapes=shapes,
                out_shape=self.shape,
                fill=fill,
                transform=self.affine,
                all_touched=all_touched,
                merge_alg=merge_alg,
                default_value=default_value,
                dtype=dtype
            ),
            geometry=self
        )

        return image

    def mask(
            self,
            geometries: gpd.GeoDataFrame,
            all_touched: bool = False,
            invert: bool = False) -> RasterGrid:
        mask_array = rasterio.features.geometry_mask(
            geometries,
            self.shape,
            self.affine,
            all_touched=all_touched,
            invert=invert
        )

        mask_raster = Raster(mask_array, geometry=self)

        return mask_raster

    @property
    def coverage(self) -> OrderedDict:
        coverage = OrderedDict()
        coverage["type"] = "Coverage"
        domain = OrderedDict()
        domain["type"] = "Domain"
        domain["domainType"] = "Grid"
        axes = OrderedDict()
        x = OrderedDict()
        x["start"] = self.x_min + self.cell_width / 2
        x["stop"] = self.x_max - self.cell_width / 2
        x["num"] = self.cols
        axes["x"] = x
        y = OrderedDict()
        y["start"] = self.y_min - self.cell_height / 2
        y["stop"] = self.y_max + self.cell_height / 2
        y["num"] = self.rows
        axes["y"] = y
        domain["axes"] = axes
        coverage["domain"] = domain
        coverage["referencing"] = [self.crs.coverage]

        return coverage

    def to_dict(self, output_dict=None, write_geolocation_arrays=False):
        if output_dict is None:
            output_dict = {}

        output_dict['type'] = 'grid'
        output_dict['crs'] = self.proj4
        output_dict['cell_width'] = self.cell_width
        output_dict['cell_height'] = self.cell_height
        output_dict['x_origin'] = self.x_origin
        output_dict['y_origin'] = self.y_origin
        output_dict['rows'] = self.rows
        output_dict['cols'] = self.cols

        if write_geolocation_arrays:
            lat, lon = self.latlon_matrices
            output_dict['latitude'] = lat
            output_dict['longitude'] = lon

        return output_dict


class Raster:
    DEFAULT_GEOTIFF_COMPRESSION = "deflate"

    logger = logging.getLogger(__name__)

    def __init__(
            self,
            array: np.ndarray or Raster,
            geometry: RasterGeometry,
            nodata=None,
            cmap=None,
            metadata: dict = None,
            **kwargs):
        ALLOWED_ARRAY_TYPES = (
            np.ndarray,
            h5py.Dataset
        )

        if isinstance(array, Raster):
            array = array.array

        if not isinstance(array, ALLOWED_ARRAY_TYPES):
            raise TypeError('data is not a valid numpy.ndarray')

        ndim = len(array.shape)

        if ndim != 2:
            raise ValueError('data is not a two-dimensional array')

        dtype = array.dtype

        if dtype in (np.float32, np.float64):
            array = np.where(array == nodata, np.nan, array)

        self._array = array

        if nodata is None:
            if dtype in (np.float32, np.float64):
                nodata = np.nan

        self._nodata = nodata
        self._metadata = {}

        if metadata is not None:
            for key, value in metadata.items():
                self._metadata[key] = value

        for key, value in kwargs.items():
            if key == "metadata":
                continue

            self._metadata[key] = value

        if isinstance(geometry, RasterGeometry):
            self._geometry = geometry
        else:
            raise ValueError(f"geometry is not a valid RasterGeometry object: {type(geometry)}")

        self.cmap = cmap
        self._source_metadata = {}

    @property
    def array(self) -> np.ndarray:
        return self._array

    @property
    def dtype(self):
        return self._array.dtype

    def __array_prepare__(self, other: np.ndarray or Raster, *args, **kwargs) -> np.ndarray:
        if isinstance(other, Raster):
            array = other.array
        elif isinstance(other, np.ndarray):
            array = other
        else:
            raise ValueError("cannot prepare array")

        return array

    def __array_wrap__(self, other: np.ndarray or Raster, **kwargs) -> Raster:
        if isinstance(other, Raster):
            other = other.array
        elif isinstance(other, np.ndarray):
            other = other
        else:
            raise ValueError("cannot prepare array")

        return self.contain(other)

    def __array_finalize__(self, other: np.ndarray or Raster, **kwargs) -> Raster:
        if isinstance(other, Raster):
            other = other.array
        elif isinstance(other, np.ndarray):
            other = other
        else:
            raise ValueError("cannot prepare array")

        return self.contain(other)

    def __add__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__add__(data, *args, **kwargs))

        return result

    __radd__ = __add__

    def __sub__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__sub__(data, *args, **kwargs))

        return result

    def __rsub__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        return self.contain(other - self.array)

    def __neg__(self):
        return self.contain(-(self.array))

    def __mul__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__mul__(data, *args, **kwargs))

        return result

    __rmul__ = __mul__

    def __pow__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__pow__(data, *args, **kwargs))

        return result

    def __rpow__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(data ** self.array)

        return result

    def __div__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__div__(data, *args, **kwargs))

        return result

    def __truediv__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__truediv__(data, *args, **kwargs))

        return result

    def __rtruediv__(self, other):
        return self.contain(other / self.array)

    def __floordiv__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__floordiv__(data, *args, **kwargs))

        return result

    def __mod__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__mod__(data, *args, **kwargs))

        return result

    def __lshift__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__lshift__(data, *args, **kwargs))

        return result

    def __rshift__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__rshift__(data, *args, **kwargs))

        return result

    def __and__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__and__(data, *args, **kwargs))

        return result

    def __or__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__or__(data, *args, **kwargs))

        return result

    def __xor__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__xor__(data, *args, **kwargs))

        return result

    def __invert__(self, *args, **kwargs) -> Raster:
        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__invert__(*args, **kwargs))

        return result

    def __lt__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__lt__(data, *args, **kwargs))

        return result

    def __le__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__le__(data, *args, **kwargs))

        return result

    def __gt__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__gt__(data, *args, **kwargs))

        return result

    def __ge__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__ge__(data, *args, **kwargs))

        return result

    def __cmp__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__cmp__(data, *args, **kwargs))

        return result

    def __eq__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__eq__(data, *args, **kwargs))

        return result

    def __ne__(self, other: Raster or np.ndarray, *args, **kwargs) -> Raster:
        if isinstance(other, Raster):
            data = other.array
        else:
            data = other

        with np.errstate(invalid='ignore'):
            result = self.contain(self.array.__ne__(data, *args, **kwargs))

        return result

    def color(self, cmap) -> Raster:
        self.cmap = cmap

        return self

    def astype(self, type) -> Raster:
        return self.contain(self._array.astype(type))

    @classmethod
    def open(
            cls,
            filename: str,
            nodata=None,
            remove=None,
            geometry: RasterGeometry = None,
            buffer: int = None,
            window: Window = None,
            resampling: str = None,
            cmap: Union[Colormap, str] = None,
            **kwargs) -> Raster:
        target_geometry = geometry

        if filename.startswith("~"):
            filename = expanduser(filename)

        if ":" not in filename and not exists(filename):
            raise IOError(f"raster file not found: {filename}")

        source_geometry = RasterGrid.open(filename)

        if window is None and target_geometry is not None:
            window = source_geometry.window(geometry=target_geometry, buffer=buffer)

        if window is not None and not isinstance(window, Window):
            raise ValueError("invalid window")

        with rasterio.open(filename, "r", **kwargs) as file:
            if file.count != 1:
                raise IOError(f"raster file with {file.count} bands is not single-band: {filename}")

            if nodata is None:
                nodata = file.nodata

            if window is None:
                data = file.read(1)
                geometry = source_geometry
            else:
                data = file.read(1, window=window)

                if remove is not None:
                    data = np.where(data == remove, nodata, data)

                rows, cols = data.shape
                CRS = file.crs
                target_affine = file.window_transform(window)

                geometry = RasterGrid.from_affine(
                    affine=target_affine,
                    rows=rows,
                    cols=cols,
                    crs=CRS
                )

        image = Raster(data, geometry, nodata=nodata, filename=filename, cmap=cmap, **kwargs)

        if isinstance(target_geometry, RasterGeometry):
            image = image.to_geometry(target_geometry, resampling=resampling)

        return image

    @classmethod
    def merge(
            cls,
            images: List[Raster],
            geometry: RasterGeometry = None,
            crs: CRS = None,
            cell_size: float = None,
            dtype: str = None) -> Raster:
        if geometry is None:
            geometries = [image.geometry for image in images]
            geometry = RasterGrid.merge(geometries=geometries, crs=crs, cell_size=cell_size)

        if dtype is None:
            dtype = images[0].dtype

        if "float" in str(dtype):
            composite_sum = Raster(np.full(geometry.shape, 0, dtype=dtype), geometry=geometry)
            composite_count = Raster(np.full(geometry.shape, 0, dtype=np.uint16), geometry=geometry)

            for image in images:
                projected_image = image.to_geometry(geometry)
                composite_sum = where(np.isnan(projected_image), composite_sum, composite_sum + projected_image)
                projected_tile_count = where(np.isnan(projected_image), 0, 1)
                composite_count = composite_count + projected_tile_count

            composite_image = where(composite_count > 0, composite_sum / composite_count, np.nan)
        else:
            composite_image = Raster(np.full(geometry.shape, 0), geometry=geometry)

            for image in images:
                projected_image = image.to_geometry(geometry)
                composite_image = where(np.isnan(projected_image), composite_image, projected_image)

        return composite_image

    @classmethod
    def from_geotiff(cls, filename: str, **kwargs) -> Raster:
        if not filename.endswith(".tif") or filename.endswith(".tiff"):
            raise ValueError("invalid GeoTIFF filename")

        return cls.from_file(filename, **kwargs)

    # hidden methods

    @staticmethod
    def _raise_unrecognized_key(key):
        raise IndexError(f"key unrecognized: {key}")

    def contain(self, array=None, geometry=None, nodata=None) -> Raster:
        if array is None:
            array = self.array

        if geometry is None:
            geometry = self.geometry

        if np.ndim(array) < 2:
            return array

        if nodata is None:
            nodata = self.nodata

        # try:
        if len(array.shape) == 2:
            return Raster(
                array,
                nodata=nodata,
                metadata=self.metadata,
                cmap=self.cmap,
                geometry=geometry
            )
        elif len(array.shape) == 3:
            return MultiRaster(
                array,
                nodata=nodata,
                metadata=self.metadata,
                cmap=self.cmap,
                geometry=geometry
            )
        else:
            raise ValueError(f"invalid raster array with shape {array.shape}")
        # except Exception as e:
        #     return array

    def _contain_func(self, func):
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)

            if result.shape == self.shape:
                return self.contain(result)
            else:
                return result

        return wrapper

    def _slice_coords(self, y_slice: slice, x_slice: slice) -> Raster:
        return self._slice(*self.geometry._translate_coord_slices(y_slice, x_slice))

    def _slice(self, y_slice: slice, x_slice: slice) -> Raster:
        if any([any([isinstance(index, float) for index in (slice.start, slice.stop, slice.step)]) for slice in
                (y_slice, x_slice)]):
            return self._slice_coords(y_slice, x_slice)

        result = self.array[y_slice, x_slice]
        new_shape = []

        for i, s in enumerate((y_slice, x_slice)):
            indices = s.indices(self.shape[i])
            new_length = indices[1] - indices[0]
            new_shape.append(new_length)

        result.shape = new_shape
        subset_geometry = self.geometry[y_slice, x_slice]
        raster = self.contain(result, geometry=subset_geometry)

        return raster

    def _key(self, key):

        if key is Ellipsis:
            return self.array[...]

        slices = []

        for i in range(2):
            if i > len(key) - 1:
                slices.append(slice(None, None))
            elif isinstance(key[i], int):
                slices.append(slice(key[i], key[i] + 1, None))
            elif isinstance(key[i], slice):
                slices.append(key[i])
            elif key[i] is Ellipsis:
                slices.append(key[i])
            else:
                raise TypeError(f"invalid index: {key[i]}")

        y_slice, x_slice = slices

        return self._slice(y_slice, x_slice)

    def __getitem__(self, key):
        if isinstance(key, (slice, int, tuple)):
            return self._key(key)
        elif isinstance(key, string_types):
            return self.metadata[key]
        elif isinstance(key, (Raster, np.ndarray)):
            result = self.array[key]
            return result
        else:
            Raster._raise_unrecognized_key(key)

    def __setitem__(self, key, value):
        if isinstance(key, slice):
            self.array[slice] = value
        elif isinstance(key, string_types):
            self.metadata[key] = value
        elif isinstance(key, (Raster, np.ndarray)):
            self.array[np.array(key)] = value
        else:
            try:
                self.array[np.array(key)] = value
            except Exception as e:
                Raster._raise_unrecognized_key(key)

    def __getattr__(self, item):
        if hasattr(self.array, item):
            result = getattr(self.array, item)

            if callable(result):
                return self._contain_func(result)
            else:
                return self.contain(result)

    @property
    def valid_mask(self) -> Raster:
        data = ~np.logical_or(np.isnan(self.array), self.array == self.nodata)
        mask = self.contain(array=data)

        return mask

    def trim(self, mask: np.ndarray or Raster = None) -> Raster:
        if mask is None:
            if self.dtype in (np.float32, np.float64):
                mask = ~np.isnan(self.array)
            else:
                mask = self.array.astype(bool)

        mask = ~mask

        first_row, last_row = np.where(~mask.all(axis=1))[0][[0, -1]]
        first_col, last_col = np.where(~mask.all(axis=0))[0][[0, -1]]
        last_row = last_row + 1
        last_col = last_col + 1
        subset = self[first_row:last_row, first_col:last_col]

        return subset

    trimmed = property(trim)

    # read-only properties

    @property
    def nodata(self):
        """
        Nodata value.
        """
        return self._nodata

    @nodata.setter
    def nodata(self, nodata):
        self._nodata = nodata

    @property
    def metadata(self) -> dict:
        """
        Dictionary of metadata.
        """
        return self._metadata

    @property
    def geometry(self) -> RasterGeometry:
        """
        Georeferencing object.
        """
        return self._geometry

    @property
    def crs(self) -> CRS:
        return self.geometry.crs

    @property
    def is_geographic(self) -> bool:
        return self.geometry.is_geographic

    @property
    def proj4(self) -> str:
        return self.geometry.proj4

    @property
    def shape(self) -> (int, int):
        """
        Tuple of dimension sizes.
        """
        return self.array.shape

    @property
    def rows(self) -> int:
        """
        Count of rows.
        """
        return self.shape[0]

    @property
    def cols(self) -> int:
        """
        Count of columns.
        """
        return self.shape[1]

    @property
    def xy(self) -> (np.ndarray, np.ndarray):
        """
        Tuple containing two dimensional array of x coordinates and two dimensional array of y coordinates.
        """
        return self.geometry.xy

    @property
    def latlon(self) -> (np.ndarray, np.ndarray):
        """
        Tuple containing two dimensional array of latitudes and two dimensional array of longitudes.
        """
        return self.geometry.latlon

    @property
    def lat(self) -> np.ndarray:
        """
        Two dimensional array of latitudes.
        """
        return self.geometry.lat

    @property
    def lon(self) -> np.ndarray:
        """
        Two dimensional array of longitudes.
        """
        return self.geometry.lon

    @property
    def x(self) -> np.ndarray:
        """
        Two dimensional array of x coordinates.
        """
        return self.geometry.x

    @property
    def y(self) -> np.ndarray:
        """
        Two dimensional array of y coordinates.
        """
        return self.geometry.y

    @property
    def range(self) -> (float, float):
        """
        Minimum and maximum value of the data in a tuple.
        """
        return (np.nanmin(self.array), np.nanmax(self.array))

    @property
    def title(self) -> str:
        """
        Title of the data as a string or None if title not specified. May be constructed from various metadata.
        """
        if 'title' in self.metadata:
            return self.metadata['title']
        elif 'long_name' in self.metadata:
            title = self.metadata['long_name']

            if 'units' in self.metadata:
                title += f" ({self.metadata['units']})"

            return title
        elif 'filename' in self._source_metadata:
            return self._source_metadata['filename']
        else:
            return None

    @property
    def name(self) -> str:
        return self.title

    @property
    def units(self) -> str:
        """
        Units of the data as a string or None if units not specified.
        """
        if 'units' in self.metadata:
            return self.metadata['units']
        else:
            return None

    @property
    def cell_size(self) -> float:
        return self.geometry.cell_size

    @property
    def cell_height(self) -> float:
        return self.geometry.cell_height

    @property
    def cell_width(self) -> float:
        return self.geometry.cell_width

    @property
    def ymin(self) -> float:
        return self.geometry.ymin

    @property
    def xmin(self) -> float:
        return self.geometry.xmin

    @property
    def ymax(self) -> float:
        return self.geometry.ymax

    @property
    def xmax(self) -> float:
        return self.geometry.xmax

    @property
    def x_origin(self) -> float:
        return self.geometry.x_origin

    @property
    def y_origin(self) -> float:
        return self.geometry.y_origin

    @property
    def origin(self) -> float:
        return self.geometry.origin

    @property
    def width(self) -> float:
        return self.geometry.width

    @property
    def height(self) -> float:
        return self.geometry.height

    @property
    def is_gridded(self) -> bool:
        return isinstance(self.geometry, RasterGrid)

    # @profile
    def resample(
            self,
            target_geometry: RasterGeometry,
            nodata: Any = None,
            search_radius_meters: float = None,
            kd_tree: KDTree = None,
            **kwargs) -> Raster:
        """
        This function resamples data from one coordinate field to another by nearest neighbor.
        Either coordinate field may or may not represent gridded data.
        This function should only be used at commensurate scales.
        For disparate scales, use swath_to_swath.
        """
        if nodata is None:
            nodata = self.nodata

        if nodata is np.nan and "int" in str(self.dtype):
            raise ValueError("cannot use NaN as nodata value for integer layer")

        if kd_tree is None:
            kd_tree = KDTree(
                source_geometry=self.geometry,
                target_geometry=target_geometry,
                radius_of_influence=search_radius_meters,
                **kwargs
            )

        output_raster = kd_tree.resample(
            source=self.array,
            fill_value=nodata,
            **kwargs
        )

        return output_raster

    def grid_raster(
            self,
            geometry: RasterGeometry = None,
            crs: Union[CRS, str] = None,
            target_cell_size: float = None,
            kd_tree: KDTree = None,
            **kwargs) -> Raster:
        if isinstance(self.geometry, RasterGrid) and geometry is None and crs is None:
            return self

        if geometry is None:
            geometry = self.geometry.grid_to_crs(
                target_crs=crs,
                target_cell_size=target_cell_size
            )

        image = self.resample(
            target_geometry=geometry,
            kd_tree=kd_tree,
            **kwargs
        )

        return image

    grid = property(grid_raster)

    def resize(self, shape: (int, int), resampling: str = None):
        return self.to_geometry(self.geometry.resize(shape), resampling=resampling)

    def rescale(self, target_cell_size: float, method: str = 'linear', order: int = None):
        if order is None:
            if method not in SKIMAGE_RESAMPLING_METHODS:
                raise ValueError(f"resampling method not recognized: {method}")

            order = SKIMAGE_RESAMPLING_METHODS[method]

        geometry = self.geometry.reproject(self.crs, target_cell_size)
        data = skimage.transform.resize(
            self.array,
            (self.rows, self.cols),
            order=order,
            preserve_range=True
        )
        raster = self.contain(array=data, geometry=geometry)

        return raster

    @property
    def boundary(self) -> Polygon:
        return self.geometry.boundary

    @property
    def bbox(self) -> BBox:
        return self.geometry.bbox

    @property
    def geolocation(self) -> Raster:
        return self.contain(geometry=self.geometry.geolocation)

    # @profile
    def to_grid(
            self,
            grid: RasterGrid,
            search_radius_meters = None,
            resampling: str = None,
            kd_tree: KDTree = None,
            nodata: Any = None,
            **kwargs) -> Raster:
        if not isinstance(grid, RasterGrid):
            raise TypeError(f"target geometry must be a RasterGrid object, not {type(grid)}")

        if nodata is None:
            nodata = self.nodata

        if nodata is np.nan and "int" in str(self.dtype):
            raise ValueError("cannot use NaN as nodata value for integer layer")

        if resampling is None:
            resampling = "nearest"

        if isinstance(resampling, str) and resampling in RASTERIO_RESAMPLING_METHODS:
            resampling = RASTERIO_RESAMPLING_METHODS[resampling]

        if isinstance(self.geometry, RasterGeolocation):
            if resampling == "nearest":
                return self.resample(
                    target_geometry=grid,
                    search_radius_meters=search_radius_meters,
                    kd_tree=kd_tree
                )
            else:
                return self.resample(target_geometry=self.geometry.grid, search_radius_meters=search_radius_meters, nodata=nodata).to_geometry(grid, resampling=resampling, search_radius_meters=search_radius_meters, nodata=nodata)


        # create source array
        source = np.array(self.array)

        # define affine transforms
        src_transform = self.geometry.affine
        dst_transform = grid.affine

        # define coordinate reference systems
        src_crs = CRS(self.crs)
        dst_crs = CRS(grid.crs)

        destination_dtype = self.dtype

        if nodata is None:
            # define nodata
            if self.dtype in (np.float32, np.float64):
                src_nodata = np.nan
                dst_nodata = np.nan
            elif str(self.dtype) == "bool":
                source = source.astype(np.uint16)
                destination_dtype = np.uint16
                src_nodata = np.uint16(self.nodata)
                dst_nodata = src_nodata
            else:
                src_nodata = self.nodata
                dst_nodata = self.nodata
        else:
            src_nodata = nodata
            dst_nodata = nodata

        # create destination array
        destination = np.empty((grid.rows, grid.cols), destination_dtype)

        if str(self.dtype) == "bool":
            source = source.astype(np.uint16)

        # resample to destination array
        with rasterio.Env():
            try:
                reproject(
                    source,
                    destination,
                    src_transform=src_transform,
                    src_crs=src_crs,
                    src_nodata=src_nodata,
                    dst_transform=dst_transform,
                    dst_crs=dst_crs,
                    dst_nodata=dst_nodata,
                    resampling=resampling,
                    **kwargs
                )
            except Exception as e:
                self.logger.exception(e)
                raise ValueError(
                    f"unable to project source type {source.dtype} nodata {src_nodata} to type {destination.dtype} nodata {dst_nodata}")

        if self.dtype != destination.dtype:
            destination = destination.astype(self.dtype)

        # encapsulate destination data to raster
        raster = self.contain(destination, geometry=grid)

        return raster

    def to_geolocation(
            self,
            geolocation: RasterGeolocation,
            kd_tree: KDTree = None,
            **kwargs) -> Raster:
        return self.resample(
            target_geometry=geolocation,
            kd_tree=kd_tree,
            **kwargs
        )

    def to_geometry(
            self,
            target_geometry: RasterGeometry,
            resampling: str = None,
            search_radius_meters: float = None,
            kd_tree: KDTree = None,
            nodata: Any = None,
            **kwargs) -> Raster:
        if nodata is None:
            nodata = self.nodata

        if nodata is np.nan and "int" in str(self.dtype):
            raise ValueError("cannot use NaN as nodata value for integer layer")

        if self.geometry == target_geometry:
            return self

        if isinstance(target_geometry, RasterGrid):
            return self.to_grid(
                target_geometry,
                search_radius_meters=search_radius_meters,
                resampling=resampling,
                kd_tree=kd_tree,
                nodata=nodata,
                **kwargs
            )
        elif isinstance(target_geometry, RasterGeolocation):
            return self.to_geolocation(
                target_geometry,
                search_radius_meters=search_radius_meters,
                kd_tree=kd_tree,
                **kwargs
            )
        else:
            raise ValueError(f"unsupported target geometry type: {type(target_geometry)}")

    @property
    def count(self) -> int:
        # single-band raster
        return 1

    @property
    def pixel_centroids(self) -> gpd.GeoDataFrame:
        return gpd.GeoDataFrame({"value": self.array.flatten()}, geometry=list(self.geometry.pixel_centroids))

    @property
    def pixel_outlines(self) -> gpd.GeoDataFrame:
        return gpd.GeoDataFrame({"value": self.array.flatten()}, geometry=list(self.geometry.pixel_outlines))

    def IDW(self, geometry: VectorGeometry, power: float = 2):
        if isinstance(geometry, shapely.geometry.Point):
            geometry = wrap_geometry(geometry)
            pixel_centroids = self.geometry.pixel_centroids
            distances = geometry.distances(pixel_centroids)
            value = self.array.flatten()
            distance = np.array(distances["distance"])
            weight = 1 / distance ** power
            weighted = value * weight
            result = np.nansum(weighted) / np.nansum(weight)

            if isinstance(geometry, SingleVectorGeometry):
                return result
            else:
                return gpd.GeoDataFrame({"value": [result]}, geometry=[geometry])
        else:
            raise ValueError(f"unsupported target geometry: {geometry}")

    def generate_profile(
            self,
            driver: str = None,
            dtype: str = None,
            nodata: Any = None,
            count: int = None,
            compress: str = DEFAULT_GEOTIFF_COMPRESSION,
            use_compression: bool = True,
            **kwargs) -> dict:
        if driver is None:
            driver = "GTiff"

        if dtype is None:
            if str(self.dtype) == "float64":
                dtype = np.float32
            elif str(self.dtype) == "int64":
                dtype = np.int32
            elif str(self.dtype) == "bool":
                dtype = np.uint16
            else:
                dtype = self.dtype

        if nodata is None:
            nodata = self.nodata

            try:
                if dtype != np.float32 and nodata is np.nan:
                    nodata = None
            except:
                nodata = None

        # using proj4 as a universal CRS encoding is becoming deprecated
        CRS = self.geometry.proj4

        width = self.cols
        height = self.rows
        transform = self.geometry.affine

        if count is None:
            count = self.count

        profile = {
            "count": count,  # singe-band raster
            "width": width,
            "height": height,
            "nodata": nodata,
            "dtype": dtype,
            "crs": CRS,
            "transform": transform,
            "driver": driver
        }

        profile.update(kwargs)

        for key in list(profile.keys()):
            if profile[key] is None:
                del (profile[key])

        if use_compression and compress is not None:
            profile["compress"] = compress

        return profile

    rasterio_profile = property(generate_profile)

    def to_file(
            self,
            filename: str,
            driver: str = None,
            compress: str = None,
            use_compression: bool = True,
            overwrite: bool = True,
            nodata: Any = None,
            **kwargs):
        if not isinstance(filename, str):
            raise ValueError("invalid filename")

        filename = abspath(expanduser(filename))

        if driver is None:
            driver = GEOTIFF_DRIVER

        if compress is None:
            compress = self.DEFAULT_GEOTIFF_COMPRESSION

        profile = self.generate_profile(
            driver=driver,
            compress=compress,
            use_compression=use_compression,
            nodata=nodata,
            **kwargs
        )

        filename = expanduser(filename)
        filename = abspath(filename)
        self.metadata["filename"] = filename
        dtype = profile["dtype"]
        directory = dirname(filename)
        output_array = self.array.astype(dtype)

        if not exists(directory) and not directory == '':
            makedirs(directory, exist_ok=True)

        if exists(filename) and not overwrite:
            raise IOError(f"output file already exists: {filename}")

        with rasterio.open(filename, "w", **profile) as file:
            file.write(output_array, 1)

    def to_geotiff(
            self,
            filename: str,
            compression: str = None,
            preview_quality: int = 20,
            cmap: Union[Colormap, str] = DEFAULT_CMAP,
            use_compression: bool = True,
            include_preview: bool = True,
            overwrite: bool = True,
            **kwargs):
        self.to_file(
            filename=filename,
            driver=GEOTIFF_DRIVER,
            compress=compression,
            use_compression=use_compression,
            **kwargs
        )

        if include_preview:
            self.to_geojpeg(
                filename=f"{splitext(filename)[0]}.jpeg",
                cmap=cmap,
                quality=preview_quality,
                overwrite=overwrite
            )

    def to_geopackage(
            self,
            filename: str,
            compression: str = None,
            preview_quality: int = 20,
            cmap: Union[Colormap, str] = DEFAULT_CMAP,
            use_compression: bool = True,
            include_preview: bool = True,
            overwrite: bool = True,
            **kwargs):
        self.to_file(
            filename=filename,
            driver=GEOPACKAGE_DRIVER,
            compress=compression,
            use_compression=use_compression,
            **kwargs
        )

        if include_preview:
            self.to_geojpeg(
                filename=f"{splitext(filename)[0]}.jpeg",
                cmap=cmap,
                quality=preview_quality,
                overwrite=overwrite
                )

    def to_COG(
            self,
            filename: str,
            compression: str = "deflate",
            preview_quality: int = 20,
            cmap: Union[Colormap, str] = DEFAULT_CMAP,
            include_preview: bool = True,
            overwrite: bool = True,
            remove_XML: bool = True,
            **kwargs):
        filename = abspath(expanduser(filename))
        temporary_filename = filename.replace(".tif", ".temp.tif")

        if exists(temporary_filename):
            os.remove(temporary_filename)

        # print(f"writing temporary GeoTIFF: {temporary_filename}")

        self.to_geotiff(
            filename=temporary_filename,
            include_preview=False,
            overwrite=True
        )

        if not exists(temporary_filename):
            raise IOError(f"unable to create temporary GeoTIFF: {temporary_filename}")

        # print(f"temporary file exists: {exists(temporary_filename)}")

        command = f'gdal_translate "{temporary_filename}" "{filename}" -co TILED=YES -co COPY_SRC_OVERVIEWS=YES -co COMPRESS={compression.upper()}'
        # print(command)
        os.system(command)

        # print(f"final file exists: {exists(filename)}")

        os.remove(temporary_filename)

        XML_filename = f"{filename}.aux.xml"

        if remove_XML and exists(XML_filename):
            os.remove(XML_filename)

        if include_preview:
            self.to_geojpeg(
                filename=f"{splitext(filename)[0]}.jpeg",
                cmap=cmap,
                quality=preview_quality,
                overwrite=overwrite
            )

    def to_geojpeg(
            self,
            filename: str,
            cmap: Union[Colormap, str] = None,
            quality: int = 75,
            overwrite: bool = False,
            **kwargs):
        if not isinstance(filename, str):
            raise ValueError("invalid filename")

        filename = abspath(expanduser(filename))

        if exists(filename) and not overwrite:
            # self.logger.info(f"GeoJPEG file already exists: {filename}")
            return

        rendered_image = self.to_pillow(cmap=cmap)
        rendered_array = np.array(rendered_image)
        reshaped_array = np.moveaxis(rendered_array, -1, 0)

        profile = self.generate_profile(
            quality=quality,
            compress=None,
            driver=GEOJPEG_DRIVER,
            dtype="uint8",
            count=3,
            **kwargs
        )

        makedirs(dirname(abspath(filename)), exist_ok=True)

        with rasterio.Env(CPL_LOG_ERRORS="OFF"):
            with rasterio.open(filename, "w", **profile) as file:
                file.write(reshaped_array)

        if not exists(filename):
            raise IOError(f"unable to create GeoJPEG file: {filename}")

    def to_geopng(
            self,
            filename: str,
            cmap: Union[Colormap, str] = None,
            quality: int = 75,
            overwrite: bool = False,
            **kwargs):
        if not isinstance(filename, str):
            raise ValueError("invalid filename")

        filename = abspath(expanduser(filename))

        if exists(filename) and not overwrite:
            # self.logger.info(f"GeoJPEG file already exists: {filename}")
            return

        rendered_image = self.to_pillow(cmap=cmap)
        rendered_array = np.array(rendered_image)
        reshaped_array = np.moveaxis(rendered_array, -1, 0)

        profile = self.generate_profile(
            quality=quality,
            compress=None,
            driver=GEOPNG_DRIVER,
            dtype="uint8",
            count=3,
            **kwargs
        )

        makedirs(dirname(abspath(filename)), exist_ok=True)

        with rasterio.Env(CPL_LOG_ERRORS="OFF"):
            with rasterio.open(filename, "w", **profile) as file:
                file.write(reshaped_array)

        if not exists(filename):
            raise IOError(f"unable to create GeoPNG file: {filename}")

    @property
    def is_float(self):
        return str(self.dtype).startswith("f")

    @property
    def empty(self):
        if self.is_float:
            return np.all(np.isnan(self.array))
        else:
            return np.all(self.array == self.nodata)

    def reproject(
            self,
            crs: Union[CRS, str] = WGS84,
            target_cell_size: float = None,
            method: str = "nearest",
            kd_tree: KDTree = None):
        if method not in RASTERIO_RESAMPLING_METHODS:
            raise ValueError(f"resampling method is not supported: {method}")

        # warp target georeference
        destination_geometry = self.geometry.reproject(
            crs=crs,
            cell_size=target_cell_size
        )

        # select rasterio resampling method
        resampling = RASTERIO_RESAMPLING_METHODS[method]

        if self.is_gridded:
            raster = self.to_grid(
                grid=destination_geometry,
                resampling=resampling,
                kd_tree=kd_tree
            )
        else:
            raster = self.resample(
                target_geometry=destination_geometry,
                kd_tree=kd_tree
            )

        return raster

    def UTM(self, target_cell_size: float, kd_tree: KDTree = None) -> Raster:
        return self.reproject(
            crs=self.geometry.local_UTM_proj4,
            target_cell_size=target_cell_size,
            kd_tree=kd_tree
        )

    def mask(self, mask: Raster or np.ndarray) -> Raster:
        return where(mask, self, np.nan)

    def fill(self, other: Raster or np.ndarray) -> Raster:
        if self.shape != other.shape:
            raise ValueError(f"raster with shape {self.shape} cannot be filled with raster of shape {other.shape}")

        return where(np.isnan(self), other, self)

    def imshow(
            self,
            title: str = None,
            style: str = None,
            cmap: str or Colormap = None,
            figsize: (float, float) = DEFAULT_FIGSIZE,
            facecolor: str = None,
            vmin: float = None,
            vmax: float = None,
            fig=None,
            ax=None,
            backend: str = "Agg",
            hide_ticks: bool = False,
            render: bool = True,
            diverging: bool = False,
            **kwargs) -> Union[Figure, Image]:
        prior_backend = plt.get_backend()
        plt.switch_backend(backend)

        plt.close()

        if style is None:
            style = DEFAULT_MATPLOTLIB_STYLE

        if facecolor is None:
            if "dark" in style:
                facecolor = "black"
            else:
                facecolor = "white"
        
        if cmap is None:
            cmap = self.cmap

        with plt.style.context(style):
            if fig is None or ax is None:
                fig, ax = plt.subplots(nrows=1, ncols=1, facecolor=facecolor, figsize=figsize)

            if title is None:
                title = self.title

            if title is not None:
                ax.set_title(title)

            data = self.array

            tick_labels = None

            if str(self.array.dtype) == "bool":
                data = self.array.astype(np.uint8)
                boundaries = [0, 1]
                ticks = [0, 1]
                tick_labels = ["False", "True"]
                vmin = 0
                vmax = 1

                if cmap is None:
                    cmap = colors.ListedColormap(["black", "white"])
            elif np.issubdtype(self.array.dtype, np.integer) and np.all(np.unique(data) == (0, 1)):
                boundaries = [0, 1]
                ticks = [0, 1]
                vmin = 0
                vmax = 1

                if cmap is None:
                    cmap = colors.ListedColormap(["black", "white"])
            elif len(np.unique(data)) < 10:
                vmin = None
                vmax = None
                boundaries = None
                ticks = None
            else:
                if vmin is None and vmax is None:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        minimum = np.nanmin(data)
                        maximum = np.nanmax(data)
                        mean = np.nanmean(data)
                        sd = np.nanstd(data)

                    vmin = max(mean - 2 * sd, minimum)
                    vmax = min(mean + 2 * sd, maximum)

                    if diverging:
                        vradius = max(abs(vmin), abs(vmax))
                        vmin = -vradius
                        vmax = vradius

                boundaries = None
                ticks = None

            if cmap is None:
                if self.cmap is None:
                    cmap = "jet"
                else:
                    cmap = self.cmap

            im = ax.imshow(
                data,
                extent=self.geometry._matplotlib_extent,
                cmap=cmap,
                vmin=vmin,
                vmax=vmax
            )

            if self.is_geographic:
                plt.xlabel('Longitude')
                plt.ylabel('Latitude')

                units = u'\N{DEGREE SIGN}'
            else:
                plt.xlabel('X Coordinate')
                plt.ylabel('Y Coordinate')

                if "units=m" in self.proj4:
                    units = 'm'
                else:
                    units = ''

            if "units=m" in self.proj4:
                def format_tick_meters(tick_value, position):
                    if abs(tick_value) > 1000:
                        tick_value /= 1000
                        units = "km"
                    else:
                        units = "m"

                    tick_string = f"{tick_value:0.2f}"

                    if tick_string.endswith(".00"):
                        tick_string = tick_string[:-3]

                    return f"{tick_string} {units}"

                tick_formatter = FuncFormatter(format_tick_meters)
            else:
                def format_tick(tick_value, position):
                    tick_string = f"{tick_value:0.2f}"

                    if tick_string.endswith(".00"):
                        tick_string = tick_string[:-3]

                    return f"{tick_string} {units}"

                tick_formatter = FuncFormatter(format_tick)

            ax.get_xaxis().set_major_formatter(tick_formatter)
            ax.get_yaxis().set_major_formatter(tick_formatter)
            plt.xticks(rotation=-90)

            divider = make_axes_locatable(ax)
            cax = divider.append_axes("right", size="5%", pad=0.05)
            cbar = fig.colorbar(im, cax=cax, boundaries=boundaries, ticks=ticks)

            if tick_labels is not None:
                cbar.ax.set_yticklabels(tick_labels)
                cbar.ax.tick_params(labelsize=14)

            if hide_ticks:
                ax.xaxis.set_visible(False)
                ax.yaxis.set_visible(False)

            fig.tight_layout()

        plt.switch_backend(prior_backend)

        if render:
            output = self.image(fig=fig, **kwargs)
        else:
            output = fig

        return output

    def render(
            self,
            fig=None,
            format: str = "png",
            transparent: bool = False,
            style: str = DEFAULT_MATPLOTLIB_STYLE,
            dpi: int = DEFAULT_DPI,
            **kwargs) -> bytes:
        if fig is None:
            fig = self.imshow(style=style, render=False, **kwargs)

        with plt.style.context(style):
            buffer = io.BytesIO()
            fig.savefig(buffer, format=format, transparent=transparent, dpi=dpi)
            plt.close(fig)

        buffer.seek(0)

        return buffer

    def image(
            self,
            fig=None,
            format: str = "png",
            transparent: bool = False,
            style: str = DEFAULT_MATPLOTLIB_STYLE,
            dpi: int = DEFAULT_DPI,
            **kwargs) -> Image:
        buffer = self.render(fig=fig, format=format, transparent=transparent, style=style, dpi=dpi, **kwargs)
        image = PIL.Image.open(buffer)

        return image

    def _repr_png_(self) -> bytes:
        return self.render(format='png').getvalue()

    def __str__(self):
        return self.array.__str__()

    @property
    def minmaxstretch(self) -> Raster:
        if np.all(np.isnan(self.array)):
            return self

        transform = MinMaxInterval()
        stretch = transform(self.array)

        return self.contain(stretch)

    def generate_percentilecut(self, lower_percentile=2, upper_percentile=98) -> Raster:
        if np.all(np.isnan(self.array)):
            return self

        transform = AsymmetricPercentileInterval(lower_percentile, upper_percentile)
        stretch = transform(self.array)

        return self.contain(stretch)

    percentilecut = property(generate_percentilecut)

    def to_pillow(
            self,
            cmap: Union[Colormap, str] = None,
            mode: str = "RGB") -> PIL.Image.Image:
        DEFAULT_CONTINUOUS_CMAP = plt.get_cmap("jet")
        DEFAULT_BINARY_CMAP = colors.ListedColormap(["black", "white"])

        if cmap is None:
            cmap = self.cmap
        
        if str(self.array.dtype) == "bool":
            # data = self.array.astype(np.uint8)
            vmin = 0
            vmax = 1

            if cmap is None:
                cmap = colors.ListedColormap(["black", "white"])

        elif np.issubdtype(self.array.dtype, np.integer) and np.all(tuple(np.unique(self.array)) == (0, 1)):
            # data = self.array.astype(np.uint8)
            vmin = 0
            vmax = 1

            if cmap is None:
                cmap = colors.ListedColormap(["black", "white"])
        elif len(np.unique(self.array)) < 10:
            vmin = None
            vmax = None
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                minimum = np.nanmin(self.array)
                maximum = np.nanmax(self.array)
                mean = np.nanmean(self.array)
                sd = np.nanstd(self.array)

            vmin = max(mean - 2 * sd, minimum)
            vmax = min(mean + 2 * sd, maximum)

        if cmap is None:
            if self.cmap is None:
                cmap = "jet"
            else:
                cmap = self.cmap

        if isinstance(cmap, str):
            cmap = plt.get_cmap(cmap)

        if len(np.unique(self.array)) == 1:
            image_array_norm = np.full(self.shape, 0)
        elif vmin is None and vmax is None:
            image_array_norm = cmap(np.array(self.minmaxstretch))
        else:
            image_array_norm = cmap(np.array(self.clip(vmin, vmax).minmaxstretch))

        image_array_int = np.uint8(image_array_norm * 255)
        pillow_image = PIL.Image.fromarray(image_array_int)

        if mode is not None:
            pillow_image = pillow_image.convert(mode)

        return pillow_image

    pillow = property(to_pillow)


class MultiRaster(Raster):
    def __init__(
            self,
            array: np.ndarray or Raster,
            geometry: RasterGeometry,
            nodata=None,
            cmap=None,
            **kwargs):
        ALLOWED_ARRAY_TYPES = (
            np.ndarray,
            h5py.Dataset
        )

        if isinstance(array, Raster):
            array = array.array

        if not isinstance(array, ALLOWED_ARRAY_TYPES):
            raise TypeError('data is not a valid numpy.ndarray')

        ndim = len(array.shape)

        if ndim == 2:
            rows, cols = array.shape
            array = np.reshape(array, (1, rows, cols))
        elif ndim != 3:
            raise ValueError('data is not a three-dimensional array')

        dtype = array.dtype

        if dtype in (np.float32, np.float64):
            array = np.where(array == nodata, np.nan, array)

        self._array = array

        if nodata is None:
            if dtype in (np.float32, np.float64):
                nodata = np.nan

        self._nodata = nodata
        self._metadata = {}

        for key, value in kwargs.items():
            self._metadata[key] = value

        if isinstance(geometry, RasterGeometry):
            self._geometry = geometry
        else:
            raise ValueError(f"geometry is not a valid RasterGeometry object: {type(geometry)}")

        self.cmap = cmap
        self._source_metadata = {}

    @classmethod
    def stack(cls, rasters: List[Raster], *args, **kwargs) -> MultiRaster:
        geometry = rasters[0].geometry
        stack = np.stack(rasters)
        image = MultiRaster(stack, *args, geometry=geometry, **kwargs)

        return image

    def band(self, band: int) -> Raster:
        image = Raster.contain(self, self.array[band, ...])
        return image

    def imshow(
            self,
            title: str = None,
            style: str = None,
            cmap: str or Colormap = None,
            figsize: (float, float) = DEFAULT_FIGSIZE,
            facecolor: str = None,
            vmin: float = None,
            vmax: float = None,
            fig=None,
            ax=None,
            backend: str = "Agg",
            hide_ticks: bool = False,
            render: bool = True,
            diverging: bool = False,
            **kwargs) -> Union[Figure, Image]:
        if self.count == 1:
            return self.band(0).imshow(
                title=title,
                style=style,
                cmap=cmap,
                figsize=figsize,
                facecolor=facecolor,
                vmin=vmin,
                vmax=vmax,
                fig=fig,
                ax=ax,
                hide_ticks=hide_ticks
            )

        plt.close()

        if style is None:
            style = DEFAULT_MATPLOTLIB_STYLE

        if facecolor is None:
            if "dark" in style:
                facecolor = "black"
            else:
                facecolor = "white"

        with plt.style.context(style):
            if fig is None or ax is None:
                fig, ax = plt.subplots(nrows=1, ncols=1, facecolor=facecolor, figsize=figsize)

            if title is None:
                title = self.title

            if title is not None:
                ax.set_title(title)

            data = self.array

            tick_labels = None

            red = self.band(0).percentilecut
            green = self.band(1).percentilecut
            blue = self.band(2).percentilecut

            array = np.dstack([red, green, blue])

            im = ax.imshow(
                array,
                extent=self.geometry._matplotlib_extent,
                cmap=cmap,
                vmin=vmin,
                vmax=vmax
            )

            if self.is_geographic:
                plt.xlabel('Longitude')
                plt.ylabel('Latitude')

                units = u'\N{DEGREE SIGN}'
            else:
                plt.xlabel('X Coordinate')
                plt.ylabel('Y Coordinate')

                if "units=m" in self.proj4:
                    units = 'm'
                else:
                    units = ''

            if "units=m" in self.proj4:
                def format_tick_meters(tick_value, position):
                    if abs(tick_value) > 1000:
                        tick_value /= 1000
                        units = "km"
                    else:
                        units = "m"

                    tick_string = f"{tick_value:0.2f}"

                    if tick_string.endswith(".00"):
                        tick_string = tick_string[:-3]

                    return f"{tick_string} {units}"

                tick_formatter = FuncFormatter(format_tick_meters)
            else:
                def format_tick(tick_value, position):
                    tick_string = f"{tick_value:0.2f}"

                    if tick_string.endswith(".00"):
                        tick_string = tick_string[:-3]

                    return f"{tick_string} {units}"

                tick_formatter = FuncFormatter(format_tick)

            ax.get_xaxis().set_major_formatter(tick_formatter)
            ax.get_yaxis().set_major_formatter(tick_formatter)
            plt.xticks(rotation='-90')

            if hide_ticks:
                ax.xaxis.set_visible(False)
                ax.yaxis.set_visible(False)

            plt.tight_layout()

            if render:
                output = self.image(fig=fig, **kwargs)
            else:
                output = fig

            return output

    def to_pillow(
            self,
            cmap: Union[Colormap, str] = None,
            mode: str = "RGB") -> PIL.Image.Image:
        if self.count == 1:
            return self.band(0).to_pillow(cmap=cmap, mode=mode)

        red = self.band(0).percentilecut
        green = self.band(1).percentilecut
        blue = self.band(2).percentilecut

        pillow_image = PIL.Image.fromarray(np.uint8(np.stack([red, green, blue], axis=2) * 255))

        if mode is not None:
            pillow_image = pillow_image.convert(mode)

        return pillow_image

    @property
    def shape(self) -> (int, int, int):
        """
        Tuple of dimension sizes.
        """
        return self.array.shape

    @property
    def count(self) -> int:
        return self.shape[0]

    @property
    def rows(self) -> int:
        """
        Count of rows.
        """
        return self.shape[1]

    @property
    def cols(self) -> int:
        """
        Count of columns.
        """
        return self.shape[2]

    def generate_percentilecut(self, lower_percentile=2, upper_percentile=98) -> Raster:
        return MultiRaster.stack([
            self.band(band).generate_percentilecut(lower_percentile=lower_percentile, upper_percentile=upper_percentile)
            for band
            in range(self.count)
        ])

    def resize(self, shape: (int, int), resampling: str = None):
        return MultiRaster.stack([
            self.band(band).resize(shape=shape, resampling=resampling)
            for band
            in range(self.count)
        ])


def where(condition, x, y):
    if isinstance(condition, Raster):
        geometry = condition.geometry
    elif isinstance(x, Raster):
        geometry = x.geometry
    elif isinstance(y, Raster):
        geometry = y.geometry
    else:
        geometry = None

    cmap = None

    if hasattr(x, "cmap") and getattr(x, "cmap") is not None:
        cmap = x.cmap

    if cmap is None and hasattr(y, "cmap") and getattr(y, "cmap") is not None:
        cmap = y.cmap

    metadata = {}

    if hasattr(x, "metadata") and len(getattr(x, "metadata")) > 0:
        for key, value in x.metadata.items():
            if key not in metadata:
                metadata[key] = value

    if hasattr(y, "metadata") and len(getattr(y, "metadata")) > 0:
        for key, value in y.metadata.items():
            if key not in metadata:
                metadata[key] = value

    nodata = None

    if hasattr(x, "nodata") and getattr(x, "nodata") is not None:
        nodata = x.nodata

    if nodata is None and hasattr(y, "nodata") and getattr(y, "nodata") is not None:
        nodata = y.nodata

    result = np.where(condition, x, y)

    if geometry is None:
        return result
    else:
        return Raster(result, geometry=geometry, cmap=cmap, metadata=metadata, nodata=nodata)

def clip(a: Raster or np.ndarray, a_min, a_max, out=None, **kwargs) -> Raster or np.ndarray:
    if a_min is None and a_max is None:
        return a

    # result = np.clip(a=a, a_min=a_min, a_max=a_max, out=out, **kwargs)
    result = a

    if a_min is not None:
        result = np.where(result < a_min, a_min, result)
    if a_max is not None:
        result = np.where(result > a_max, a_max, result)

    if isinstance(a, Raster):
        result = a.contain(result)
        
    return result

def mosaic(images: Iterator[Union[Raster, str]], geometry: RasterGeometry) -> Raster:
    mosaic = Raster(np.full(geometry.shape, np.nan), geometry=geometry)
    dtype = None
    nodata = None
    metadata = None

    for image in images:
        if isinstance(image, str):
            image = Raster.open(image)

        dtype = image.dtype
        nodata = image.nodata
        metadata = image.metadata
        mosaic = raster.where(np.isnan(mosaic), image.to_geometry(geometry), mosaic)

    mosaic = mosaic.astype(dtype)
    mosaic = Raster(mosaic, geometry=geometry, nodata=nodata, metadata=metadata)

    return mosaic
