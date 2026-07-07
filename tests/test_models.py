"""Model-weights registry: cache/verify/download logic against a tmp dir."""

import hashlib
import io

import pytest

from sidecar import models, worker


@pytest.fixture
def registry(tmp_path, monkeypatch):
    """A fake one-entry registry downloading b'weights' into a tmp cache."""
    payload = b"weights"
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(models, "_verified", set())
    monkeypatch.setitem(
        models._REGISTRY,
        "fake",
        {
            "url": "https://example.com/fake.pt",
            "sha256": hashlib.sha256(payload).hexdigest(),
            "filename": "fake.pt",
        },
    )
    return payload


def test_required_models_are_registered():
    # The worker's up-front ensure() calls must all resolve in the registry.
    assert set(worker._REQUIRED_MODELS) <= set(models._REGISTRY)


def test_download_verifies_and_caches(registry, tmp_path, monkeypatch):
    calls = []

    def fake_urlopen(url, timeout):
        calls.append(url)
        return io.BytesIO(registry)

    monkeypatch.setattr(models.urllib.request, "urlopen", fake_urlopen)
    dest = models.ensure("fake")
    assert dest == tmp_path / "fake.pt"
    assert dest.read_bytes() == registry
    # Second call trusts the verified path — no re-download, no re-hash needed.
    assert models.ensure("fake") == dest
    assert len(calls) == 1


def test_checksum_mismatch_fails_and_leaves_no_file(registry, tmp_path, monkeypatch):
    monkeypatch.setattr(
        models.urllib.request,
        "urlopen",
        lambda url, timeout: io.BytesIO(b"tampered"),
    )
    with pytest.raises(ValueError, match="checksum mismatch"):
        models.ensure("fake")
    assert not (tmp_path / "fake.pt").exists()
    assert list(tmp_path.glob("*.part")) == []


def test_existing_valid_file_skips_download(registry, tmp_path, monkeypatch):
    (tmp_path / "fake.pt").write_bytes(registry)

    def boom(url, timeout):
        raise AssertionError("must not download")

    monkeypatch.setattr(models.urllib.request, "urlopen", boom)
    assert models.ensure("fake") == tmp_path / "fake.pt"
