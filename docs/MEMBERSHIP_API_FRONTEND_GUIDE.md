# Membership Purchase Flow — Frontend Integration Guide

This document is for the frontend team. It describes every API call needed to take a logged-in user from "no membership" to "active member" using Stripe-hosted Checkout, plus how to verify the result.

The membership flow is **form-gated**: every member must have submitted the Google application form *before* they can pay. The form submission is delivered to the backend by a Google Apps Script trigger (server-to-server). Your job on the frontend is to send the user to the form, then resume the checkout once the form has landed.

## 1. Overview of the flow

```
┌────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────────┐
│  Register  │ ──▶ │  Fill the  │ ──▶ │  Membership  │ ──▶ │ Stripe-hosted│
│  / Log in  │     │ Google Form│     │   Checkout   │     │   Checkout   │
└────────────┘     └────────────┘     └──────────────┘     └──────┬───────┘
                          │                                        │
                          ▼                                        ▼ user pays
                   (Apps Script POSTs to                  ┌──────────────┐
                    /api/membership-applications/intake   │ Stripe sends │
                    — frontend doesn't call this)         │  webhook to  │
                                                          │   backend    │
                                                          └──────┬───────┘
                                                                 ▼
                                                       ┌──────────────────┐
                                                       │ Membership row   │
                                                       │ created `active` │
                                                       └──────────────────┘
```

**You only call 4 endpoints:** register/login, application status, checkout, and verify (users/me). The webhook and form intake are backend concerns.

## 2. Base URL & authentication

- **Dev**: `http://localhost:1337`
- **Prod**: TBD

All endpoints below that require auth use:
```
Authorization: Bearer <jwt>
```

The JWT comes from `/api/auth/local` or `/api/auth/local/register`. Save it in `localStorage` or a cookie. JWTs expire after 30 days by default.

## 3. The Google Form

Link: `https://forms.gle/EY6e6YU4tx1ab5Vo8`

After registration, redirect the user (or open in a new tab) to the form. The form is configured to collect email addresses automatically — make sure the user is signed in to the same Google account whose email matches the email they registered with on the platform, **or** instruct them to type their platform email into the form's email field. Email is the join key between the form submission and their platform account.

The Apps Script attached to the form posts each submission to the backend. There can be a delay of a few seconds between submit-button-click and the backend receiving it.

---

## 4. Endpoints

### 4.1 `POST /api/auth/local/register`

Create a new account.

**Request body**
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "atLeast6Characters"
}
```

**Success — 200**
```json
{
  "jwt": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 12,
    "username": "alice",
    "email": "alice@example.com",
    "confirmed": true,
    "blocked": false
  }
}
```
Persist `jwt`. Persist `user.email` — you'll need it later to match against the application.

**Common errors**
| Status | Reason |
|---|---|
| 400 `Email or Username are already taken` | Use a different one or send the user to log in |
| 400 `password must be longer than 5 characters` | Frontend should validate before sending |

### 4.2 `POST /api/auth/local`

Log in an existing user.

**Request body**
```json
{ "identifier": "alice@example.com", "password": "..." }
```
`identifier` accepts either email or username. Same response shape as register.

### 4.3 `GET /api/membership-applications/me`

**Auth required.** Check whether the logged-in user's Google Form application is on file.

**Success — 200** (application exists)
```json
{
  "id": 4,
  "email": "alice@example.com",
  "fullName": "Alice Wong",
  "birthday": "1990-01-01",
  "idNumber": "A123456789",
  "gender": "Female",
  "positionTitle": "Engineer",
  "isUniversityStudent": "No",
  "address": "Taipei",
  "phone": "0912345678",
  "lineId": "alicew",
  "bankTransferInfo": "12345",
  "questionsNeeds": "...",
  "submittedAt": "2026-05-08T15:46:56.000Z"
}
```

**Not found — 404** (no application yet)
```json
{ "data": null, "error": { "status": 404, "name": "NotFoundError", "message": "No application on file" } }
```

**Use this to**
- Show "complete the form" CTA if 404
- Show "you're all set, choose a plan" CTA if 200
- Poll this every 5–10s after the user reports they've submitted the form

### 4.4 `POST /api/payments/checkout/membership`

**Auth required.** Initiates a Stripe-hosted subscription checkout.

**Request body**
```json
{ "planId": 1 }
```

`planId` corresponds to a Subscription Plan in Strapi admin. Get the list via `GET /api/subscrition-plans?filters[active][$eq]=true` *(yes, the path has a typo — `subscrition`)*.

| planId | Name | Tier | Price/year |
|---|---|---|---|
| 1 | Low Fee Annual | LOW | $80 |
| 2 | Premium Annual | PREMIUM | $100 |

**Success — 200**
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1..." }
```
**Redirect the user to `url`** (e.g., `window.location.href = url`).

**Common errors**
| Status | Body message | Fix |
|---|---|---|
| 401 | `Missing or invalid credentials` | JWT missing/expired — log in again |
| 400 | `Please complete the membership application form before purchasing` | User skipped the form. Redirect to it. |
| 400 | `planId required` | You forgot to send it |
| 400 | `Plan not found or inactive` | Wrong planId, or plan was disabled in admin |
| 400 | `Plan has no Stripe price configured` | Backend admin needs to set the `stripePriceId` on the plan row |
| 400 | `You already have an active membership; use the billing portal to manage it` | Send them to `/api/payments/portal` |

### 4.5 Stripe Checkout success / cancel pages

After the user pays (or cancels), Stripe redirects to:
- Success: `${CLIENT_URL}/membership/success`
- Cancel: `${CLIENT_URL}/membership/cancel`

Build these pages on the frontend. **Don't trust query params from Stripe to mark the user as a member** — the actual membership creation is driven by the webhook, server-side. The success page should:

1. Show "thank you, processing..."
2. Poll `GET /api/users/me?populate=memberships` every ~2s up to ~30s
3. As soon as `memberships[0].subscriptionStatus === 'active'`, show success
4. If 30s with no active membership, show "this is taking longer than usual; check email"

### 4.6 `GET /api/users/me?populate=memberships`

**Auth required.** Returns the current user with memberships array populated.

**Success — 200** (active member)
```json
{
  "id": 12,
  "username": "alice",
  "email": "alice@example.com",
  "memberships": [
    {
      "id": 7,
      "accessLevel": "low",
      "subscriptionStatus": "active",
      "StartDate": "2026-05-08T00:00:00.000Z",
      "endDate": "2027-05-08T00:00:00.000Z",
      "stripeSubscriptionId": "sub_...",
      "stripeCustomerId": "cus_..."
    }
  ]
}
```

**Status values**
| Status | Meaning |
|---|---|
| `pending_payment` | Created but Stripe hasn't confirmed yet |
| `active` | Currently a paying member. Grant access. |
| `past_due` | Stripe couldn't charge the renewal; auto-retrying. Show "update card" CTA. Keep access. |
| `cancelled` | User cancelled in portal. Keep access until `endDate`. |
| `expired` | Future cron-set state |
| `inactive` | Should not happen normally |

**Computing "is the user actually a member right now"**
```ts
function isActiveMember(memberships): boolean {
  return memberships.some(m =>
    (m.subscriptionStatus === 'active' || m.subscriptionStatus === 'past_due')
    && new Date(m.endDate) > new Date()
  );
}
```

### 4.7 `POST /api/payments/portal`

**Auth required.** Opens a Stripe Billing Portal session — the canonical way for users to update card, view invoices, or cancel.

**Success — 200**
```json
{ "url": "https://billing.stripe.com/p/session/test_..." }
```
Redirect to it.

**Errors**
| Status | Reason |
|---|---|
| 400 `No Stripe customer found for this user` | Don't show this button to non-members. |

---

## 5. Access tier matrix

| User state | `tier=free` | `tier=lowcost` | `tier=premium` |
|---|---|---|---|
| Logged out | ❌ require login | ❌ | ❌ |
| Logged in, no membership | ✅ | 💳 must purchase | 💳 must purchase |
| Active LOW member | ✅ | ✅ | 💳 must purchase |
| Active PREMIUM member | ✅ | ✅ | ✅ |

`💳` items are sold individually via:
- `POST /api/payments/checkout/course` body `{ "courseId": N }` *(see `COURSE_PURCHASE_FRONTEND_GUIDE.md`)*
- `POST /api/payments/checkout/webinar` body `{ "webinarId": N }` *(see `WEBINAR_PURCHASE_FRONTEND_GUIDE.md`)*

---

## 6. Test-mode setup

Test cards:
| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Always succeeds |
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0025 0000 3155` | Triggers 3D Secure |

Any future expiry (`12/34`), any 3-digit CVC (`123`), any postal code.

---

## 7. Verification checklist — the five things proven working

### ✅ 1. Membership application intake (HMAC-signed)
Backend-only. The frontend never calls this; redirect users to the Google Form. To verify it landed: `GET /api/membership-applications/me` → 200.

### ✅ 2. Form-gated checkout
- Without application → 400 `Please complete the membership application form before purchasing`
- With application → 200 `{ "url": "https://checkout.stripe.com/..." }`

### ✅ 3. Subscription Checkout → Stripe → webhook → membership row
After paying, poll `/users/me?populate=memberships` for `subscriptionStatus === "active"` within ~5s.

### ✅ 4. Membership linked to correct user, correct tier, 1-year window
Verify `accessLevel`, `StartDate`, `endDate`, `stripeSubscriptionId` on the returned membership.

### ✅ 5. Payment row recorded with idempotency key
Backend dedupes on `stripeEventId`. Replays don't create duplicates.

---

## 8. Recommended frontend states

```
NOT_LOGGED_IN ──login──▶ LOGGED_IN_NO_APPLICATION ──form-submitted──▶ READY_TO_PAY
                                  │                                       │
                                  ▼                                       ▼
                          (poll /me every 10s)                (call checkout, redirect)
                                                                         │
                                                                         ▼
                                                                    PAYING (Stripe)
                                                                         │
                                                                         ▼
                                                            POLLING_FOR_MEMBERSHIP
                                                                         │
                                                                         ▼
                                                                       MEMBER
```

---

## 9. Open questions / known gaps

- Cancellation grace period UX (`cancelled` until `endDate`)
- `past_due` "update your card" banner
- Mid-cycle upgrade/downgrade (LOW ↔ PREMIUM) — not supported; user must cancel + resubscribe
- Refunds — manual via Stripe Dashboard; backend has no auto-handling
