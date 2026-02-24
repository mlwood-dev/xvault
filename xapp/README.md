# XVault xApp Client

This directory contains a browser client intended to run as a Xaman xApp for XVault.

## What this client does

- Detects Xaman launch context and OTT token (`xAppToken` query param or xApp SDK environment).
- Applies Xaman style-guide compatible theming using the `xAppStyle` query parameter.
- Connects to an XVault service session endpoint.
- Lets users:
  - create individual/team vaults
  - list existing vaults
  - add entries to a vault
  - revoke a vault

## Xaman style-guide alignment

The client follows the documented xApp style conventions by:

- Using the Xumm Proxima Nova font embed:
  - `https://use.typekit.net/vtt7ckl.css`
- Reading `xAppStyle` and loading matching Xumm xApp theme CSS:
  - `https://xumm.app/assets/themes/xapp/xumm-{theme}/bootstrap.min.css`
- Supporting style values:
  - `light`, `dark`, `moonlight`, `royal`
- Using a mobile-first layout with safe-area insets (`viewport-fit=cover` + `env(safe-area-inset-*)`).

## Required service API contract

The xApp expects an XVault service with these endpoints under your configured base URL (default: `<origin>/v1`):

- `POST /session/xaman`
  - Request: `{ ott, xAppToken, xAppStyle, userAgent }`
  - Response: `{ ok?: boolean, data: { account, network, jwt, ... } }`
- `GET /vaults`
  - Response: array or `{ data: array }` / `{ data: { vaults: array } }`
- `POST /vaults`
  - Request: `{ type: "individual" | "team" }`
- `POST /vaults/:vaultId/entries`
  - Request: `{ service, username?, password?, notes? }`
- `POST /vaults/:vaultId/revoke`

For signing-first backends, operation responses can include one of:

- `signRequestUuid`
- `payloadUuid`
- `uuid`

If present, the client attempts `xApp.openSignRequest({ uuid })`.

## Local preview

Serve the `xapp/` directory from any static server and optionally point to your backend:

- `http://localhost:4173/?serviceUrl=https://your-xvault-service/v1`

For Xaman launch, configure your xApp launch URL to this hosted `index.html`.

