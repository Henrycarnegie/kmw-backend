# KMW Frontend API Integration Guide

Complete reference for the frontend team. Covers authentication, membership signup, course/webinar purchases, donations, billing management, and access control.

> **Single source of truth.** This document supersedes the three split guides (`MEMBERSHIP_API_FRONTEND_GUIDE.md`, `COURSE_PURCHASE_FRONTEND_GUIDE.md`, `WEBINAR_PURCHASE_FRONTEND_GUIDE.md`). Those remain in this folder as focused-flow references, but everything is here.

---

## Table of contents

1. [Overview](#1-overview)
2. [Quick start](#2-quick-start)
3. [Authentication](#3-authentication)
4. [The access tier model](#4-the-access-tier-model)
5. [Endpoint reference](#5-endpoint-reference)
   - 5.0 [Frontend API cards](#50-frontend-api-cards)
   - 5.1 [Authentication](#51-authentication-endpoints)
   - 5.2 [Membership application (Google Form)](#52-membership-application)
   - 5.3 [Membership purchase](#53-membership-purchase)
   - 5.4 [Course purchase](#54-course-purchase)
   - 5.5 [Webinar purchase](#55-webinar-purchase)
   - 5.6 [Donations](#56-donations)
   - 5.7 [Billing Portal (manage subscription)](#57-billing-portal)
   - 5.8 [User & content listing](#58-user--content-listing)
6. [Complete user journey](#6-complete-user-journey)
7. [Recommended frontend state machine](#7-recommended-frontend-state-machine)
8. [Error reference](#8-error-reference)
9. [Testing in dev mode](#9-testing-in-dev-mode)
10. [Going to production](#10-going-to-production)
11. [Known gaps & open questions](#11-known-gaps--open-questions)

---

## 1. Overview

The KMW platform sells:

- **Annual memberships** (recurring subscription, two tiers: low fee $80/yr or premium $100/yr) — gated by a required Google Form application
- **Individual courses** (one-time purchase per course)
- **Individual webinars** (one-time purchase per webinar)
- **Donations** (one-time amount chosen by the donor; public flow, no signup or login required)

All purchases use **Stripe-hosted Checkout** — the user is redirected to a Stripe page, pays, and is redirected back. The frontend never handles card details directly.

**Key architectural points:**

- Backend: **Strapi 5** running on port 1337
- Database: **PostgreSQL**
- Payments: **Stripe** (one Stripe account, test mode in dev)
- Membership signup is **form-gated**: every prospective member fills a Google Form, the form data is server-to-server delivered to the backend by a Google Apps Script trigger, then the user can pay
- Membership activation is **automatic** — the moment Stripe confirms payment, a webhook fires and creates the membership row marked `active`

---

## 2. Quick start

The endpoints you'll use most:

| Purpose | Method | Path | Auth |
|---|---|---|---|
| Register | POST | `/api/auth/local/register` | none |
| Log in | POST | `/api/auth/local` | none |
| Check application status | GET | `/api/membership-applications/me` | JWT |
| List subscription plans | GET | `/api/subscrition-plans?filters[active][$eq]=true` | JWT |
| Buy membership | POST | `/api/payments/checkout/membership` | JWT |
| Buy course | POST | `/api/payments/checkout/course` | JWT |
| Buy webinar | POST | `/api/payments/checkout/webinar` | JWT |
| Donate | POST | `/api/payments/checkout/donation` | none; public visitor-safe endpoint |
| Manage subscription | POST | `/api/payments/portal` | JWT |
| Get user + memberships + enrollments | GET | `/api/users/me?populate=...` | JWT |

Base URL: `http://localhost:1337` (dev) — production TBD.

All hosted checkout responses return `{ url, id, provider }`. **Always redirect with `window.location.href`** — do not embed hosted payment pages in an iframe.

Supported payment providers:

| Provider | Send as | Supported flows |
|---|---|---|
| Stripe | omit `paymentProvider` or send `"stripe"` | Membership, courses, webinars, donations, billing portal |
| PayPal | `"paypal"` | One-time course, webinar, and donation payments |
| LINE Pay | `"line_pay"` or `"linepay"` | One-time course, webinar, and donation payments |

Membership subscriptions and the billing portal are Stripe-only for now because they depend on Stripe subscriptions and Stripe's customer portal.

---

## 3. Authentication

### Token format
JWTs from Strapi's users-permissions plugin. Default 30-day expiry. Send as:
```
Authorization: Bearer <jwt>
```

### Where to store the JWT
Use whichever your team standardizes on (httpOnly cookie if you have a session-server proxy in front, otherwise `localStorage` works for SPA). Refresh on login or registration response.

### Reading the current user
```
GET /api/users/me
Authorization: Bearer <jwt>
```
Returns `{ id, username, email, ... }`. Use `?populate=memberships,enrollments,webinar_registrations` to get their relationships in one call.

---

## 4. The access tier model

This table drives every "can this user see/play this content?" decision in the UI.

| User state | `tier=free` | `tier=lowcost` | `tier=premium` |
|---|---|---|---|
| Logged out visitor | ❌ require login | 🔐 sign up/log in, then purchase individually | 🔐 sign up/log in, then purchase individually |
| Logged in, no membership | ✅ | 💳 must purchase individually | 💳 must purchase individually |
| Active **LOW** member | ✅ | ✅ | 💳 must purchase individually |
| Active **PREMIUM** member | ✅ | ✅ | ✅ |

Course access rules in plain language:

- **Low-cost members** automatically get low-cost courses, but they must buy premium courses individually before they can access them.
- **Visitors and logged-in non-members** do not get low-cost or premium courses through membership access. They must purchase each low-cost or premium course individually. Because course checkout requires a JWT, logged-out visitors should be prompted to sign up or log in before checkout.
- **Premium members** automatically get both low-cost and premium courses.

Helper:

```ts
type AccessLevel = 'free_user' | 'low' | 'premium';
type Tier = 'free' | 'lowcost' | 'premium';

function membershipCovers(level: AccessLevel | undefined, tier: Tier): boolean {
  if (tier === 'free') return true;
  if (!level) return false;
  if (level === 'premium') return true;
  if (level === 'low' && tier === 'lowcost') return true;
  return false;
}

function activeMembership(memberships) {
  return memberships?.find(m =>
    (m.subscriptionStatus === 'active' || m.subscriptionStatus === 'past_due')
    && new Date(m.endDate) > new Date()
  );
}
```

**Backend enforces this rule for *purchases*** (you can't buy what you already have access to) but **does NOT yet enforce it for content delivery** — the frontend is currently the gate. A direct API call could read locked content. See section 11.

---

## 5. Endpoint reference

### 5.0 Frontend API cards

Use these cards as the implementation checklist. Each API includes: API name, method, authentication, middleware, response status, response JSON, example picture, and example usage.

#### API: Register account

| Field | Value |
|---|---|
| API name | Register account |
| Method | `POST /api/auth/local/register` |
| Authentication | None |
| Middleware | Strapi Users & Permissions plugin; no custom project middleware |
| Response status | `200` success, `400` validation/duplicate account |
| Response JSON | `{ "jwt": "...", "user": { "id": 12, "username": "alice", "email": "alice@example.com" } }` |

Example picture:
```text
Register form -> POST /api/auth/local/register -> Save JWT -> Logged-in app
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/auth/local/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, email, password }),
});
const data = await res.json();
localStorage.setItem('jwt', data.jwt);
```

#### API: Login

| Field | Value |
|---|---|
| API name | Login |
| Method | `POST /api/auth/local` |
| Authentication | None |
| Middleware | Strapi Users & Permissions plugin; no custom project middleware |
| Response status | `200` success, `400` invalid credentials |
| Response JSON | `{ "jwt": "...", "user": { "id": 12, "username": "alice", "email": "alice@example.com" } }` |

Example picture:
```text
Login form -> POST /api/auth/local -> Save JWT -> Logged-in app
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/auth/local`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: emailOrUsername, password }),
});
const data = await res.json();
localStorage.setItem('jwt', data.jwt);
```

#### API: Current user

| Field | Value |
|---|---|
| API name | Current user |
| Method | `GET /api/users/me?populate=memberships,enrollments,enrollments.course,webinar_registrations,webinar_registrations.webinar` |
| Authentication | JWT required |
| Middleware | Strapi Users & Permissions JWT auth; no custom project middleware |
| Response status | `200` success, `401` missing/invalid JWT |
| Response JSON | `{ "id": 12, "username": "alice", "email": "alice@example.com", "memberships": [], "enrollments": [], "webinar_registrations": [] }` |

Example picture:
```text
App loads -> GET /api/users/me?populate=... -> Render member/course/webinar state
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/users/me?populate=memberships,enrollments,enrollments.course,webinar_registrations,webinar_registrations.webinar`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const user = await res.json();
```

#### API: Membership application status

| Field | Value |
|---|---|
| API name | Membership application status |
| Method | `GET /api/membership-applications/me` |
| Authentication | JWT required |
| Middleware | Strapi Users & Permissions JWT auth; custom route has no extra middleware |
| Response status | `200` application exists, `401` missing/invalid JWT, `404` no application on file |
| Response JSON | `{ "id": 4, "email": "alice@example.com", "fullName": "Alice Wong", "submittedAt": "2026-05-08T15:46:56.000Z" }` |

Example picture:
```text
User submits Google Form -> Apps Script saves application -> Frontend polls /me -> Show plan picker
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/membership-applications/me`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
if (res.status === 404) showGoogleFormButton();
if (res.ok) showPlanPicker(await res.json());
```

#### API: List subscription plans

| Field | Value |
|---|---|
| API name | List subscription plans |
| Method | `GET /api/subscrition-plans?filters[active][$eq]=true&sort=Price:asc` |
| Authentication | JWT required |
| Middleware | Strapi Users & Permissions JWT auth; no custom project middleware |
| Response status | `200` success, `401` missing/invalid JWT |
| Response JSON | `{ "data": [{ "id": 1, "Name": "Low Fee Annual", "accessLevel": "LOW", "Price": 80, "Duration": 365 }] }` |

Example picture:
```text
Application approved -> GET active plans -> User selects LOW or PREMIUM -> Checkout
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/subscrition-plans?filters[active][$eq]=true&sort=Price:asc`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const plans = await res.json();
```

#### API: Membership checkout

| Field | Value |
|---|---|
| API name | Membership checkout |
| Method | `POST /api/payments/checkout/membership` |
| Authentication | JWT required |
| Middleware | Custom payment route; `policies: []`, `middlewares: []`; Strapi JWT auth applies |
| Response status | `200` checkout created, `400` business rule/config error, `401` missing/invalid JWT |
| Response JSON | `{ "url": "https://checkout.stripe.com/c/pay/...", "id": "cs_test_a1...", "provider": "stripe" }` |

Example picture:
```text
Plan picker -> POST membership checkout -> Stripe Checkout -> /membership/success -> Poll /users/me
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/payments/checkout/membership`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify({ planId }),
});
const checkout = await res.json();
window.location.href = checkout.url;
```

#### API: Course checkout

| Field | Value |
|---|---|
| API name | Course checkout |
| Method | `POST /api/payments/checkout/course` |
| Authentication | JWT required |
| Middleware | Custom payment route; `policies: []`, `middlewares: []`; Strapi JWT auth applies |
| Response status | `200` checkout created, `400` business rule/config error, `401` missing/invalid JWT, `404` course not found |
| Response JSON | `{ "url": "https://checkout-provider.example/...", "id": "payment_id", "provider": "stripe" }` |

Example picture:
```text
Course card -> Access check -> POST course checkout -> Hosted payment -> /courses/:id/success
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/payments/checkout/course`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify({ courseId, paymentProvider: 'paypal' }),
});
const checkout = await res.json();
window.location.href = checkout.url;
```

#### API: Webinar checkout

| Field | Value |
|---|---|
| API name | Webinar checkout |
| Method | `POST /api/payments/checkout/webinar` |
| Authentication | JWT required |
| Middleware | Custom payment route; `policies: []`, `middlewares: []`; Strapi JWT auth applies |
| Response status | `200` checkout created, `400` business rule/config error, `401` missing/invalid JWT, `404` webinar not found |
| Response JSON | `{ "url": "https://checkout-provider.example/...", "id": "payment_id", "provider": "line_pay" }` |

Example picture:
```text
Webinar card -> Access check -> POST webinar checkout -> Hosted payment -> /webinars/:id/success
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/payments/checkout/webinar`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`,
  },
  body: JSON.stringify({ webinarId, paymentProvider: 'line_pay' }),
});
const checkout = await res.json();
window.location.href = checkout.url;
```

#### API: Donation checkout

| Field | Value |
|---|---|
| API name | Donation checkout |
| Method | `POST /api/payments/checkout/donation` |
| Authentication | None; public visitor-safe endpoint |
| Middleware | Custom payment route; `auth: false`, `policies: []`, `middlewares: []` |
| Response status | `200` checkout created, `400` validation/provider error |
| Response JSON | `{ "url": "https://checkout-provider.example/...", "id": "payment_id", "provider": "stripe" }` |

Example picture:
```text
Donate form -> POST donation checkout -> Hosted payment -> /donate/success
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/payments/checkout/donation`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: 25,
    paymentProvider: 'stripe',
    donorName,
    donorEmail,
    donorMessage,
  }),
});
const checkout = await res.json();
window.location.href = checkout.url;
```

#### API: Billing portal

| Field | Value |
|---|---|
| API name | Billing portal |
| Method | `POST /api/payments/portal` |
| Authentication | JWT required |
| Middleware | Custom payment route; `policies: []`, `middlewares: []`; Strapi JWT auth applies |
| Response status | `200` portal created, `400` no Stripe customer, `401` missing/invalid JWT |
| Response JSON | `{ "url": "https://billing.stripe.com/p/session/test_..." }` |

Example picture:
```text
Account page -> POST billing portal -> Stripe portal -> Return to /account
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/payments/portal`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
});
const portal = await res.json();
window.location.href = portal.url;
```

#### API: Course catalog

| Field | Value |
|---|---|
| API name | Course catalog |
| Method | `GET /api/courses?populate=*&filters[is_published][$eq]=true&sort=title:asc` |
| Authentication | JWT recommended; permission depends on Strapi role settings |
| Middleware | Strapi REST API permissions; no custom project middleware |
| Response status | `200` success, `401/403` if role permissions block access |
| Response JSON | `{ "data": [{ "id": 7, "title": "Intro Course", "tier": "lowcost", "price": 25 }] }` |

Example picture:
```text
Course page -> GET course catalog -> Apply access matrix -> Render Open or Buy button
```

Example how to use:
```ts
const res = await fetch(`${API_URL}/api/courses?populate=*&filters[is_published][$eq]=true&sort=title:asc`, {
  headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
});
const courses = await res.json();
```

#### API: Webinar catalog

| Field | Value |
|---|---|
| API name | Webinar catalog |
| Method | `GET /api/webinars?populate=*&filters[scheduled_at][$gt]=<isoDate>&sort=scheduled_at:asc` |
| Authentication | JWT recommended; permission depends on Strapi role settings |
| Middleware | Strapi REST API permissions; no custom project middleware |
| Response status | `200` success, `401/403` if role permissions block access |
| Response JSON | `{ "data": [{ "id": 3, "title": "Live Webinar", "tier": "premium", "price": 40, "scheduled_at": "2026-06-01T10:00:00.000Z" }] }` |

Example picture:
```text
Webinars page -> GET upcoming webinars -> Apply access/registration state -> Render Open or Buy button
```

Example how to use:
```ts
const now = new Date().toISOString();
const res = await fetch(`${API_URL}/api/webinars?populate=*&filters[scheduled_at][$gt]=${encodeURIComponent(now)}&sort=scheduled_at:asc`, {
  headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
});
const webinars = await res.json();
```

#### API: PayPal capture callback

| Field | Value |
|---|---|
| API name | PayPal capture callback |
| Method | `GET /api/payments/paypal/capture?token=<paypalOrderId>` |
| Authentication | None; called by PayPal redirect after payer approval |
| Middleware | Custom payment route; `auth: false`, `policies: []`, `middlewares: []` |
| Response status | `302` redirect to frontend success page, `400/404/500` on payment/capture error |
| Response JSON | Usually none; this route redirects the browser |

Example picture:
```text
PayPal approval -> GET backend callback -> Capture order -> Grant access -> Frontend success page
```

Example how to use:
```ts
// Frontend does not call this directly.
// Use the checkout.url returned by /api/payments/checkout/course,
// /api/payments/checkout/webinar, or /api/payments/checkout/donation.
window.location.href = checkout.url;
```

#### API: LINE Pay confirm callback

| Field | Value |
|---|---|
| API name | LINE Pay confirm callback |
| Method | `GET /api/payments/line-pay/confirm?transactionId=<linePayTransactionId>` |
| Authentication | None; called by LINE Pay redirect after payer approval |
| Middleware | Custom payment route; `auth: false`, `policies: []`, `middlewares: []` |
| Response status | `302` redirect to frontend success page, `400/404/500` on payment/confirm error |
| Response JSON | Usually none; this route redirects the browser |

Example picture:
```text
LINE Pay approval -> GET backend callback -> Confirm transaction -> Grant access -> Frontend success page
```

Example how to use:
```ts
// Frontend does not call this directly.
// Use the checkout.url returned by /api/payments/checkout/course,
// /api/payments/checkout/webinar, or /api/payments/checkout/donation.
window.location.href = checkout.url;
```

#### API: Stripe webhook

| Field | Value |
|---|---|
| API name | Stripe webhook |
| Method | `POST /api/payments/webhook` |
| Authentication | Stripe signature header, not JWT |
| Middleware | Custom payment route; `auth: false`, `policies: []`, `middlewares: []`; Stripe signature verification in controller |
| Response status | `200` received, `400` missing/invalid Stripe signature |
| Response JSON | `{ "received": true }` or `{ "received": true, "duplicate": true }` |

Example picture:
```text
Stripe event -> POST /api/payments/webhook -> Backend creates membership/enrollment/payment
```

Example how to use:
```ts
// Frontend does not call this route.
// Local backend testing uses:
// stripe listen --forward-to localhost:1337/api/payments/webhook
```

---

### 5.1 Authentication endpoints

#### `POST /api/auth/local/register`
Create a new account.
```json
// Request
{ "username": "alice", "email": "alice@example.com", "password": "min6chars" }

// 200
{
  "jwt": "eyJ...",
  "user": { "id": 12, "username": "alice", "email": "alice@example.com", ... }
}
```
Errors: 400 `Email or Username are already taken`, 400 `password must be longer than 5 characters`.

#### `POST /api/auth/local`
Log in.
```json
// Request
{ "identifier": "alice@example.com", "password": "..." }   // identifier = email or username
```
Same response shape as register. Error: 400 `Invalid identifier or password`.

---

### 5.2 Membership application

This is the Google Form intake. **The frontend never POSTs the application** — Apps Script does that server-to-server. The frontend's job: redirect users to the form and check whether their application is on file.

#### Google Form link
`https://forms.gle/EY6e6YU4tx1ab5Vo8`

The form auto-collects the user's Google email. Tell users to **either** sign in to the same Google account whose email matches their platform account, **or** type their platform email manually if a separate field is exposed.

#### `GET /api/membership-applications/me`
Check whether the logged-in user's application has landed.
```
Authorization: Bearer <jwt>
```
**200** — application exists:
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
**404** — no application yet:
```json
{ "data": null, "error": { "status": 404, "name": "NotFoundError", "message": "No application on file" } }
```

**Use this to** decide whether to show the form CTA or the plan picker. Poll every 5–10s while the user has the form tab open — Apps Script delivery has a few-second lag.

---

### 5.3 Membership purchase

#### `GET /api/subscrition-plans?filters[active][$eq]=true&sort=Price:asc`
List plans dynamically (don't hardcode IDs — they may differ per environment).
```
Authorization: Bearer <jwt>
```
Returns array of plans, each with `id`, `Name`, `accessLevel` (`LOW`/`PREMIUM`), `Price`, `Duration`, `discountPercentage`. *(Note: field names start with capitals — `Name`, `Price`, `Duration` — that's a Strapi quirk.)*

#### `POST /api/payments/checkout/membership`
Initiate a subscription Checkout.
```json
// Request
{ "planId": 1 }
```
**200**
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1..." }
```
**Redirect:** `window.location.href = response.url`.

**Errors** (most common):
| Status | Message | What happened |
|---|---|---|
| 401 | `Missing or invalid credentials` | JWT missing/expired |
| 400 | `planId required` | You forgot the body field |
| 400 | `Plan not found or inactive` | Wrong id or plan disabled |
| 400 | `Plan has no Stripe price configured` | Backend admin hasn't wired Stripe IDs |
| 400 | `Please complete the membership application form before purchasing` | User skipped the form. Redirect to it. |
| 400 | `You already have an active membership; use the billing portal to manage it` | Send them to `/api/payments/portal` |

#### Stripe redirect targets
After payment, Stripe sends user back to:
- Success: `${CLIENT_URL}/membership/success`
- Cancel: `${CLIENT_URL}/membership/cancel`

Build both pages. The success page **must poll** for membership confirmation (next section).

#### Polling for membership activation
After redirect, the webhook is async (~2-5s typically, can be longer). On the success page:

```ts
async function pollForMembership(maxAttempts = 15, delayMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch('/api/users/me?populate=memberships', {
      headers: { Authorization: `Bearer ${jwt}` }
    });
    const data = await res.json();
    const m = activeMembership(data.memberships);
    if (m) return m;   // success — show "you're in!"
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;   // timeout — show "this is taking a while, check email"
}
```

---

### 5.4 Course purchase

For courses where `tier === 'lowcost'` or `tier === 'premium'` and the user's membership doesn't already cover them.

- A **LOW** member must purchase a `premium` course individually.
- A logged-in **non-member/visitor account** must purchase both `lowcost` and `premium` courses individually.
- A logged-out visitor must sign up or log in first, then purchase the course; this endpoint requires a JWT.

#### `POST /api/payments/checkout/course`
```json
// Request
{ "courseId": 7, "paymentProvider": "stripe" }

// 200
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1...", "provider": "stripe" }
```
Omit `paymentProvider` to use Stripe. Send `"paypal"` or `"line_pay"` to redirect through those hosted checkout flows instead. PayPal and LINE Pay callbacks are handled by the backend, then redirect back to the same `/courses/{courseId}/success` page.

**Errors:**
| Status | Message |
|---|---|
| 401 | `Missing or invalid credentials` |
| 400 | `Unsupported payment provider` |
| 400 | `courseId required` |
| 404 | `Course not found` |
| 400 | `Course is free` *(don't show buy button for free tier)* |
| 400 | `Course has no price set` *(backend data issue)* |
| 400 | `Your membership already covers this course` |
| 400 | `You are already enrolled in this course` |

**Redirect targets:** `${CLIENT_URL}/courses/{courseId}/success` and `/cancel`.

**Verify after payment:**
```
GET /api/users/me?populate=enrollments,enrollments.course
Authorization: Bearer <jwt>
```
Look for `enrollments[].course.id === <courseId>`.

---

### 5.5 Webinar purchase

Mirror of course purchase. Supports the same `paymentProvider` values: omit/`stripe`, `paypal`, or `line_pay`.

#### `POST /api/payments/checkout/webinar`
```json
// Request
{ "webinarId": 3 }

// 200
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1..." }
```
**Errors** — identical to course, swap `course` for `webinar`.

**Stripe redirect targets:** `${CLIENT_URL}/webinars/{webinarId}/success` and `/cancel`.

**Verify after payment:**
```
GET /api/users/me?populate=webinar_registrations,webinar_registrations.webinar
Authorization: Bearer <jwt>
```
Look for `webinar_registrations[].webinar.id === <webinarId>` with `state === 'confirmed'`.

**Webinar registration `state` values:**
| state | Meaning |
|---|---|
| `confirmed` | Registered, will receive meeting link |
| `waitlisted` | Webinar at capacity, in queue (`waitlist_position` is the slot) |
| `cancelled` | User or admin cancelled |

---

### 5.6 Donations

For one-time donations to support the Social Emotional Learning platform. Donations use Stripe-hosted Checkout and are a **public visitor flow**: anyone can donate, including non-members, members, logged-out visitors, and people who have never signed up for the website.

#### `POST /api/payments/checkout/donation`
```json
// Request
{
  "amount": 25,
  "paymentProvider": "stripe",
  "donorName": "Alice Wong",
  "donorEmail": "alice@example.com",
  "donorMessage": "Happy to support this work."
}

// 200
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1...", "provider": "stripe" }
```

Only `amount` is required. Minimum amount is `$1.00`. Omit `paymentProvider` to use Stripe, or send `"paypal"` / `"line_pay"` for those hosted checkout flows. The optional donor fields are stored on the payment record after the payment provider confirms the payment. Do not require a JWT, account, membership, signup step, or logged-in session before showing the donation form or calling this endpoint.

**Redirect targets:** `${CLIENT_URL}/donate/success` and `/donate/cancel`.

**Errors:**
| Status | Message |
|---|---|
| 400 | `amount required` |
| 400 | `Donation amount must be at least $1.00` |
| 400 | `donorEmail must be a valid email address` |
| 400 | `Unsupported payment provider` |

The success page does not need to grant access or poll for a membership. Show a thank-you state after redirect; the backend records the donation when Stripe, PayPal, or LINE Pay confirms the payment.

---

### 5.7 Billing Portal

For active members to update their card, view invoices, or cancel.

#### `POST /api/payments/portal`
```
Authorization: Bearer <jwt>
```
**200**
```json
{ "url": "https://billing.stripe.com/p/session/test_..." }
```
Redirect to it. The portal is hosted by Stripe.

**Errors:** 400 `No Stripe customer found for this user` — only show this button to active members.

When the user cancels in the portal, Stripe fires `customer.subscription.deleted` to the backend, which sets `subscriptionStatus='cancelled'`. The user **keeps access until `endDate`** — show the membership as "active until X" until that date passes.

---

### 5.8 User & content listing

#### `GET /api/users/me?populate=memberships,enrollments,enrollments.course,webinar_registrations,webinar_registrations.webinar`
The Swiss army knife — one call returns everything you need to render any user-state-dependent UI.

**Subscription status values you'll see:**
| `subscriptionStatus` | Meaning | UI treatment |
|---|---|---|
| `pending_payment` | Created but not yet confirmed (rare) | Show "processing..." |
| `active` | Currently paying member | Grant access |
| `past_due` | Renewal payment failed, Stripe is retrying | Keep access, prompt to update card |
| `cancelled` | Cancelled in portal | Keep access until `endDate`, then deny |
| `expired` | Past `endDate` (set by future cron job) | Deny access |
| `inactive` | Should not occur in normal flows | Deny access |

#### `GET /api/courses?populate=*&filters[is_published][$eq]=true&sort=title:asc`
Course catalog. Returns array of courses with `id`, `title`, `description`, `tier`, `price`, `thumbnail`, `instructor_information`, etc.

#### `GET /api/webinars?populate=*&filters[scheduled_at][$gt]=2026-05-08T00:00:00.000Z&sort=scheduled_at:asc`
Webinar catalog (filter to upcoming).

> **Heads up:** the default API returns webinar `meeting_url` and `recording_url` to anyone who can read the webinar — i.e., currently any authenticated user, regardless of registration. The frontend should not display these URLs unless the user has either an active membership covering the tier OR a confirmed registration. Until the backend adds proper gating (see section 11), this is a frontend-enforced rule.

---

## 6. Complete user journey

The full happy path from first visit to active member to course access:

```
   Visitor lands on /
        │
        ▼ (clicks "Sign up")
   POST /api/auth/local/register  ───────────► JWT
        │
        ▼
   Frontend redirects to Google Form (or opens new tab)
        │
        ▼ (user fills, submits)
   Apps Script POSTs to backend (server-to-server, ~2-5s)
        │
        ▼
   Frontend polls GET /api/membership-applications/me every 5-10s
        │
        ▼ (200 once application lands)
   Show plan picker:
     GET /api/subscrition-plans?filters[active][$eq]=true
        │
        ▼ (user picks plan)
   POST /api/payments/checkout/membership { planId }
        │
        ▼ (200 returns url)
   window.location.href = url  ─────────────► Stripe-hosted checkout
                                                  │
                                                  ▼ (user pays with 4242...)
                                            Stripe redirects to:
                                            ${CLIENT_URL}/membership/success
        │
        ▼
   Success page polls GET /api/users/me?populate=memberships
        │
        ▼ (active membership appears within ~5s)
   Show "Welcome, you're a [low/premium] member!"
        │
        ▼ (user browses courses)
   GET /api/courses?populate=*
        │
        ▼ (for each course, run access matrix)
   Render: "Open" / "Buy $X" / "Member-only — upgrade"
        │
        ▼ (user clicks Open)
   Navigate to /courses/{id}
        │
        ▼ (later, user wants to cancel)
   POST /api/payments/portal  ─────────────► Stripe Billing Portal
                                                  │
                                                  ▼ (cancel)
                                            subscriptionStatus → cancelled
                                            (access continues until endDate)
```

---

## 7. Recommended frontend state machine

For the membership-signup page specifically:

```
NOT_LOGGED_IN
    │ (login/register)
    ▼
LOGGED_IN_NO_APPLICATION
    │ (link to Google Form, then poll /me)
    │ ─── 404 (still no application) ──┐
    │                                  ▼
    │                          (poll every 10s)
    │
    │ ─── 200 (application landed) ───────────┐
    │                                         ▼
    │                                READY_TO_PAY
    │                                         │ (user picks plan, clicks buy)
    │                                         ▼
    │                                  POST /checkout/membership
    │                                         │ (200, redirect)
    │                                         ▼
    │                                  PAYING (on Stripe)
    │                                         │ (user pays)
    │                                         ▼
    │                                  POLLING_FOR_MEMBERSHIP
    │                                         │ (poll every 2s, max 30s)
    │                                         │
    │ ◀──── membership active ──────── MEMBER
```

For course/webinar purchase pages, it's simpler (no form gate):

```
LOGGED_IN
    │ (user clicks Buy)
    ▼
CHECKING_OUT (POST /checkout/{course|webinar})
    │ (200 with url)
    ▼
PAYING (on Stripe)
    │
    ▼
POLLING_FOR_ENROLLMENT_OR_REGISTRATION
    │
    ▼
ENROLLED / REGISTERED
```

---

## 8. Error reference

Common errors and how to handle them. All Strapi errors look like:
```json
{ "data": null, "error": { "status": 400, "name": "BadRequestError", "message": "...", "details": {} } }
```

| HTTP | Error name | When | Frontend response |
|---|---|---|---|
| 400 | BadRequestError | Validation, business rule | Show the `error.message` to user |
| 401 | UnauthorizedError | Missing/invalid JWT | Redirect to login |
| 403 | ForbiddenError | Authenticated but lacks permission | Show "you don't have access" |
| 404 | NotFoundError | Resource doesn't exist or `me` has no record | Handle per endpoint (e.g., 404 on `/me` for application = "no application yet") |
| 500 | InternalServerError | Backend bug or external service down | Generic "something went wrong, try again" |

**Stripe-specific:**
- A 500 from a checkout endpoint usually means a Stripe API problem. The error message will surface Stripe's reply (e.g., "No such price: price_xxx"). These are backend-data issues, not user issues.
- A 400 with the message `Webhook signature failed:...` is a backend-config problem — you'll never see this on the frontend.

**PayPal / LINE Pay-specific:**
- A 500 from a PayPal or LINE Pay checkout endpoint usually means provider credentials or callback URLs are misconfigured.
- PayPal and LINE Pay one-time payments are finalized by backend callback routes, then redirected to the frontend success URL.

---

## 9. Testing in dev mode

### Test cards
| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Always succeeds |
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0025 0000 3155` | Triggers 3D Secure auth |

For all test cards: any future expiry (e.g., `12/34`), any 3-digit CVC (e.g., `123`), any name, any postal code.

### Backend prerequisites for local testing
The backend team must have these running:
1. Strapi: `npm run develop` from `kmw-backend/`
2. Stripe webhook forwarder: `stripe listen --forward-to localhost:1337/api/payments/webhook`

Without #2, payments succeed on Stripe's side but the membership/enrollment row is never created — the success page would poll forever. If your testing breaks at the polling step, this is the most likely cause.

### Test the form intake without using Google
There's a helper script for backend devs: `kmw-backend/scripts/test-membership-flow.sh` — registers a fresh user, simulates a form submission with HMAC, calls `/me`, and produces a Stripe checkout URL ready to pay. Useful for end-to-end demos.

---

## 10. Going to production

When ready to take real payments:

1. Stripe Dashboard → Activate account (business info, Taiwan KYC, bank account)
2. Stripe Dashboard → recreate the two **Products** (Low Fee Annual, Premium Annual) and the **RENEW20** coupon in **live mode** (test/live data is separate)
3. Stripe Dashboard → Developers → Webhooks → Add endpoint pointing at your production backend `https://your-domain.com/api/payments/webhook`. Subscribe to: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`. Copy the new signing secret.
4. Backend updates `.env` (production) with:
   - `STRIPE_SECRET_KEY=sk_live_...` (from Stripe Dashboard → Developers → API keys)
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (from step 3)
   - `CLIENT_URL=https://your-frontend-domain.com`
   - `PAYMENT_CALLBACK_URL=https://your-backend-domain.com`
   - `PAYMENT_CURRENCY=USD` or the production settlement currency
   - `PAYPAL_MODE=live`
   - `PAYPAL_CLIENT_ID=...`
   - `PAYPAL_CLIENT_SECRET=...`
   - `LINE_PAY_MODE=live`
   - `LINE_PAY_CHANNEL_ID=...`
   - `LINE_PAY_CHANNEL_SECRET=...`
   - `LINE_PAY_CURRENCY=USD` or a LINE Pay-supported currency for your channel
5. Backend updates the `subscrition_plans` rows in production DB with the live `stripePriceId` values
6. Frontend updates the API base URL to your production backend
7. Test the full flow with real cards/accounts. Stripe test cards only work in Stripe test mode; PayPal and LINE Pay should be tested first against their sandbox environments.

**Stripe takes ~3–4% of each transaction (varies by card type and country) before depositing the rest into the configured bank account on a rolling 2–7 day schedule.**

---

## 11. Known gaps & open questions

These are intentional gaps in the current implementation. The frontend should be aware so you don't waste cycles trying to handle them or hit them as bugs.

### Backend doesn't yet enforce content access
- A logged-in non-member can `GET /api/courses/:id` and read premium course content directly via the API
- A logged-in non-registered user can `GET /api/webinars/:id` and read `meeting_url` (the join link!)
- The Gemini quiz endpoint at `POST /api/modules/:id/generate-quiz` is open to any logged-in user — burns AI quota
- **Frontend is currently the access gate.** Use the access matrix in section 4 to filter what you display. A future Phase 3 will move this to the backend.

### Webinar capacity / waitlist not enforced
- Every webinar registration is created as `state: 'confirmed'`, regardless of `max_capacity`
- The `waitlist_enabled` flag and `waitlist_position` field are aspirational — backend doesn't compute them
- If/when this matters for product, backend needs work

### Refunds / cancellations
- Refunds are manual (Stripe Dashboard) — no automatic flow
- A refunded course leaves the enrollment row in place
- A user can't self-cancel a webinar registration today

### Past-dated webinars
- Backend doesn't prevent registration for webinars with `scheduled_at` in the past
- Frontend should hide them or disable the buy button

### Membership upgrades / downgrades
- No endpoint to switch from LOW to PREMIUM mid-cycle
- A user has to cancel + re-subscribe (with a coverage gap, unless they time it carefully)
- If product wants seamless upgrades, this is backend work

### Email notifications
- No automated emails for: membership confirmation, renewal reminder, payment failure, cancellation, webinar reminder, course completion
- Stripe sends payment receipts automatically (configurable in Dashboard)
- Anything else needs to be added

### Email confirmation on registration
- Currently disabled — accounts are auto-confirmed (`confirmed: true`) on register
- If product wants email verification, backend needs to enable it in Strapi admin → Settings → Users & Permissions → Advanced Settings

---

## Appendix: useful Strapi query syntax

For filtering and populating responses:

| Want | Query |
|---|---|
| Active plans only | `?filters[active][$eq]=true` |
| Upcoming webinars | `?filters[scheduled_at][$gt]=2026-05-08T00:00:00.000Z` |
| Sort by date asc | `?sort=scheduled_at:asc` |
| Multiple sort | `?sort[0]=scheduled_at:asc&sort[1]=title:asc` |
| Populate one relation | `?populate=memberships` |
| Populate nested | `?populate=enrollments.course` |
| Populate everything | `?populate=*` *(careful — can be heavy)* |
| Pagination | `?pagination[page]=2&pagination[pageSize]=20` |
| Search | `?filters[title][$containsi]=intro` *(case-insensitive contains)* |

Full reference: https://docs.strapi.io/dev-docs/api/rest

---

**Questions about this document or anything unclear:** ping the backend channel.
