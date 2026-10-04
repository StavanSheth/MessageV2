import pytest
from backend.automation.chrome_profile_manager import ChromeProfileManager

def test_chrome_profile_manager_defaults_to_stavan_sheth():
    manager = ChromeProfileManager()
    profiles = manager.list_profiles()
    
    assert len(profiles) > 0
    # First profile must be default / Stavan Sheth
    top_profile = profiles[0]
    assert top_profile["is_default"] is True
    assert "Default" in top_profile["id"] or "STAVAN SHETH" in (top_profile.get("gaia_name") or "")

def test_chrome_profile_selection():
    manager = ChromeProfileManager()
    profiles = manager.list_profiles()
    
    first_id = profiles[0]["id"]
    manager.set_active_profile(first_id)
    assert manager.get_active_profile_id() == first_id
    
    active = manager.get_active_profile()
    assert active["id"] == first_id

def test_chrome_profile_invalid_selection():
    manager = ChromeProfileManager()
    with pytest.raises(ValueError):
        manager.set_active_profile("NonExistentProfile_99999")
