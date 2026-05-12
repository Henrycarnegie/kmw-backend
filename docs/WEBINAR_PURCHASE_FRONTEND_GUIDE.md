# Webinar Purchase Flow — Frontend Integration Guide

This is the per-webinar purchase flow for paid webinars. Active members may already have access through membership, but the checkout endpoint still allows them to purchase a paid webinar if they are not already registered.

For the membership flow itself, see `MEMBERSHIP_API_FRONTEND_GUIDE.md`. The course flow lives at `COURSE_PURCHASE_FRONTEND_GUIDE.md` — this is its mirror image, just for webinars.

## 1. When to use this flow

A user reaches the webinar purchase flow when **all** of:

- The webinar has `tier === "lowcost"` or `tier === "premium"`
- The user is logged in
- The user is not already registered for the webinar

Free webinars (`tier === "free"`) require no purchase — allow registration to any logged-in user. *(There's no separate "free registration" endpoint today — talk to backend if you need one.)*

## 2. Access matrix

| User state | `tier=free` | `tier=lowcost` | `tier=premium` |
|---|---|---|---|
| Logged out | ❌ require login | ❌ | ❌ |
| Logged in, no membership | ✅ | 💳 must purchase | 💳 must purchase |
| Active LOW member | ✅ | ✅ | 💳 must purchase |
| Active PREMIUM member | ✅ | ✅ | ✅ |

```ts
function webinarCta(webinar, user, memberships, registrations) {
  if (webinar.tier === 'free') return 'Register';
  if (registrations.some(r => r.webinar?.id === webinar.id && r.state !== 'cancelled')) return 'Registered';
  return `Buy — $${webinar.price}`;
}
```

## 3. Endpoints

### 3.1 `GET /api/webinars?populate=*`

**Auth required** *(verify Authenticated permission)*.

```
GET /api/webinars?filters[scheduled_at][$gt]=2026-05-08T00:00:00.000Z&sort=scheduled_at:asc&populate=thumbnail
```

Each webinar: `id`, `title`, `description`, `tier`, `price`, `scheduled_at`, `meeting_url`, `recording_url`, `thumbnail`, `instructor_information`, `duration_in_minutes`.

> **Important:** `meeting_url` and `recording_url` are sensitive. The backend currently returns them to anyone authenticated. Don't display them to non-registered users — coordinate with backend on a gated `/join` endpoint if you need server-side enforcement.

### 3.2 `POST /api/payments/checkout/webinar`

**Auth required.** One-time Stripe Checkout.

**Request body**
```json
{ "webinarId": 3 }
```

**Success — 200**
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1..." }
```
Redirect to `url`.

**Errors**
| Status | Body message | What to do |
|---|---|---|
| 401 | `Missing or invalid credentials` | Log in |
| 400 | `webinarId required` | You forgot the body field |
| 404 | `Webinar not found` | Wrong id or deleted |
| 400 | `Webinar is free` | Don't show buy for `tier=free` |
| 400 | `Webinar has no price set` | Backend admin issue |
| 400 | `You are already registered for this webinar` | Refresh state |

### 3.3 Stripe redirect targets

- Success: `${CLIENT_URL}/webinars/{webinarId}/success`
- Cancel: `${CLIENT_URL}/webinars/{webinarId}/cancel`

### 3.4 `GET /api/users/me?populate=webinar_registrations,webinar_registrations.webinar`

**Success — 200**
```json
{
  "id": 12,
  "username": "alice",
  "webinar_registrations": [
    {
      "id": 5,
      "state": "confirmed",
      "registered_at": "2026-05-08T16:30:00.000Z",
      "waitlist_position": null,
      "webinar": {
        "id": 3,
        "title": "Mindfulness for K-12 Educators",
        "scheduled_at": "2026-06-12T18:00:00.000Z",
        "tier": "premium"
      }
    }
  ]
}
```

**Registration `state` values**
| state | Meaning |
|---|---|
| `confirmed` | Registered, will get the meeting link |
| `waitlisted` | Webinar at capacity (`waitlist_position` shows slot) |
| `cancelled` | User or admin cancelled |

Poll on the success page every ~2s for up to ~30s.

## 4. Verification checklist

### 4.1 Get a Stripe checkout URL
```
POST /api/payments/checkout/webinar
Authorization: Bearer <JWT>
{ "webinarId": 3 }
```
Expected: 200 with `url`.

### 4.2 Pay
Card `4242 4242 4242 4242`, expiry `12/34`, CVC `123`. Stripe redirects to `${CLIENT_URL}/webinars/3/success`.

### 4.3 Confirm registration landed
```
GET /api/users/me?populate=webinar_registrations,webinar_registrations.webinar
```
Within ~5s, response includes registration for `webinar.id === 3` with `state === 'confirmed'`.

### 4.4 Idempotency
Backend dedupes on `stripeEventId`. Replays don't create duplicate registrations.

### 4.5 Member purchase
LOW and PREMIUM members can purchase paid webinars as long as they are not already registered.

## 5. Errors and recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| User pays, registration shows `waitlisted` | Capacity (currently not enforced backend-side; see section 6) | Coordinate UX with product |
| `meeting_url` is null after registration | Webinar admin hasn't set it, or webinar hasn't started | Show "link available 30 min before start" |
| Past webinars show "register" buttons | No backend guard on past `scheduled_at` | Frontend should hide them |

## 6. Capacity / waitlist behavior

Webinars have `max_capacity` and `waitlist_enabled` fields. The current backend implementation **does not enforce these** — every registration goes through as `state: 'confirmed'` regardless. If you need waitlist UX, coordinate with backend to add the capacity check.

## 7. Test mode

Same Stripe test cards. Webinar checkout is `mode: 'payment'` — one-time charge, no recurring events.

## 8. Open questions

- **Cancellation / refund window**: no auto-handling
- **Reminder emails / calendar invites**: not modeled
- **Recording access for paid registrants only**: `recording_url` currently public-readable; gate it server-side if needed
