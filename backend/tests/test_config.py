from tests.conftest import FAKE_GEMINI_KEY, make_settings


def test_defaults_without_env():
    s = make_settings()
    assert s.gemini_api_key is None
    assert s.pixabay_api_key is None
    assert s.embedding_provider == "gemini"
    assert s.embedding_dim == 768


def test_env_vars_override(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", FAKE_GEMINI_KEY)
    monkeypatch.setenv("EMBEDDING_DIM", "1536")
    s = make_settings()
    assert s.gemini_api_key.get_secret_value() == FAKE_GEMINI_KEY
    assert s.embedding_dim == 1536


def test_secrets_hidden_in_repr():
    s = make_settings(gemini_api_key=FAKE_GEMINI_KEY, pixabay_api_key="pk")
    assert FAKE_GEMINI_KEY not in repr(s)
    assert FAKE_GEMINI_KEY not in str(s.model_dump())
