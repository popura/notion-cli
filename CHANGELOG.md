# Changelog

## [0.4.0] - 2026-08-23

Existing browser login commands and saved OAuth client/token files remain compatible. No migration action is required.

### Added

- Interactive headless MCP OAuth through `ncli login --headless`.
- Configurable authorization wait through `--auth-timeout <seconds>` with a 1–600 second range.
- Hidden TTY input for complete callback URLs copied from a browser on the same or another computer.

### Security

- OAuth `state`, redirect URI, expiry, error/code cardinality, and callback length validation for browser and headless callbacks.
- Profile-scoped, atomic pending OAuth state with a maximum 10-minute lifetime and owner-only file permissions on POSIX-compatible filesystems.
- Temporary-state cleanup after success, invalid input, denial, timeout, or token-exchange failure.
- Rejection of concurrent login attempts for the same profile.

### Changed

- Authenticated commands now try saved access and Refresh Tokens before creating a browser interaction or HTTP listener.
- Browser-launch and listener failures include a profile-scoped recovery hint for `login --headless`.
- OAuth provider interaction is separated from token, client-registration, and PKCE persistence.

### Limitations

Headless login is interactive Authorization Code Flow + PKCE. It still requires a person with a browser and an interactive terminal. It is not OAuth Device Authorization Grant (Device Code Flow) and does not support unattended or service-account authentication.
