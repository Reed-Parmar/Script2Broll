class ProviderError(Exception):
    """Raised by providers with a message that is safe to show to API clients.

    Providers must never put secrets (API keys, signed URLs) in this message. Wrap
    third-party exceptions instead of passing their text through, since HTTP client
    errors often include the full request URL and query string.
    """


class ProviderNotConfigured(ProviderError):
    """The provider's credentials or settings are missing."""
