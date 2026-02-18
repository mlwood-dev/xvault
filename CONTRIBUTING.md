# Contributing to XVault

Thanks for helping improve XVault.

## Start Here

- Read `README.md` and `docs/deployment.md` first.
- For security issues, use `SECURITY.md` (do not open public exploit reports).
- Keep work scoped to one concern per pull request when possible.

## Local Setup

1. Install dependencies:
   - `npm install`
2. Run tests:
   - `npm test`
   - `npm run test:jest`
3. Validate behavior manually for touched flows.

## Reporting Issues

When filing an issue:

- include reproducible steps
- include expected vs actual behavior
- include environment details (Node.js, OS, network context)
- avoid posting secrets, seeds, API keys, or sensitive data

## Pull Request Guidance

A good PR includes:

- concise summary of what changed and why
- test evidence (`npm test`, `npm run test:jest`, and/or manual checks)
- documentation updates when API/behavior changes
- security impact notes for signature/auth/crypto/storage-related changes

Use the repository PR template in `.github/PULL_REQUEST_TEMPLATE.md`.

## Coding Guardrails

- Maintain deterministic contract behavior for HotPocket consensus.
- Preserve client-side encryption model boundaries.
- Keep signature and authorization paths explicit and testable.
- Avoid introducing plaintext secret handling in contract paths.
- Do not commit secrets (`.env`, seeds, private keys, API keys).

## Style and Structure

- Use ES modules.
- Prefer explicit validation and clear error codes/messages.
- Add JSDoc for public APIs where applicable.
- Keep unrelated refactors out of functional/security PRs.

## Community Expectations

By participating, you agree to follow the Code of Conduct:

- `.github/CODE_OF_CONDUCT.md`

