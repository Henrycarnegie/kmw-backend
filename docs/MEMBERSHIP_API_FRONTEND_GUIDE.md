# Membership Purchase Flow — Frontend Integration Guide

This document is for the frontend team. It describes every API call needed to take a logged-in user from "no membership" to "active member" using hosted Checkout, plus how to verify the result.

The membership flow is **form-gated**: every member must submit the website membership application form *before* they can pay.

## 1. Overview of the flow

```
┌────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────────┐
│  Register  │ ──▶ │  Fill the  │ ──▶ │  Membership  │ ──▶ │   Hosted     │
│  / Log in  │     │ Site Form  │     │   Checkout   │     │   Checkout   │
└────────────┘     └────────────┘     └──────────────┘     └──────┬───────┘
                          │                                        │
                          ▼                                        ▼ user pays
                   (frontend POSTs to                     ┌──────────────┐
                    /api/membership-applications)         │ Stripe sends │
                                                          │  webhook to  │
                                                          │   backend    │
                                                          └──────┬───────┘
                                                                 ▼
                                                       ┌──────────────────┐
                                                       │ Membership row   │
                                                       │ created `active` │
                                                       └──────────────────┘
```

**You call 5 endpoints:** register/login, submit application, application status, checkout, and verify (users/me). Stripe webhooks and PayPal/LINE Pay callbacks are backend concerns.

## 2. Base URL & authentication

- **Dev**: `http://localhost:1337`
- **Prod**: TBD

All endpoints below that require auth use:
```
Authorization: Bearer <jwt>
```

The JWT comes from `/api/auth/local` or `/api/auth/local/register`. Save it in `localStorage` or a cookie. JWTs expire after 30 days by default.

## 3. The Website Application Form

After registration or login, show the membership application form on the website. Submit it directly to `POST /api/membership-applications` with the user's JWT. The backend uses the logged-in user's account email automatically.

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

### 4.3 `POST /api/membership-applications`

**Auth required.** Create or update the logged-in user's membership application form.

**Request body**
```json
{
  "planId": 1,
  "fullName": "Alice Wong",
  "birthday": "1990-01-01",
  "email": "alice@example.com",
  "gender": "Female",
  "lineId": "alicew",
  "idNumber": "A123456789",
  "phone": "0912345678",
  "address": "Taipei",
  "positionTitle": "Engineer",
  "isUniversityStudent": "No"
}
```

**Success — 200**
```json
{ "ok": true, "id": 4, "email": "alice@example.com" }
```

### 4.4 `GET /api/membership-applications/me`

**Auth required.** Check whether the logged-in user's website application is on file.

**Success — 200** (application exists)
```json
{
  "id": 4,
  "planId": 1,
  "email": "alice@example.com",
  "fullName": "Alice Wong",
  "birthday": "1990-01-01",
  "gender": "Female",
  "lineId": "alicew",
  "idNumber": "A123456789",
  "phone": "0912345678",
  "address": "Taipei",
  "positionTitle": "Engineer",
  "isUniversityStudent": "No",
  "submittedAt": "2026-05-08T15:46:56.000Z"
}
```

**Not found — 404** (no application yet)
```json
{ "data": null, "error": { "status": 404, "name": "NotFoundError", "message": "No application on file" } }
```

**Use this to**
- Show "complete the form" CTA if 404
- Show "you're all set, choose a subscription" CTA if 200
- Poll this every 5–10s after the user reports they've submitted the form

### 4.5 `POST /api/payments/checkout/membership`

**Auth required.** Initiates a hosted membership checkout.

**Request body**
```json
{
  "subscriptionId": 1,
  "paymentProvider": "paypal",
  "fullName": "Alice Wong",
  "birthday": "1990-01-01",
  "email": "alice@example.com",
  "gender": "Female",
  "lineId": "alicew",
  "idNumber": "A123456789",
  "phone": "0912345678",
  "address": "Taipei",
  "positionTitle": "Engineer",
  "isUniversityStudent": "No"
}
```

`subscriptionId` corresponds to a Subscription in Strapi admin. Get the list via `GET /api/subscriptions?filters[active][$eq]=true` .

| subscriptionId | Name | Tier | Price/year |
|---|---|---|---|
| 1 | Low Fee Annual | LOW | $80 |
| 2 | Premium Annual | PREMIUM | $100 |

**Success — 200**
```json
{ "url": "https://checkout-provider.example/...", "id": "payment_id", "provider": "paypal" }
```
**Redirect the user to `url`** (e.g., `window.location.href = url`).

Omit `paymentProvider` to use Stripe, or send `"paypal"` / `"line_pay"` for those hosted checkout flows. Stripe creates a recurring subscription. PayPal and LINE Pay create a one-time annual membership for the selected subscription duration.

The checkout endpoint can also save the membership application form. If the button after the form should go straight to payment, send the form fields with this request and redirect to the returned `url`. If the form was already saved with `POST /api/membership-applications`, you may send only `subscriptionId` and `paymentProvider`.

**Common errors**
| Status | Body message | Fix |
|---|---|---|
| 401 | `Missing or invalid credentials` | JWT missing/expired — log in again |
| 400 | `Please complete the membership application form before purchasing` | User skipped the form. Redirect to it. |
| 400 | `subscriptionId required` | You forgot to send it |
| 400 | `Subscription not found or inactive` | Wrong subscriptionId, or subscription was disabled in admin |
| 400 | `Subscription has no price set` | Backend admin needs to set the `Price` on the subscription row |
| 400 | `Subscription has no Stripe price configured` | Backend admin needs to set the `stripePriceId` on the subscription row |
| 400 | `You already have an active membership; use the billing portal to manage it` | Send them to `/api/payments/portal` |

### 4.6 Checkout success / cancel pages

After the user pays (or cancels), Stripe, PayPal, or LINE Pay redirects to:
- Success: `${CLIENT_URL}/membership/success`
- Cancel: `${CLIENT_URL}/membership/cancel`

Build these pages on the frontend. **Don't trust query params from the payment provider to mark the user as a member** — the actual membership activation is driven by backend confirmation. The success page should:

1. Show "thank you, processing..."
2. Poll `GET /api/users/me?populate=memberships` every ~2s up to ~30s
3. As soon as `memberships[0].subscriptionStatus === 'active'`, show success
4. If 30s with no active membership, show "this is taking longer than usual; check email"

### 4.7 `GET /api/users/me?populate=memberships`

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
| `pending_payment` | Created but the payment provider hasn't confirmed yet |
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

### 4.8 `POST /api/payments/portal`

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

Paid courses and webinars can be purchased individually by any logged-in user, including active members, as long as they are not already enrolled or registered:
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

### ✅ 1. Website membership application form
Frontend submits `POST /api/membership-applications`, then verifies it with `GET /api/membership-applications/me` → 200.

### ✅ 2. Form-gated checkout
- Without application → 400 `Please complete the membership application form before purchasing`
- With application → 200 `{ "url": "https://checkout.stripe.com/..." }`

### ✅ 3. Hosted checkout → provider confirmation → membership row
After paying, poll `/users/me?populate=memberships` for `subscriptionStatus === "active"` within ~5s.

### ✅ 4. Membership linked to correct user, correct tier, 1-year window
Verify `accessLevel`, `StartDate`, and `endDate` on the returned membership. Stripe memberships also include `stripeSubscriptionId`.

### ✅ 5. Payment row recorded
Stripe payments store `stripeEventId`; PayPal and LINE Pay payments store `transactionReference`.

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
