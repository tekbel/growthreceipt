# LinkedIn integration plan

## Status

Deferred by product decision on October 9, 2026. GrowthReceipt will finish authentication, judge access, and the higher priority integration work before implementing LinkedIn.

This document is the resume point for the LinkedIn integration. Recheck LinkedIn's official documentation before implementation because permissions, API versions, review requirements, and rate limits can change.

## Intended outcome

A signed in GrowthReceipt user can connect a LinkedIn account, approve a post, publish it through LinkedIn's official API, and see the verified publication result. GrowthReceipt must never publish without an explicit human approval.

The first release should support personal LinkedIn posts. Company Page publishing and analytics follow after the basic flow works.

## Required LinkedIn setup

1. Create or choose a LinkedIn Page that represents the organization.
2. Create a GrowthReceipt application in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
3. Have a Page administrator verify the application association.
4. Add the GrowthReceipt privacy policy URL, application logo, website, and business details.
5. Request the **Share on LinkedIn** product for the `w_member_social` permission.
6. Add the production callback URL in the application's **Auth** tab.
7. Copy the Client ID and Client Secret into the server environment.

Use this production callback shape:

```text
https://api.growthreceipt.com/v1/integrations/linkedin/callback
```

LinkedIn requires an absolute HTTPS callback URL. It cannot contain a URL fragment. The registered value and the value used during OAuth must match.

For local development, use an HTTPS tunnel with a stable domain and register its exact callback URL in the Developer Portal.

## Environment variables

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=
LINKEDIN_OAUTH_STATE_SECRET=
SOCIAL_TOKEN_ENCRYPTION_KEY=
```

Keep every value on the API server. Never expose the Client Secret, state secret, token encryption key, or access token through a `NEXT_PUBLIC_` variable or browser response.

## Product flow

1. The user signs in to GrowthReceipt with a permanent account.
2. The user opens **Integrations** and selects **Connect** beside LinkedIn.
3. The API verifies that the user belongs to the active workspace.
4. The API creates a short lived, single use OAuth state value tied to the user and workspace.
5. GrowthReceipt redirects the browser to LinkedIn's authorization page.
6. LinkedIn shows the permissions requested by GrowthReceipt.
7. The user approves or denies access on LinkedIn.
8. LinkedIn returns an authorization code and the original state value to the API callback.
9. The API validates the state value before exchanging the authorization code for an access token.
10. The API retrieves the permitted LinkedIn account identity.
11. The API encrypts the access token before storing it.
12. GrowthReceipt returns the user to **Integrations** and shows the connected account name.

Anonymous judge accounts must not connect external social accounts. The judge demo should show the integration state without asking judges to authorize their personal LinkedIn accounts.

## Publishing flow

1. The campaign agent drafts content for LinkedIn.
2. A human edits and approves the post.
3. GrowthReceipt creates a scheduled publishing job only after approval.
4. The worker loads and decrypts the workspace's LinkedIn token on the server.
5. The worker uploads media first when the post contains media.
6. The worker creates the LinkedIn post through the current Posts API.
7. GrowthReceipt stores the LinkedIn post identifier, publication time, request version, and result.
8. The UI shows **Published** only after LinkedIn confirms success.
9. Retries use an idempotency record so a timeout cannot create duplicate posts.
10. Later jobs retrieve the permitted delivery and engagement metrics.

## API surface

The expected GrowthReceipt routes are:

```text
GET    /v1/integrations
POST   /v1/integrations/linkedin/authorize
GET    /v1/integrations/linkedin/callback
DELETE /v1/integrations/linkedin
```

The browser receives connection status, account display information, and an authorization URL. It never receives stored provider tokens.

Publishing should run through an internal job interface rather than a public browser endpoint. The job must verify that the stored post is still approved immediately before publishing.

## Data to store

Create an `integration_connections` table with at least:

| Field | Purpose |
|---|---|
| `id` | Connection identifier |
| `workspace_id` | Owning workspace |
| `provider` | `linkedin` |
| `provider_account_id` | LinkedIn member or organization identifier |
| `provider_account_name` | Display name shown in Integrations |
| `encrypted_access_token` | Server encrypted credential |
| `granted_scopes` | Permissions the user approved |
| `expires_at` | Token expiry when supplied |
| `status` | Connected, expired, revoked, or error |
| `metadata` | Minimal provider details needed by the connector |
| `created_at` | Audit timestamp |
| `updated_at` | Audit timestamp |

Create a separate publication record for provider post identifiers, attempts, errors, and final status. Do not place provider tokens in campaign or publication records.

## Security requirements

1. Require a valid GrowthReceipt session before starting OAuth.
2. Use a random, short lived, single use state value to prevent login CSRF.
3. Tie the state value to the current user and workspace.
4. Exchange the authorization code only on the API server.
5. Encrypt access and refresh tokens at rest.
6. Request only the scopes required by implemented features.
7. Redact tokens and authorization codes from logs and error reporting.
8. Prevent anonymous judge users from connecting providers or publishing externally.
9. Require explicit human approval before every first publication.
10. Disconnect by revoking access where supported and deleting the stored credential.

## Delivery phases

### Phase 1: personal posting

1. Add the OAuth connection and callback flow.
2. Request `w_member_social` through **Share on LinkedIn**.
3. Publish approved text posts for the authenticated member.
4. Store and display the verified LinkedIn post identifier.
5. Support disconnect and expired token recovery.

### Phase 2: media and reliability

1. Add image and video upload flows.
2. Add durable jobs, retries, idempotency, and failure recovery.
3. Add publication status polling where required.
4. Add rate limit handling and operational alerts.

### Phase 3: Company Pages

1. Apply for the Community Management API Development Tier.
2. Request the organization permissions required by the implemented use cases.
3. List only Pages the authenticated member is allowed to manage.
4. Let the user select a Page for the workspace.
5. Publish approved Page posts and retrieve permitted results.
6. Complete LinkedIn's Standard Tier review before offering unrestricted production access.

LinkedIn currently requires a registered legal organization, verified business email, organization website, privacy policy, verified LinkedIn Page, and app review for Community Management access.

## Acceptance criteria

1. An authenticated permanent user can connect and disconnect LinkedIn.
2. OAuth rejects missing, expired, reused, or mismatched state values.
3. No provider secret or token reaches the browser, logs, repository, or error UI.
4. The integration row shows the actual account and connection state.
5. An unapproved post cannot enter the publishing queue.
6. An approved post produces one LinkedIn post and stores its provider identifier.
7. A retry cannot produce a duplicate LinkedIn post.
8. Expired or revoked access produces a clear reconnection state.
9. Anonymous judge users cannot authorize LinkedIn or publish externally.
10. Automated tests cover authorization, callback validation, token storage, publishing success, provider errors, and disconnect.

## Official references

1. [Getting access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
2. [LinkedIn authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
3. [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
4. [Community Management overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)
5. [Community Management app review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review)

