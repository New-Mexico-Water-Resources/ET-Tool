import logging

import pytest

from tests.support.manifest_coverage import ManifestCoverageChecker, format_missing_summary
from tests.support.paths import MANIFEST_CSV, MANIFEST_COVERAGE_GAPS_CSV, VARIABLES_YAML

logger = logging.getLogger(__name__)


@pytest.mark.unit
class TestManifestCoverage:
    @pytest.fixture(scope="class")
    def checker(self):
        return ManifestCoverageChecker(
            variables_path=VARIABLES_YAML,
            manifest_path=MANIFEST_CSV,
        )

    def test_checker_knows_all_ard_tiles(self, checker):
        assert len(checker.tiles) == 22

    def test_core_variables_have_full_coverage(self, checker):
        core_source_ids = (
            "openet_ensemble_et",
            "openet_ensemble_et_min",
            "openet_ensemble_et_max",
            "idaho_epscor_gridmet_eto",
            "oregon_state_prism_ppt",
        )
        csv_path, summary = checker.export_missing_coverage(source_ids=core_source_ids)

        incomplete = []
        reports = checker.check_all_sources()
        for source_id in core_source_ids:
            report = reports[source_id]
            if not report.is_complete:
                incomplete.append(f"{source_id}: missing {report.missing_count} of {report.expected_count}")

        if incomplete:
            summary_text = format_missing_summary(summary)
            logger.error("%s", summary_text)
            if csv_path is not None:
                logger.error("Missing manifest CSV: %s", csv_path)
            pytest.fail(
                "Manifest coverage gaps detected:\n"
                + "\n".join(incomplete)
                + "\n\n"
                + summary_text
                + (f"\n\nCSV: {csv_path}" if csv_path is not None else f"\n\nCSV: {MANIFEST_COVERAGE_GAPS_CSV}")
            )

    def test_no_unexpected_manifest_dates_before_transition(self, checker):
        transition_year = checker.variables_config["openet_transition_date"]
        post_transition_variables = {"ET", "ET_MIN", "ET_MAX", "ETO", "PPT"}
        subset = checker.manifest[
            checker.manifest["variable"].isin(post_transition_variables)
            & (checker.manifest["date"] < f"{transition_year}-01-01")
        ]
        subset = subset[~subset["filename"].str.startswith("LT")]
        assert subset.empty
