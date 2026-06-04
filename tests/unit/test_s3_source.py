import pytest

from datetime import date

from water_rights_visualizer.errors import FileUnavailable
from water_rights_visualizer.S3_source import S3Source

from tests.support.paths import MANIFEST_CSV


@pytest.mark.unit
class TestS3Source:
    def test_inventory_includes_monthly_openet_dates(self):
        source = S3Source(
            bucket_name="unused",
            temporary_directory="/tmp/et-tool-test-unused",
            S3_table_filename=str(MANIFEST_CSV),
            remove_temporary_files=False,
        )
        years, dates = source.inventory()
        assert 2021 in years
        assert date(2021, 1, 1) in dates
        assert all(d.day == 1 for d in dates if d.year >= 1985)

    def test_missing_manifest_entry_raises_file_unavailable(self):
        source = S3Source(
            bucket_name="unused",
            temporary_directory="/tmp/et-tool-test-unused",
            S3_table_filename=str(MANIFEST_CSV),
            remove_temporary_files=False,
        )
        with pytest.raises(FileUnavailable):
            with source.get_filename(tile="999999", variable_name="ET", acquisition_date=date(1900, 1, 1)):
                pass

    def test_manifest_lookup_uses_zero_padded_tile(self):
        source = S3Source(
            bucket_name="unused",
            temporary_directory="/tmp/et-tool-test-unused",
            S3_table_filename=str(MANIFEST_CSV),
            remove_temporary_files=False,
        )
        manifest = source.S3_table
        match = manifest[
            (manifest["tile"] == 9014)
            & (manifest["variable"] == "ET")
            & (manifest["date"] == "2021-01-01")
        ]
        assert len(match) == 1
