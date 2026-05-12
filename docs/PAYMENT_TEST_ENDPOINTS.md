# Payment Test Endpoints

This document collects the endpoints and JSON payloads needed to test membership, course, and donation payments with Stripe, PayPal, and LINE Pay.

Assume:

```txt
API_URL=http://localhost:1337
Authorization: Bearer <JWT>
```

## 1. Login First

### `POST /api/auth/local`

```json
{
  "identifier": "user@example.com",
  "password": "password123"
}
```

Use the returned JWT for membership and course checkout:

```json
{
  "jwt": "..."
}
```

## 2. Submit Membership Application

Membership payment requires the user to have submitted the website application form.

### `POST /api/membership-applications`

Headers:

```txt
Content-Type: application/json
Authorization: Bearer <JWT>
```

Body:

```json
{
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
  "questionsNeeds": "Testing membership application"
}
```

Expected response:

```json
{
  "ok": true,
  "id": 4,
  "email": "user@example.com"
}
```

## 3. Membership Application Check

Confirm the application was saved.

### `GET /api/membership-applications/me`

Headers:

```txt
Authorization: Bearer <JWT>
```

No JSON body.

## 4. List Membership Plans

### `GET /api/subscrition-plans?filters[active][$eq]=true&sort=Price:asc`

Headers:

```txt
Authorization: Bearer <JWT>
```

No JSON body.

Use one returned `id` as `planId`.

## 5. Membership Checkout

### `POST /api/payments/checkout/membership`

Headers:

```txt
Content-Type: application/json
Authorization: Bearer <JWT>
```

PayPal:

```json
{
  "planId": 1,
  "paymentProvider": "paypal"
}
```

LINE Pay:

```json
{
  "planId": 1,
  "paymentProvider": "line_pay"
}
```

Stripe:

```json
{
  "planId": 1,
  "paymentProvider": "stripe"
}
```

Stripe also works if `paymentProvider` is omitted:

```json
{
  "planId": 1
}
```

Expected response:

```json
{
  "url": "https://checkout-provider.example/...",
  "id": "payment_id",
  "provider": "paypal"
}
```

Redirect the browser to `url`.

## 6. Course Checkout

First get courses:

### `GET /api/courses?populate=*&filters[is_published][$eq]=true&sort=title:asc`

No JSON body.

Then use a course `id`.

### `POST /api/payments/checkout/course`

Headers:

```txt
Content-Type: application/json
Authorization: Bearer <JWT>
```

PayPal:

```json
{
  "courseId": 7,
  "paymentProvider": "paypal"
}
```

LINE Pay:

```json
{
  "courseId": 7,
  "paymentProvider": "line_pay"
}
```

Stripe:

```json
{
  "courseId": 7,
  "paymentProvider": "stripe"
}
```

Expected response:

```json
{
  "url": "https://checkout-provider.example/...",
  "id": "payment_id",
  "provider": "line_pay"
}
```

## 7. Donation Checkout

Donation is public. No JWT is required.

### `POST /api/payments/checkout/donation`

Headers:

```txt
Content-Type: application/json
```

PayPal:

```json
{
  "amount": 25,
  "paymentProvider": "paypal",
  "donorName": "Test Donor",
  "donorEmail": "donor@example.com",
  "donorMessage": "Testing PayPal donation"
}
```

LINE Pay:

```json
{
  "amount": 25,
  "paymentProvider": "line_pay",
  "donorName": "Test Donor",
  "donorEmail": "donor@example.com",
  "donorMessage": "Testing LINE Pay donation"
}
```

Stripe:

```json
{
  "amount": 25,
  "paymentProvider": "stripe",
  "donorName": "Test Donor",
  "donorEmail": "donor@example.com",
  "donorMessage": "Testing Stripe donation"
}
```

Only `amount` is required:

```json
{
  "amount": 25,
  "paymentProvider": "paypal"
}
```

## 8. Provider Callback Endpoints

These are normally called by PayPal or LINE Pay after the payer approves the payment.

### PayPal Capture

### `GET /api/payments/paypal/capture?token=<paypalOrderId>`

No JSON body.

This captures payment, marks it paid, grants access or activates membership, then redirects to the frontend success page.

### LINE Pay Confirm

### `GET /api/payments/line-pay/confirm?transactionId=<linePayTransactionId>`

No JSON body.

This confirms payment, marks it paid, grants access or activates membership, then redirects to the frontend success page.

## 9. Verify Results

### Verify Membership

### `GET /api/users/me?populate=memberships`

Headers:

```txt
Authorization: Bearer <JWT>
```

Look for:

```json
{
  "memberships": [
    {
      "subscriptionStatus": "active",
      "accessLevel": "low"
    }
  ]
}
```

### Verify Course Enrollment

### `GET /api/users/me?populate=enrollments,enrollments.course`

Headers:

```txt
Authorization: Bearer <JWT>
```

Look for an enrollment whose course id matches the purchased `courseId`.

## 10. Stripe Webhook

For Stripe only:

### `POST /api/payments/webhook`

This is called by Stripe, not manually with normal JSON. Use Stripe CLI:

```bash
stripe listen --forward-to localhost:1337/api/payments/webhook
```

Then complete a Stripe checkout.
