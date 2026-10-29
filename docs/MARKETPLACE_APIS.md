# Marketplace APIs: automatic returns imports

Aether can import returns on its own instead of someone downloading and uploading the report. Imports go through the
same steps as an upload: Amazon's units grouped per order, duplicates skipped (so overlapping runs are safe), products
matched by listing, and buyers' notes sorted into mentions. New returns count straight away; corrections happen on
**Returns → Review returns** as before.

Status and recent runs: **Returns → Import returns** (Automatic imports) and **Admin → Integrations**. Both Amazon and
TikTok are built; each turns on when its keys are set.

**Past returns.** The regular runs cover the last 14 days. After a channel's first successful run, Aether also brings in
its past two years, one month per request (Amazon builds a report for each, about a minute apiece, so two years takes
roughly half an hour). It runs in the background, shows how far it has got on **Import returns**, and picks up where it
left off if the server restarts. Anyone with edit access can run it again from an earlier date (**Bring in past
returns**). Returns already uploaded or imported are skipped, so it is safe to run over months that have uploads. How
far back a marketplace still has data is up to the marketplace: months it no longer keeps come back empty.

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

## TikTok Shop (Open API)

What Aether reads: the shop's **returns** (the returns search, API version 202309): each return request with its order,
items, reason, status and the buyer's note, mapped to the same columns as TikTok's returns export, so it imports the
same way. A request covering several items is one return (one piece of feedback) with each item counted in its
quantity. Every status is kept, as in the export, including requests the buyer cancelled or the seller rejected.
Nothing is written to TikTok.

How often: every `TIKTOK_SYNC_HOURS` hours (default 12), covering the last 14 days, plus **Import now**.

### Setting it up

1. **App**: in TikTok Shop Partner Center (partner.tiktokshop.com), signed in with the seller account, create a
   **custom (in-house) app** for your own shop with the **Return & Refund** scope (and **Order** if offered). TikTok
   reviews it.
2. **Keys**: from the app, the **App key** and **App secret**. In Railway → Aether → **Variables**, add
   `TIKTOK_APP_KEY` and `TIKTOK_APP_SECRET`. Redeploy.
3. **Redirect URL**: **Admin → Integrations** now shows a TikTok card with the address to use, ending
   `/api/integrations/tiktok/callback`. Set it as the app's redirect URL in Partner Center.
4. **Authorize the shop**: signed in to Aether as an admin, open the app's authorization link from Partner Center and
   approve it for the shop. TikTok sends you back to Integrations, which shows **Connected**. Aether keeps the tokens
   and refreshes them itself. (Alternatively set `TIKTOK_REFRESH_TOKEN`, and `TIKTOK_SHOP_CIPHER` if you have it.)
5. **Import now** on the TikTok card to check it.

### Checking the first real run

TikTok's documentation wasn't reachable when this was built, so the request signing, tokens and returns search
follow TikTok's API as known then, and were tested against a stand-in, not TikTok itself. Two things to confirm on the
first real run, from the run's line on **Admin → Integrations**, which lists the field names TikTok sent (names only,
no customer data):

- **The buyer's note.** Aether reads it from the first of `buyer_remarks`, `buyer_remark`, `return_reason_description`,
  `description`, `buyer_note`, `remark`. If TikTok calls it something else, add that name to `NOTE_FIELDS` in
  `server/lib/tiktokShop.js`. Until then, uploading TikTok's export still fills in notes on returns imported without
  one.
- **Items**: `return_line_items` with `product_name`, `seller_sku`, `sku_id`, `product_id`.

If a call is refused, the run's error says why (signature, token or shop).
