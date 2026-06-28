# AI Automation Login Design

## Goal

Adapt the project for single-user AI automation.

The owner should manage WeChat public platform login from a backend/admin page. AI clients should call public APIs with a stable API key only, without handling QR codes, browser cookies, WeChat session cookies, or article credentials.

## Current State

The project already has part of the required foundation:

- `server/api/web/login/*` handles WeChat QR-code login.
- `server/utils/proxy-request.ts` stores WeChat login cookies in `CookieStore` after `bizlogin`.
- `server/kv/cookie.ts` persists those cookies in Nitro storage with a 4-day TTL.
- `server/utils/CookieStore.ts` can resolve WeChat cookies and token from `X-Auth-Key` or the `auth-key` browser cookie.
- `server/api/public/v1/account.get.ts` and `server/api/public/v1/article.get.ts` already support API-style calls when a valid auth key exists.

The current automation problems are:

- Login is still driven by a browser modal and browser cookie state.
- The key returned by login is a temporary WeChat session key, so automation clients need to care about login refreshes.
- UI login state is stored in browser `localStorage`.
- Advanced article credentials used for comments/read-count-related features are stored in browser `localStorage`.
- There is no backend page or API for managing the single user's WeChat session lifecycle.

## Design Summary

Use two long-lived owner-configured secrets:

- `ADMIN_KEY`: protects the admin page and admin session-management endpoints.
- `API_KEY`: protects automation-facing API endpoints.

WeChat login information remains server-side. The browser admin page is only a control surface for scanning and refreshing WeChat login. AI clients never receive or send WeChat cookies.

The API request flow becomes:

1. AI sends `X-API-Key: <API_KEY>` to public API endpoints.
2. Server validates the API key.
3. Server loads the current stored WeChat session from Nitro KV.
4. Server proxies the WeChat request using the stored WeChat cookies and token.
5. Server returns normalized data or a clear login-required error.

## Server Storage

Add single-user session storage on top of Nitro KV:

- `wechat:current-session`
  - `authKey`: internal key used by the existing `CookieStore`.
  - `nickname`
  - `avatar`
  - `expiresAt`
  - `createdAt`
  - `updatedAt`

- `wechat:credentials:<biz>`
  - existing `ParsedCredential` shape.
  - stored server-side instead of browser `localStorage`.

The existing `cookie:<authKey>` storage can remain unchanged. The new session record points to the current active `authKey`.

## Admin API

Add admin-only endpoints protected by `ADMIN_KEY`:

- `POST /api/admin/wechat-login/session`
  - Creates a WeChat login session by calling the existing start-login logic.
  - Returns a backend login session id.

- `GET /api/admin/wechat-login/session/:id/qrcode`
  - Returns the QR-code image for the active backend login session.

- `GET /api/admin/wechat-login/session/:id/status`
  - Polls WeChat scan status.
  - Returns statuses such as `waiting`, `scanned`, `confirmed`, `expired`, `no_account`, `failed`.

- `POST /api/admin/wechat-login/session/:id/complete`
  - Calls the existing `bizlogin` flow after confirmation.
  - Stores the resulting WeChat cookies in `CookieStore`.
  - Writes `wechat:current-session`.
  - Returns account display information and expiry.

- `GET /api/admin/wechat-session`
  - Returns current stored session status.

- `DELETE /api/admin/wechat-session`
  - Clears the current session pointer and removes the in-memory cookie entry.

## Admin Page

Add a single admin page, for example `/admin`.

The page should:

- Ask for `ADMIN_KEY` or read it from a request header during local use.
- Show current WeChat login status.
- Start a QR-code login flow.
- Show the QR code and scan status.
- Show expiry time after login.
- Offer logout/clear-session action.

The page does not need multi-user account management.

## Public API Authentication

Add middleware or helper validation for automation APIs:

- Accept `X-API-Key`.
- Compare it with server runtime config `API_KEY`.
- Reject missing or invalid keys with `401`.

For backward compatibility, existing `X-Auth-Key` behavior can remain available, but the preferred automation path is `X-API-Key`.

When `X-API-Key` is valid, public API handlers should resolve the current server-side WeChat session automatically. They should not require callers to provide the temporary WeChat `auth-key`.

## Public API Session Resolution

Add a helper such as `getAutomationWechatSession(event)`:

1. Validate `X-API-Key`.
2. Load `wechat:current-session`.
3. Use the stored `authKey` with `CookieStore`.
4. Return the WeChat cookie/token pair.

Use this helper in public endpoints that currently call `getTokenFromStore(event)` or `getCookieFromStore(event)`.

If the session is missing or expired, return a clear structured error:

```json
{
  "base_resp": {
    "ret": -40101,
    "err_msg": "WECHAT_LOGIN_REQUIRED"
  }
}
```

## Credentials Migration

Move advanced credentials from browser storage to server storage:

- Add admin endpoint for storing captured credentials if the existing wxdown-service or mitmproxy flow is still used.
- Add backend helper to find credentials by `biz`.
- Update comment/profile endpoints so AI callers do not send `uin`, `key`, or `pass_ticket`; the server loads them by `biz`.

This can be implemented after the basic login/API-key path, because account search and article list already work with WeChat backend cookies.

## Implementation Order

1. Add runtime config for `ADMIN_KEY` and `API_KEY`, plus `.env.example` entries.
2. Add server helpers for admin-key and API-key validation.
3. Add KV helpers for the current single-user WeChat session.
4. Refactor login internals so admin endpoints can reuse start-login, QR-code, scan, and complete-login behavior without browser cookie dependence.
5. Add `/admin` page for managing login.
6. Update public API endpoints to accept `X-API-Key` and resolve the stored WeChat session automatically.
7. Add server-side credentials storage and update credentials-dependent endpoints.
8. Add focused tests for key validation, session resolution, missing-login errors, and storage helpers.

## Non-Goals

- No multi-user SaaS account system.
- No billing, quota, or user registration.
- No AI-side handling of QR codes.
- No sharing WeChat cookies with external callers.

## Open Decisions

- The admin page URL will be `/admin` unless changed.
- `X-API-Key` will be the recommended automation header.
- Existing `X-Auth-Key` support will stay for compatibility unless removed later.
