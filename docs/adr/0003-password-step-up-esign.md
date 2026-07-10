# ADR-0003: Password step-up for e-signature re-authentication

Status: accepted (2026-07-10)

## Context

21 CFR Part 11 §11.200(a) requires that an electronic signature be executed by
a signing action that re-establishes the signer's identity — you cannot sign
merely by holding a live session. `edc-core` supports two mechanisms: password
re-entry, and a single-use grant minted by a fresh interactive OIDC login
(`prompt=login`, `auth_time`-checked). The OIDC path adds a browser round-trip
to the IdP and a `reauth_grants` table.

## Decision

LIMS uses **password step-up only**: each signature re-verifies the signer's
password against their Argon2 local credential (`AuthService.reauthenticate`).
Self-contained, no IdP round-trip, no grant table.

- Failures count toward lockout exactly like login failures (§11.300(d)) and
  are trigger-audited as `app_user.update` events.
- An OIDC-provisioned account with no local password cannot sign until one is
  set (`reauthenticate` returns `no_password` → 409).

## Consequences

Signing works offline from the IdP and stays simple. The tradeoff: SSO-only
deployments must still provision a local signing password for anyone who
signs, which is a deliberate, documented exception to "SSO is the only
credential." If a future customer requires IdP-backed signing, the edc
reauth-grant flow is the reference to port — this ADR would be superseded, not
patched.
