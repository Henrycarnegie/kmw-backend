# Course Purchase Flow — Frontend Integration Guide

This is the per-course purchase flow for users who **don't have membership coverage** for a given course. Membership-covered users get free access — they should never see a "buy" button for those courses (see access matrix below).

For the membership flow itself, see `MEMBERSHIP_API_FRONTEND_GUIDE.md` in the same folder.

## 1. When to use this flow

A user reaches the course purchase flow when **all** of:

- The course has `tier === "lowcost"` or `tier === "premium"`
- The user is logged in
- The user does **not** have an active membership covering that tier
- The user is not already enrolled

Free courses (`tier === "free"`) require no purchase — show content to any logged-in user.

## 2. Access matrix

| User state | `tier=free` | `tier=lowcost` | `tier=premium` |
|---|---|---|---|
| Logged out | ❌ require login | ❌ | ❌ |
| Logged in, no membership | ✅ | 💳 must purchase | 💳 must purchase |
| Active LOW member | ✅ | ✅ | 💳 must purchase |
| Active PREMIUM member | ✅ | ✅ | ✅ |

Use this for the button label on each course card:

```ts
function courseCta(course, user, memberships, enrollments) {
  if (course.tier === 'free') return 'Open';
  if (enrollments.some(e => e.course?.id === course.id)) return 'Open';
  const m = activeMembership(memberships);
  if (m?.accessLevel === 'premium') return 'Open';
  if (m?.accessLevel === 'low' && course.tier === 'lowcost') return 'Open';
  return `Buy — $${course.price}`;
}
```

## 3. Endpoints

### 3.1 `GET /api/courses?populate=*`

**Auth required** *(verify the Authenticated permission for course.find — coordinate with backend)*. Returns the course catalog.

```
GET /api/courses?filters[is_published][$eq]=true&sort=title:asc&populate=thumbnail
```

Each course has `id`, `title`, `description`, `tier`, `price`, `thumbnail`, plus relations.

### 3.2 `POST /api/payments/checkout/course`

**Auth required.** One-time Stripe Checkout for a single course.

**Request body**
```json
{ "courseId": 7 }
```

**Success — 200**
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1...", "id": "cs_test_a1..." }
```
**Redirect the user to `url`.**

**Errors**
| Status | Body message | What to do |
|---|---|---|
| 401 | `Missing or invalid credentials` | Log in |
| 400 | `courseId required` | You forgot the body field |
| 404 | `Course not found` | Wrong id or deleted |
| 400 | `Course is free` | Don't show buy for `tier=free` |
| 400 | `Course has no price set` | Backend admin issue |
| 400 | `Your membership already covers this course` | Refresh `/me` and re-render |
| 400 | `You are already enrolled in this course` | Refresh state |

### 3.3 Stripe redirect targets

- Success: `${CLIENT_URL}/courses/{courseId}/success`
- Cancel: `${CLIENT_URL}/courses/{courseId}/cancel`

Build both pages. Success page polls for the enrollment.

### 3.4 `GET /api/users/me?populate=enrollments,enrollments.course`

**Auth required.** Returns user with enrollments populated.

**Success — 200**
```json
{
  "id": 12,
  "username": "alice",
  "email": "alice@example.com",
  "enrollments": [
    {
      "id": 4,
      "progress": 0,
      "completed": false,
      "enrolled_at": "2026-05-08T16:01:23.000Z",
      "course": { "id": 7, "title": "Intro to SEL", "tier": "lowcost" }
    }
  ]
}
```

Poll every ~2s up to ~30s after redirect. Stop as soon as `enrollments.some(e => e.course.id === <courseId>)`.

## 4. Verification checklist

### 4.1 Get a Stripe checkout URL
```
POST /api/payments/checkout/course
Authorization: Bearer <JWT>
Content-Type: application/json
{ "courseId": 7 }
```
Expected: 200 with `url` field.

### 4.2 Pay
Open URL, use card `4242 4242 4242 4242`, expiry `12/34`, CVC `123`. Stripe redirects to `${CLIENT_URL}/courses/7/success`.

### 4.3 Confirm enrollment landed
```
GET /api/users/me?populate=enrollments,enrollments.course
```
Within ~5s, response includes enrollment for `courseId=7`.

### 4.4 Idempotency
Replays via `stripe events resend evt_...` return `{ received: true, duplicate: true }`. No duplicate enrollment rows.

### 4.5 Member-already-covered rejection
LOW member buying a `lowcost` course → 400 `Your membership already covers this course`.

## 5. Errors and recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 on every checkout | JWT expired/missing | Re-authenticate |
| Success page polls forever | Webhook not reaching backend | Backend issue (check `stripe listen`) |
| User reports "I paid but no enrollment" | Webhook didn't land | Tell them to email support; backend can manually fix. **Don't create the enrollment from the frontend.** |

## 6. Test mode

Same Stripe test cards as the membership guide. Course flow is `mode: 'payment'` (one-time charge), no recurring events.

## 7. Open questions

- **Refunds**: backend has no auto-refund. Refunded course leaves enrollment row in place.
- **Course "expiry"**: enrollments don't expire. Once granted, user keeps access.
- **Bundle pricing / discounts**: not modeled. Each course has one fixed price.
