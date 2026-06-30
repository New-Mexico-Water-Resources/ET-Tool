import pytest


@pytest.mark.unit
@pytest.mark.parametrize(
    "cloud_coverage_percent,expected",
    [
        (0.0, 0.0),
        (0.05, 0.05),
        (1.0, 1.0),
        (None, None),
    ],
)
def test_cloud_coverage_percent_zero_is_not_treated_as_missing(cloud_coverage_percent, expected):
    percentages = {"cloud_coverage_percent": cloud_coverage_percent}

    percentage = None
    if percentages and percentages.get("cloud_coverage_percent") is not None:
        percentage = percentages["cloud_coverage_percent"]
        percentage = max(percentage, 0)
        percentage = min(percentage, 1)

    assert percentage == expected
