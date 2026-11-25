from pathlib import Path

from shapely.geometry import box

from water_rights_visualizer import landsat_pass_layers
from water_rights_visualizer.landsat_pass_count import get_landsat_month_stats
from water_rights_visualizer.landsat_pass_layers import (
    landsat_pass_layer_s3_key,
    resolve_default_landsat_pass_s3,
    resolve_landsat_pass_layer,
)

ROI = box(-106.5, 34.0, -106.0, 34.5)


def test_s3_key_matches_uploaded_cog_name():
    assert (
        landsat_pass_layer_s3_key("landsat_pass_layers", "010014", 2024, 1)
        == "landsat_pass_layers/LANDSAT_PASS_010014_20240101_20240131.tif"
    )


def _reset_s3_client_cache():
    landsat_pass_layers._default_s3_client = None
    landsat_pass_layers._default_s3_client_key = None
    landsat_pass_layers._logged_missing_s3_bucket = False


def test_resolve_s3_uses_env_bucket_and_region(monkeypatch):
    captured = {}

    class FakeSession:
        def __init__(self, profile_name=None):
            captured["profile"] = profile_name

        def client(self, service, region_name=None):
            captured["service"] = service
            captured["region"] = region_name
            return {"service": service, "region": region_name}

    monkeypatch.setattr(landsat_pass_layers, "load_dotenv", lambda *args, **kwargs: False)
    monkeypatch.setattr(landsat_pass_layers.boto3, "Session", FakeSession)
    monkeypatch.setenv("S3_INPUT_BUCKET", "from-env")
    monkeypatch.setenv("S3_REGION", "us-west-2")
    monkeypatch.setenv("AWS_PROFILE", "from-profile")
    _reset_s3_client_cache()

    bucket, prefix, client = resolve_default_landsat_pass_s3()

    assert bucket == "from-env"
    assert prefix == "landsat_pass_layers"
    assert client == {"service": "s3", "region": "us-west-2"}
    assert captured["profile"] == "from-profile"


def test_resolve_s3_skips_when_bucket_is_unset(monkeypatch):
    monkeypatch.setattr(landsat_pass_layers, "load_dotenv", lambda *args, **kwargs: False)
    for name in ("S3_INPUT_BUCKET", "S3_REGION", "AWS_REGION", "AWS_DEFAULT_REGION"):
        monkeypatch.delenv(name, raising=False)
    _reset_s3_client_cache()

    assert resolve_default_landsat_pass_s3() is None


def test_resolve_downloads_from_configured_bucket(tmp_path):
    calls = {}

    class FakeS3:
        def download_file(self, bucket, key, filename):
            calls["bucket"] = bucket
            calls["key"] = key
            Path(filename).write_bytes(b"cached-cog")

    path = resolve_landsat_pass_layer(
        "010014",
        2024,
        1,
        str(tmp_path),
        s3_bucket="ose-dev-inputs",
        s3_key_prefix="landsat_pass_layers",
        s3_client=FakeS3(),
    )

    assert path is not None
    assert Path(path).read_bytes() == b"cached-cog"
    assert calls == {
        "bucket": "ose-dev-inputs",
        "key": "landsat_pass_layers/LANDSAT_PASS_010014_20240101_20240131.tif",
    }


def _patch_layer_lookup(monkeypatch, aggregate_result, client):
    def fake_defaults():
        return "ose-dev-inputs", "landsat_pass_layers", client

    def fake_aggregate(
        roi,
        month,
        year,
        cache_directory,
        tiles_geojson=None,
        s3_bucket=None,
        s3_key_prefix="",
        s3_client=None,
    ):
        fake_aggregate.captured = {
            "bucket": s3_bucket,
            "prefix": s3_key_prefix,
            "client": s3_client,
        }
        return aggregate_result

    def fail_live(*args, **kwargs):
        raise AssertionError("Planetary Computer should not be queried")

    monkeypatch.setattr(
        "water_rights_visualizer.landsat_pass_count.resolve_default_landsat_pass_s3",
        fake_defaults,
    )
    monkeypatch.setattr(
        "water_rights_visualizer.landsat_pass_count.aggregate_landsat_pass_stats_from_layers",
        fake_aggregate,
    )
    monkeypatch.setattr(
        "water_rights_visualizer.landsat_pass_count._fetch_monthly_cloud_coverage_from_planetary_computer",
        fail_live,
    )
    return fake_aggregate


def test_month_stats_reads_s3_cache_without_planetary_computer(monkeypatch):
    sentinel_client = object()
    aggregate = _patch_layer_lookup(
        monkeypatch,
        {
            "year": 2024,
            "month": 1,
            "mean_cloud_coverage": 10.0,
            "total_observations": 4,
            "cloudy_observations": 1,
            "pass_count": 3,
            "pass_list": [],
            "source": "layer_cache",
        },
        sentinel_client,
    )

    stats = get_landsat_month_stats(ROI, 1, 2024, subset_directory="", write_json_cache=False)

    assert stats["source"] == "layer_cache"
    assert stats["pass_count"] == 3
    assert stats["mean_cloud_coverage"] == 10.0
    assert aggregate.captured == {
        "bucket": "ose-dev-inputs",
        "prefix": "landsat_pass_layers",
        "client": sentinel_client,
    }


def test_month_stats_falls_back_to_planetary_computer_after_s3_miss(monkeypatch):
    calls = []
    sentinel_client = object()

    def fake_defaults():
        return "ose-dev-inputs", "landsat_pass_layers", sentinel_client

    def fake_aggregate(
        roi,
        month,
        year,
        cache_directory,
        tiles_geojson=None,
        s3_bucket=None,
        s3_key_prefix="",
        s3_client=None,
    ):
        calls.append("s3")
        assert s3_bucket == "ose-dev-inputs"
        assert s3_key_prefix == "landsat_pass_layers"
        assert s3_client is sentinel_client
        return None

    def fake_live(roi, month, year, **kwargs):
        calls.append("planetary_computer")
        return {
            "year": year,
            "month": month,
            "mean_cloud_coverage": 22.0,
            "total_observations": 8,
            "cloudy_observations": 2,
            "pass_count": 4,
            "pass_list": [],
        }

    monkeypatch.setattr(
        "water_rights_visualizer.landsat_pass_count.resolve_default_landsat_pass_s3",
        fake_defaults,
    )
    monkeypatch.setattr(
        "water_rights_visualizer.landsat_pass_count.aggregate_landsat_pass_stats_from_layers",
        fake_aggregate,
    )
    monkeypatch.setattr(
        "water_rights_visualizer.landsat_pass_count._fetch_monthly_cloud_coverage_from_planetary_computer",
        fake_live,
    )

    stats = get_landsat_month_stats(ROI, 6, 2021, subset_directory="", write_json_cache=False)

    assert calls == ["s3", "planetary_computer"]
    assert stats["source"] == "planetary_computer"
    assert stats["mean_cloud_coverage"] == 22.0
    assert stats["pass_count"] == 4
