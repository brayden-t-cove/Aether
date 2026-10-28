# Marketplace APIs: automatic returns imports

Aether can import returns on its own instead of someone downloading and uploading the report. Imports go through the
same steps as an upload: Amazon's units grouped per order, duplicates skipped (so overlapping runs are safe), products
matched by listing, and buyers' notes sorted into mentions. New returns count straight away; corrections happen on
**Returns → Review returns** as before.

Status and recent runs: **Returns → Import returns** (Automatic imports) and **Admin → Integrations**.

## Amazon (Selling Partner API)

What Aether reads: the **FBA customer returns report** (`GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`), the same file as
Seller Central → Reports → Fulfillment → Customer returns. Nothing is written to Amazon, and Aether doesn't ask for
buyers' names or addresses.

How often: every `AMAZON_SP_SYNC_HOURS` hours (default 12), covering the last 14 days each time, plus **Import now**.
Amazon builds each report before it can be downloaded, which takes about a minute.

### Setting it up (someone with Seller Central admin access)

1. **Developer profile** (once; Amazon reviews it, which can take a few days): Seller Central → **Apps and Services →
   Develop Apps**. Register as a **private developer** ("I build applications to integrate my own company with the
   Selling Partner API").
   - Data access (roles): **Amazon Fulfillment**. Optionally **Inventory and Order Tracking** (needed later to tie a
     return to the order date, for return rates by sales week). Leave out roles that include buyer details.
   - Use case: "Internal tool that reads our FBA customer returns report for product-quality analysis."
2. **App**: once the profile is approved, **Develop Apps → Add new app client**. Name it "Aether", API type
   **SP API**, and give it the same roles. (Amazon no longer needs an AWS IAM ARN.)
3. **Keys**: on the app, **View** the Login with Amazon credentials: the **client identifier** and **client secret**.
4. **Authorize your own store**: on the app, **Authorize** (self-authorization) and copy the **refresh token**.
5. In Railway → Aether → **Variables**, add:

   | Variable | Value |
   |---|---|
   | `AMAZON_SP_CLIENT_ID` | The client identifier (starts `amzn1.application-oa2-client.`) |
   | `AMAZON_SP_CLIENT_SECRET` | The client secret |
   | `AMAZON_SP_REFRESH_TOKEN` | The refresh token (starts `Atzr|`) |
   | `AMAZON_SP_MARKETPLACE_ID` | Optional. Default `ATVPDKIKX0DER` (US) |
   | `AMAZON_SP_REGION` | Optional. `na` (default), `eu` or `fe` |
   | `AMAZON_SP_SYNC_HOURS` | Optional. Default 12 |

   Treat the secret and refresh token like passwords: only in Railway, never in chat, email or the repository.
6. After the redeploy, **Admin → Integrations** shows Amazon as connected. Use **Import now** to check it.

Amazon expires app client secrets periodically. When that happens, imports fail with "Amazon refused the app's keys";
generate a new secret on the app and update `AMAZON_SP_CLIENT_SECRET`.

## TikTok Shop

Not built yet. TikTok's returns API needs an app in TikTok Shop Partner Center (partner.tiktokshop.com) with the
Return & Refund scope, and its field names (including where the buyer's note is) have to be checked against TikTok's
documentation before Aether relies on them. Until then, upload TikTok's returns export on **Import returns**.
