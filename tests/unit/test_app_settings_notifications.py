from unittest.mock import MagicMock, patch

from water_rights_visualizer.job_notification import admin_job_notifications_enabled, notifications_enabled


@patch("water_rights_visualizer.job_notification.build_mongo_collection")
def test_admin_job_notifications_enabled_defaults_false(mock_build_collection):
    mock_collection = MagicMock()
    mock_collection.find_one.return_value = None
    mock_build_collection.return_value = mock_collection

    assert admin_job_notifications_enabled(logger=lambda *_args, **_kwargs: None) is False


def test_notifications_enabled_requires_env_and_admin_flag(monkeypatch):
    monkeypatch.setenv("JOB_NOTIFICATIONS_ENABLED", "true")
    with patch("water_rights_visualizer.job_notification.admin_job_notifications_enabled", return_value=False):
        assert notifications_enabled(logger=lambda *_args, **_kwargs: None) is False

    with patch("water_rights_visualizer.job_notification.admin_job_notifications_enabled", return_value=True):
        assert notifications_enabled(logger=lambda *_args, **_kwargs: None) is True

    monkeypatch.setenv("JOB_NOTIFICATIONS_ENABLED", "false")
    with patch("water_rights_visualizer.job_notification.admin_job_notifications_enabled", return_value=True):
        assert notifications_enabled(logger=lambda *_args, **_kwargs: None) is False
