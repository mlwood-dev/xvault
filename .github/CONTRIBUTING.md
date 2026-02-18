# Contributing

Thanks for contributing to XVault.

## Before Opening an Issue

- Search existing issues and discussions first.
- For security concerns, do not open a public issue; follow `.github/SECURITY.md`.
- Include clear reproduction details and environment information.

## Development Workflow

1. Fork and create a feature branch from the default branch.
2. Install dependencies:
   - `npm install`
3. Run tests before opening PR:
   - `npm test`
   - `npm run test:jest`
4. Update docs when behavior or APIs change.
5. Open a PR using the repository template.

## Pull Request Expectations

- Keep changes focused and reviewable.
- Include test evidence in the PR description.
- Call out security impact and backward compatibility notes.
- Avoid unrelated formatting/refactor churn.

## Coding and Security Guardrails

- Preserve client-side cryptography boundaries (no plaintext in contract handlers).
- Keep contract logic deterministic for HotPocket consensus.
- Keep signatures/access checks explicit in contract and SDK request paths.
- Do not commit secrets, seeds, or API keys.

## Project Documentation

Primary references:

- `README.md`
- `docs/contract-api.md`
- `docs/sdk-api.md`
- `docs/security-model.md`
- `docs/deployment.md`
