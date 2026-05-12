'use strict';

const crypto = require('crypto');
const { createCoreController } = require('@strapi/strapi').factories;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const DEFAULT_CURRENCY = 'USD';
const PAYMENT_PROVIDER = {
  STRIPE: 'stripe',
  PAYPAL: 'paypal',
  LINE_PAY: 'line_pay',
};

async function getActiveMembership(strapi, userId) {
  const found = await strapi.entityService.findMany('api::membership.membership', {
    filters: {
      users_permissions_user: userId,
      subscriptionStatus: { $in: ['active', 'past_due'] },
    },
    limit: 1,
  });
  return found && found[0];
}

async function getApplicationByEmail(strapi, email) {
  if (!email) return null;
  const found = await strapi.entityService.findMany('api::membership-application.membership-application', {
    filters: { email: email.toLowerCase() },
    limit: 1,
  });
  return found && found[0];
}

function normalizeMembershipApplicationPayload(body, selectedPlanId) {
  const allowedFields = [
    'fullName',
    'birthday',
    'idNumber',
    'gender',
    'positionTitle',
    'isUniversityStudent',
    'address',
    'phone',
    'lineId',
  ];
  const data = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined && body[field] !== null) data[field] = body[field];
  }
  if (selectedPlanId) data.planId = Number(selectedPlanId);
  return data;
}

function hasMembershipApplicationPayload(body) {
  return [
    'fullName',
    'birthday',
    'gender',
    'lineId',
    'idNumber',
    'phone',
    'address',
    'positionTitle',
    'isUniversityStudent',
  ].some(field => body[field] !== undefined && body[field] !== null && body[field] !== '');
}

async function upsertMembershipApplication(strapi, user, body, selectedPlanId) {
  const email = (user.email || '').toLowerCase().trim();
  if (!email) throw new Error('User email required');

  const data = {
    email,
    users_permissions_user: user.id,
    ...normalizeMembershipApplicationPayload(body, selectedPlanId),
    submittedAt: new Date(),
    rawAnswers: body,
  };

  const existing = await strapi.entityService.findMany('api::membership-application.membership-application', {
    filters: { email },
    limit: 1,
  });

  if (existing && existing.length > 0) {
    return strapi.entityService.update('api::membership-application.membership-application', existing[0].id, { data });
  }

  return strapi.entityService.create('api::membership-application.membership-application', { data });
}

function getMembershipDates(durationDays) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + (durationDays || 365));
  return { start, end };
}

function getPlanAccessLevel(plan) {
  return String(plan.accessLevel || '').toLowerCase();
}

async function createPendingMembership(strapi, userId, plan) {
  const { start, end } = getMembershipDates(plan.Duration);
  return strapi.entityService.create('api::membership.membership', {
    data: {
      users_permissions_user: userId,
      subscriptionStatus: 'pending_payment',
      accessLevel: getPlanAccessLevel(plan),
      StartDate: start,
      endDate: end,
      googleFormSubmitted: true,
      publishedAt: new Date(),
    },
  });
}

function normalizeDonationAmount(amount) {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized)) return null;
  return Math.round(normalized * 100);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePaymentProvider(provider) {
  const normalized = String(provider || PAYMENT_PROVIDER.STRIPE).trim().toLowerCase().replace('-', '_');
  if (normalized === 'linepay') return PAYMENT_PROVIDER.LINE_PAY;
  return normalized;
}

function isSupportedPaymentProvider(provider) {
  return Object.values(PAYMENT_PROVIDER).includes(provider);
}

function getClientUrl() {
  return (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getPaymentCallbackUrl() {
  return (process.env.PAYMENT_CALLBACK_URL || process.env.BACKEND_URL || process.env.SERVER_URL || 'http://localhost:1337').replace(/\/$/, '');
}

function getPaymentCurrency(provider) {
  if (provider === PAYMENT_PROVIDER.LINE_PAY) {
    return (process.env.LINE_PAY_CURRENCY || process.env.PAYMENT_CURRENCY || DEFAULT_CURRENCY).toUpperCase();
  }
  return (process.env.PAYMENT_CURRENCY || DEFAULT_CURRENCY).toUpperCase();
}

function formatMoney(amount) {
  return Number(amount).toFixed(2);
}

function paymentReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function getPayPalBaseUrl() {
  if (process.env.PAYPAL_API_BASE_URL) return process.env.PAYPAL_API_BASE_URL.replace(/\/$/, '');
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials are not configured');
  }

  const credentials = Buffer
    .from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`)
    .toString('base64');

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || 'PayPal token request failed');
  return data.access_token;
}

async function paypalRequest(path, options = {}) {
  const token = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error_description || data.error || 'PayPal request failed');
  return data;
}

function getLinePayBaseUrl() {
  if (process.env.LINE_PAY_API_BASE_URL) return process.env.LINE_PAY_API_BASE_URL.replace(/\/$/, '');
  return process.env.LINE_PAY_MODE === 'live'
    ? 'https://api-pay.line.me'
    : 'https://sandbox-api-pay.line.me';
}

function linePayHeaders(apiPath, bodyString) {
  if (!process.env.LINE_PAY_CHANNEL_ID || !process.env.LINE_PAY_CHANNEL_SECRET) {
    throw new Error('LINE Pay credentials are not configured');
  }

  const nonce = crypto.randomUUID();
  const message = `${process.env.LINE_PAY_CHANNEL_SECRET}${apiPath}${bodyString}${nonce}`;
  const signature = crypto
    .createHmac('sha256', process.env.LINE_PAY_CHANNEL_SECRET)
    .update(message)
    .digest('base64');

  return {
    'Content-Type': 'application/json',
    'X-LINE-ChannelId': process.env.LINE_PAY_CHANNEL_ID,
    'X-LINE-Authorization-Nonce': nonce,
    'X-LINE-Authorization': signature,
  };
}

async function linePayPost(apiPath, body) {
  const bodyString = JSON.stringify(body || {});
  const response = await fetch(`${getLinePayBaseUrl()}${apiPath}`, {
    method: 'POST',
    headers: linePayHeaders(apiPath, bodyString),
    body: bodyString,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.returnMessage || 'LINE Pay request failed');
  if (data.returnCode && data.returnCode !== '0000') {
    throw new Error(data.returnMessage || `LINE Pay returned ${data.returnCode}`);
  }
  return data;
}

async function createPendingExternalPayment(strapi, provider, reference, data) {
  let membershipId = data.membershipId;
  if (!membershipId && data.purchaseType === 'membership' && data.userId && data.membershipPlan) {
    const membership = await createPendingMembership(strapi, data.userId, data.membershipPlan);
    membershipId = membership.id;
  }

  return strapi.entityService.create('api::payment.payment', {
    data: {
      Amount: data.amount,
      paymentStatus: 'pending',
      Provider: provider,
      paymentMethod: provider,
      purchaseType: data.purchaseType,
      transactionReference: reference,
      users_permissions_user: data.userId || undefined,
      course: data.courseId || undefined,
      webinar: data.webinarId || undefined,
      membership: membershipId || undefined,
      donorName: data.donorName || undefined,
      donorEmail: data.donorEmail || undefined,
      donorMessage: data.donorMessage || undefined,
      publishedAt: new Date(),
    },
  });
}

async function findPaymentByReference(strapi, provider, reference) {
  const found = await strapi.entityService.findMany('api::payment.payment', {
    filters: { Provider: provider, transactionReference: reference },
    populate: ['users_permissions_user', 'course', 'webinar', 'membership'],
    limit: 1,
  });
  return found && found[0];
}

function paymentSuccessPath(payment) {
  if (payment.purchaseType === 'membership') return '/membership/success';
  if (payment.purchaseType === 'course') return `/courses/${payment.course?.id || payment.course}/success`;
  if (payment.purchaseType === 'webinar') return `/webinars/${payment.webinar?.id || payment.webinar}/success`;
  if (payment.purchaseType === 'donation') return '/donate/success';
  return '/account';
}

async function grantPurchasedAccess(strapi, payment) {
  const userId = payment.users_permissions_user?.id || payment.users_permissions_user;

  if (payment.purchaseType === 'membership') {
    const membership = payment.membership;
    const membershipId = membership?.id || membership;
    if (!membershipId) return;

    const oldStart = membership?.StartDate ? new Date(membership.StartDate) : null;
    const oldEnd = membership?.endDate ? new Date(membership.endDate) : null;
    const durationDays = oldStart && oldEnd && oldEnd > oldStart
      ? Math.max(1, Math.ceil((oldEnd.getTime() - oldStart.getTime()) / 86400000))
      : 365;
    const { start, end } = getMembershipDates(durationDays);

    await strapi.entityService.update('api::membership.membership', membershipId, {
      data: {
        subscriptionStatus: 'active',
        StartDate: start,
        endDate: end,
      },
    });
  }

  if (payment.purchaseType === 'course') {
    const courseId = payment.course?.id || payment.course;
    if (!userId || !courseId) return;

    const existing = await strapi.entityService.findMany('api::enrollment.enrollment', {
      filters: { users_permissions_user: userId, course: courseId },
      limit: 1,
    });
    if (!existing || existing.length === 0) {
      await strapi.entityService.create('api::enrollment.enrollment', {
        data: {
          users_permissions_user: userId,
          course: courseId,
          enrolled_at: new Date(),
          progress: 0,
          completed: false,
          publishedAt: new Date(),
        },
      });
    }
  }

  if (payment.purchaseType === 'webinar') {
    const webinarId = payment.webinar?.id || payment.webinar;
    if (!userId || !webinarId) return;

    const existing = await strapi.entityService.findMany('api::webinar-registration.webinar-registration', {
      filters: { learner: userId, webinar: webinarId },
      limit: 1,
    });
    if (!existing || existing.length === 0) {
      await strapi.entityService.create('api::webinar-registration.webinar-registration', {
        data: {
          learner: userId,
          webinar: webinarId,
          state: 'confirmed',
          registered_at: new Date(),
          publishedAt: new Date(),
        },
      });
    }
  }
}

async function markExternalPaymentPaid(strapi, payment) {
  if (payment.paymentStatus === 'paid') return payment;
  await grantPurchasedAccess(strapi, payment);
  return strapi.entityService.update('api::payment.payment', payment.id, {
    data: {
      paymentStatus: 'paid',
      paymentDate: new Date(),
    },
  });
}

async function createPayPalCheckout(strapi, data) {
  const currency = getPaymentCurrency(PAYMENT_PROVIDER.PAYPAL);
  const amount = formatMoney(data.amount);
  const callbackUrl = getPaymentCallbackUrl();
  const clientUrl = getClientUrl();
  const metadata = JSON.stringify({
    purchaseType: data.purchaseType,
    userId: data.userId || '',
    courseId: data.courseId || '',
    webinarId: data.webinarId || '',
  });

  const order = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: data.title,
        custom_id: metadata,
        amount: {
          currency_code: currency,
          value: amount,
        },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            user_action: 'PAY_NOW',
            return_url: `${callbackUrl}/api/payments/paypal/capture`,
            cancel_url: `${clientUrl}${data.cancelPath}`,
          },
        },
      },
    }),
  });

  const redirect = (order.links || []).find(link => link.rel === 'payer-action' || link.rel === 'approve');
  if (!redirect) throw new Error('PayPal did not return an approval URL');

  await createPendingExternalPayment(strapi, PAYMENT_PROVIDER.PAYPAL, order.id, data);
  return { url: redirect.href, id: order.id, provider: PAYMENT_PROVIDER.PAYPAL };
}

async function createLinePayCheckout(strapi, data) {
  const currency = getPaymentCurrency(PAYMENT_PROVIDER.LINE_PAY);
  const amount = Number(formatMoney(data.amount));
  const orderId = paymentReference('kmw-line');
  const callbackUrl = getPaymentCallbackUrl();
  const clientUrl = getClientUrl();

  const response = await linePayPost('/v3/payments/request', {
    amount,
    currency,
    orderId,
    packages: [{
      id: 'default',
      amount,
      products: [{
        id: data.purchaseType,
        name: data.title,
        quantity: 1,
        price: amount,
      }],
    }],
    redirectUrls: {
      confirmUrl: `${callbackUrl}/api/payments/line-pay/confirm`,
      cancelUrl: `${clientUrl}${data.cancelPath}`,
    },
  });

  const transactionId = String(response.info?.transactionId || orderId);
  await createPendingExternalPayment(strapi, PAYMENT_PROVIDER.LINE_PAY, transactionId, data);

  const paymentUrl = response.info?.paymentUrl?.web || response.info?.paymentUrl?.app;
  if (!paymentUrl) throw new Error('LINE Pay did not return a payment URL');
  return { url: paymentUrl, id: transactionId, provider: PAYMENT_PROVIDER.LINE_PAY };
}

async function createHostedCheckout(strapi, provider, data) {
  if (provider === PAYMENT_PROVIDER.PAYPAL) return createPayPalCheckout(strapi, data);
  if (provider === PAYMENT_PROVIDER.LINE_PAY) return createLinePayCheckout(strapi, data);
  throw new Error(`Unsupported payment provider: ${provider}`);
}

module.exports = createCoreController('api::payment.payment', ({ strapi }) => ({

  async createMembershipCheckout(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { planId, subscriptionId } = ctx.request.body || {};
    const selectedPlanId = subscriptionId || planId;
    const provider = normalizePaymentProvider(ctx.request.body?.paymentProvider || ctx.request.body?.provider);
    if (!isSupportedPaymentProvider(provider)) return ctx.badRequest('Unsupported payment provider');
    if (!selectedPlanId) return ctx.badRequest('subscriptionId required');

    let application = await getApplicationByEmail(strapi, user.email);
    if (hasMembershipApplicationPayload(ctx.request.body || {})) {
      try {
        application = await upsertMembershipApplication(strapi, user, ctx.request.body || {}, selectedPlanId);
      } catch (err) {
        strapi.log.error('Membership application form save error:', err);
        return ctx.internalServerError(err.message);
      }
    }

    if (!application) {
      return ctx.badRequest('Please complete the membership application form before purchasing');
    }

    const plan = await strapi.entityService.findOne('api::subscrition-plan.subscrition-plan', selectedPlanId);
    if (!plan || !plan.active) return ctx.badRequest('Subscription not found or inactive');
    if (!plan.Price || plan.Price <= 0) return ctx.badRequest('Subscription has no price set');

    const existing = await getActiveMembership(strapi, user.id);
    if (existing) return ctx.badRequest('You already have an active membership; use the billing portal to manage it');

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      try {
        ctx.body = await createHostedCheckout(strapi, provider, {
          amount: Number(plan.Price),
          title: plan.Name,
          purchaseType: 'membership',
          userId: user.id,
          membershipPlan: plan,
          cancelPath: '/membership/cancel',
        });
        return;
      } catch (err) {
        strapi.log.error(`${provider} checkout (membership) error:`, err);
        return ctx.internalServerError(err.message);
      }
    }

    if (!plan.stripePriceId) return ctx.badRequest('Subscription has no Stripe price configured');

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: user.email,
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        success_url: `${process.env.CLIENT_URL}/membership/success`,
        cancel_url: `${process.env.CLIENT_URL}/membership/cancel`,
        metadata: {
          purchaseType: 'membership',
          userId: String(user.id),
          planId: String(plan.id),
        },
        subscription_data: {
          metadata: { userId: String(user.id), planId: String(plan.id) },
        },
      });
      ctx.body = { url: session.url, id: session.id, provider: PAYMENT_PROVIDER.STRIPE };
    } catch (err) {
      strapi.log.error('Stripe checkout (membership) error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createCourseCheckout(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { courseId } = ctx.request.body || {};
    const provider = normalizePaymentProvider(ctx.request.body?.paymentProvider || ctx.request.body?.provider);
    if (!isSupportedPaymentProvider(provider)) return ctx.badRequest('Unsupported payment provider');
    if (!courseId) return ctx.badRequest('courseId required');

    const course = await strapi.entityService.findOne('api::course.course', courseId);
    if (!course) return ctx.notFound('Course not found');
    if (course.tier === 'free') return ctx.badRequest('Course is free');
    if (!course.price || course.price <= 0) return ctx.badRequest('Course has no price set');

    const enrollments = await strapi.entityService.findMany('api::enrollment.enrollment', {
      filters: { users_permissions_user: user.id, course: courseId },
      limit: 1,
    });
    if (enrollments && enrollments.length > 0) return ctx.badRequest('You are already enrolled in this course');

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      try {
        ctx.body = await createHostedCheckout(strapi, provider, {
          amount: Number(course.price),
          title: course.title,
          purchaseType: 'course',
          userId: user.id,
          courseId: course.id,
          cancelPath: `/courses/${courseId}/cancel`,
        });
        return;
      } catch (err) {
        strapi.log.error(`${provider} checkout (course) error:`, err);
        return ctx.internalServerError(err.message);
      }
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: user.email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: course.title },
            unit_amount: Math.round(Number(course.price) * 100),
          },
          quantity: 1,
        }],
        success_url: `${process.env.CLIENT_URL}/courses/${courseId}/success`,
        cancel_url: `${process.env.CLIENT_URL}/courses/${courseId}/cancel`,
        metadata: {
          purchaseType: 'course',
          userId: String(user.id),
          courseId: String(course.id),
        },
      });
      ctx.body = { url: session.url, id: session.id, provider: PAYMENT_PROVIDER.STRIPE };
    } catch (err) {
      strapi.log.error('Stripe checkout (course) error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createWebinarCheckout(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { webinarId } = ctx.request.body || {};
    const provider = normalizePaymentProvider(ctx.request.body?.paymentProvider || ctx.request.body?.provider);
    if (!isSupportedPaymentProvider(provider)) return ctx.badRequest('Unsupported payment provider');
    if (!webinarId) return ctx.badRequest('webinarId required');

    const webinar = await strapi.entityService.findOne('api::webinar.webinar', webinarId);
    if (!webinar) return ctx.notFound('Webinar not found');
    if (webinar.tier === 'free') return ctx.badRequest('Webinar is free');
    if (!webinar.price || webinar.price <= 0) return ctx.badRequest('Webinar has no price set');

    const registrations = await strapi.entityService.findMany('api::webinar-registration.webinar-registration', {
      filters: { learner: user.id, webinar: webinarId },
      limit: 1,
    });
    if (registrations && registrations.length > 0) return ctx.badRequest('You are already registered for this webinar');

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      try {
        ctx.body = await createHostedCheckout(strapi, provider, {
          amount: Number(webinar.price),
          title: webinar.title,
          purchaseType: 'webinar',
          userId: user.id,
          webinarId: webinar.id,
          cancelPath: `/webinars/${webinarId}/cancel`,
        });
        return;
      } catch (err) {
        strapi.log.error(`${provider} checkout (webinar) error:`, err);
        return ctx.internalServerError(err.message);
      }
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: user.email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: webinar.title },
            unit_amount: Math.round(Number(webinar.price) * 100),
          },
          quantity: 1,
        }],
        success_url: `${process.env.CLIENT_URL}/webinars/${webinarId}/success`,
        cancel_url: `${process.env.CLIENT_URL}/webinars/${webinarId}/cancel`,
        metadata: {
          purchaseType: 'webinar',
          userId: String(user.id),
          webinarId: String(webinar.id),
        },
      });
      ctx.body = { url: session.url, id: session.id, provider: PAYMENT_PROVIDER.STRIPE };
    } catch (err) {
      strapi.log.error('Stripe checkout (webinar) error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createDonationCheckout(ctx) {
    const {
      amount,
      donorName,
      donorEmail,
      donorMessage,
    } = ctx.request.body || {};
    const provider = normalizePaymentProvider(ctx.request.body?.paymentProvider || ctx.request.body?.provider);
    if (!isSupportedPaymentProvider(provider)) return ctx.badRequest('Unsupported payment provider');

    const unitAmount = normalizeDonationAmount(amount);
    if (!unitAmount) return ctx.badRequest('amount required');
    if (unitAmount < 100) return ctx.badRequest('Donation amount must be at least $1.00');

    const normalizedEmail = donorEmail ? String(donorEmail).trim().toLowerCase() : undefined;
    if (normalizedEmail && !isValidEmail(normalizedEmail)) return ctx.badRequest('donorEmail must be a valid email address');

    const normalizedName = donorName ? String(donorName).trim().slice(0, 120) : undefined;
    const normalizedMessage = donorMessage ? String(donorMessage).trim().slice(0, 1000) : undefined;
    const donationAmount = unitAmount / 100;

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      try {
        ctx.body = await createHostedCheckout(strapi, provider, {
          amount: donationAmount,
          title: 'KMW Social Emotional Learning Donation',
          purchaseType: 'donation',
          donorName: normalizedName,
          donorEmail: normalizedEmail,
          donorMessage: normalizedMessage,
          cancelPath: '/donate/cancel',
        });
        return;
      } catch (err) {
        strapi.log.error(`${provider} checkout (donation) error:`, err);
        return ctx.internalServerError(err.message);
      }
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: normalizedEmail,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'KMW Social Emotional Learning Donation' },
            unit_amount: unitAmount,
          },
          quantity: 1,
        }],
        success_url: `${process.env.CLIENT_URL}/donate/success`,
        cancel_url: `${process.env.CLIENT_URL}/donate/cancel`,
        metadata: {
          purchaseType: 'donation',
          amount: String(donationAmount),
          userId: '',
          donorName: normalizedName || '',
          donorEmail: normalizedEmail || '',
          donorMessage: normalizedMessage || '',
        },
      });
      ctx.body = { url: session.url, id: session.id, provider: PAYMENT_PROVIDER.STRIPE };
    } catch (err) {
      strapi.log.error('Stripe checkout (donation) error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createBillingPortal(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const memberships = await strapi.entityService.findMany('api::membership.membership', {
      filters: { users_permissions_user: user.id },
      sort: { createdAt: 'desc' },
      limit: 1,
    });
    const membership = memberships && memberships[0];
    if (!membership || !membership.stripeCustomerId) {
      return ctx.badRequest('No Stripe customer found for this user');
    }

    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: membership.stripeCustomerId,
        return_url: `${process.env.CLIENT_URL}/account`,
      });
      ctx.body = { url: portalSession.url };
    } catch (err) {
      strapi.log.error('Stripe billing portal error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async capturePayPalPayment(ctx) {
    const orderId = ctx.query.token || ctx.query.orderId;
    if (!orderId) return ctx.badRequest('PayPal order token required');

    try {
      const payment = await findPaymentByReference(strapi, PAYMENT_PROVIDER.PAYPAL, orderId);
      if (!payment) return ctx.notFound('Payment not found');

      if (payment.paymentStatus !== 'paid') {
        const capture = await paypalRequest(`/v2/checkout/orders/${orderId}/capture`, {
          method: 'POST',
          body: '{}',
        });
        if (capture.status !== 'COMPLETED') {
          return ctx.badRequest(`PayPal payment is ${capture.status || 'not complete'}`);
        }
        await markExternalPaymentPaid(strapi, payment);
      }

      ctx.redirect(`${getClientUrl()}${paymentSuccessPath(payment)}`);
    } catch (err) {
      strapi.log.error('PayPal capture error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async confirmLinePayPayment(ctx) {
    const transactionId = ctx.query.transactionId || ctx.request.body?.transactionId;
    if (!transactionId) return ctx.badRequest('LINE Pay transactionId required');

    try {
      const payment = await findPaymentByReference(strapi, PAYMENT_PROVIDER.LINE_PAY, String(transactionId));
      if (!payment) return ctx.notFound('Payment not found');

      if (payment.paymentStatus !== 'paid') {
        await linePayPost(`/v3/payments/${transactionId}/confirm`, {
          amount: Number(formatMoney(payment.Amount)),
          currency: getPaymentCurrency(PAYMENT_PROVIDER.LINE_PAY),
        });
        await markExternalPaymentPaid(strapi, payment);
      }

      ctx.redirect(`${getClientUrl()}${paymentSuccessPath(payment)}`);
    } catch (err) {
      strapi.log.error('LINE Pay confirm error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async handleWebhook(ctx) {
    const sig = ctx.request.headers['stripe-signature'];
    const raw = ctx.request.body && ctx.request.body[Symbol.for('unparsedBody')];

    if (!sig || !raw) return ctx.badRequest('Missing Stripe signature or raw request body');

    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      strapi.log.warn(`Stripe webhook signature failed: ${err.message}`);
      return ctx.badRequest(`Webhook signature failed: ${err.message}`);
    }

    const seen = await strapi.entityService.findMany('api::payment.payment', {
      filters: { stripeEventId: event.id },
      limit: 1,
    });
    if (seen && seen.length > 0) {
      ctx.body = { received: true, duplicate: true };
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.mode === 'subscription') {
            await handleSubscriptionCheckout(strapi, session, event.id);
          } else if (session.mode === 'payment') {
            const purchaseType = session.metadata && session.metadata.purchaseType;
            if (purchaseType === 'course') await handleCourseCheckout(strapi, session, event.id);
            else if (purchaseType === 'webinar') await handleWebinarCheckout(strapi, session, event.id);
            else if (purchaseType === 'donation') await handleDonationCheckout(strapi, session, event.id);
          }
          break;
        }
        case 'invoice.paid':
          await handleInvoicePaid(strapi, event.data.object, event.id);
          break;
        case 'invoice.payment_failed':
          await handleInvoiceFailed(strapi, event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(strapi, event.data.object);
          break;
        case 'customer.subscription.updated':
          strapi.log.info(`Subscription updated: ${event.data.object.id} status=${event.data.object.status}`);
          break;
        default:
          strapi.log.info(`Unhandled webhook event: ${event.type}`);
      }
    } catch (err) {
      strapi.log.error(`Webhook handler error for ${event.type} (${event.id}):`, err);
    }

    ctx.body = { received: true };
  },
}));

async function handleSubscriptionCheckout(strapi, session, eventId) {
  const userId = session.metadata && Number(session.metadata.userId);
  const planId = session.metadata && Number(session.metadata.planId);
  if (!userId || !planId) {
    strapi.log.warn(`subscription checkout missing metadata: session=${session.id}`);
    return;
  }

  const plan = await strapi.entityService.findOne('api::subscrition-plan.subscrition-plan', planId);
  if (!plan) {
    strapi.log.warn(`Plan not found: ${planId}`);
    return;
  }

  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + (plan.Duration || 365));

  const accessLevel = (plan.accessLevel || '').toLowerCase();

  const membership = await strapi.entityService.create('api::membership.membership', {
    data: {
      users_permissions_user: userId,
      subscriptionStatus: 'active',
      accessLevel,
      StartDate: start,
      endDate: end,
      stripeSubscriptionId: session.subscription,
      stripeCustomerId: session.customer,
      googleFormSubmitted: true,
      publishedAt: new Date(),
    },
  });

  await strapi.entityService.create('api::payment.payment', {
    data: {
      Amount: (session.amount_total || 0) / 100,
      paymentStatus: 'paid',
      Provider: 'stripe',
      paymentMethod: 'stripe',
      paymentDate: new Date(),
      purchaseType: 'membership',
      stripeSessionId: session.id,
      stripeEventId: eventId,
      users_permissions_user: userId,
      membership: membership.id,
      publishedAt: new Date(),
    },
  });
}

async function handleCourseCheckout(strapi, session, eventId) {
  const userId = Number(session.metadata.userId);
  const courseId = Number(session.metadata.courseId);
  if (!userId || !courseId) return;

  const existing = await strapi.entityService.findMany('api::enrollment.enrollment', {
    filters: { users_permissions_user: userId, course: courseId },
    limit: 1,
  });
  if (!existing || existing.length === 0) {
    await strapi.entityService.create('api::enrollment.enrollment', {
      data: {
        users_permissions_user: userId,
        course: courseId,
        enrolled_at: new Date(),
        progress: 0,
        completed: false,
        publishedAt: new Date(),
      },
    });
  }

  await strapi.entityService.create('api::payment.payment', {
    data: {
      Amount: (session.amount_total || 0) / 100,
      paymentStatus: 'paid',
      Provider: 'stripe',
      paymentMethod: 'stripe',
      paymentDate: new Date(),
      purchaseType: 'course',
      stripeSessionId: session.id,
      stripeEventId: eventId,
      users_permissions_user: userId,
      course: courseId,
      publishedAt: new Date(),
    },
  });
}

async function handleWebinarCheckout(strapi, session, eventId) {
  const userId = Number(session.metadata.userId);
  const webinarId = Number(session.metadata.webinarId);
  if (!userId || !webinarId) return;

  const existing = await strapi.entityService.findMany('api::webinar-registration.webinar-registration', {
    filters: { learner: userId, webinar: webinarId },
    limit: 1,
  });
  if (!existing || existing.length === 0) {
    await strapi.entityService.create('api::webinar-registration.webinar-registration', {
      data: {
        learner: userId,
        webinar: webinarId,
        state: 'confirmed',
        registered_at: new Date(),
        publishedAt: new Date(),
      },
    });
  }

  await strapi.entityService.create('api::payment.payment', {
    data: {
      Amount: (session.amount_total || 0) / 100,
      paymentStatus: 'paid',
      Provider: 'stripe',
      paymentMethod: 'stripe',
      paymentDate: new Date(),
      purchaseType: 'webinar',
      stripeSessionId: session.id,
      stripeEventId: eventId,
      users_permissions_user: userId,
      webinar: webinarId,
      publishedAt: new Date(),
    },
  });
}

async function handleDonationCheckout(strapi, session, eventId) {
  const metadata = session.metadata || {};
  const userId = metadata.userId ? Number(metadata.userId) : null;

  await strapi.entityService.create('api::payment.payment', {
    data: {
      Amount: (session.amount_total || 0) / 100,
      paymentStatus: 'paid',
      Provider: 'stripe',
      paymentMethod: 'stripe',
      paymentDate: new Date(),
      purchaseType: 'donation',
      stripeSessionId: session.id,
      stripeEventId: eventId,
      transactionReference: session.payment_intent,
      users_permissions_user: userId || undefined,
      donorName: metadata.donorName || undefined,
      donorEmail: metadata.donorEmail || session.customer_details?.email || undefined,
      donorMessage: metadata.donorMessage || undefined,
      publishedAt: new Date(),
    },
  });
}

async function handleInvoicePaid(strapi, invoice, eventId) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const memberships = await strapi.entityService.findMany('api::membership.membership', {
    filters: { stripeSubscriptionId: subscriptionId },
    limit: 1,
  });
  const membership = memberships && memberships[0];
  if (!membership) {
    strapi.log.warn(`invoice.paid: no membership for subscription ${subscriptionId}`);
    return;
  }

  let plan = null;
  let userId = null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.metadata) {
      const pid = sub.metadata.planId ? Number(sub.metadata.planId) : null;
      const uid = sub.metadata.userId ? Number(sub.metadata.userId) : null;
      if (pid) plan = await strapi.entityService.findOne('api::subscrition-plan.subscrition-plan', pid);
      userId = uid;
    }
  } catch (err) {
    strapi.log.warn(`Failed to retrieve subscription ${subscriptionId}: ${err.message}`);
  }

  if (invoice.billing_reason === 'subscription_create') {
    if (plan && plan.stripeRenewalCouponId) {
      try {
        await stripe.subscriptions.update(subscriptionId, { coupon: plan.stripeRenewalCouponId });
      } catch (err) {
        strapi.log.warn(`Failed to attach renewal coupon: ${err.message}`);
      }
    }
    return;
  }

  const newEnd = new Date();
  newEnd.setDate(newEnd.getDate() + (plan && plan.Duration ? plan.Duration : 365));

  await strapi.entityService.update('api::membership.membership', membership.id, {
    data: { endDate: newEnd, subscriptionStatus: 'active' },
  });

  await strapi.entityService.create('api::payment.payment', {
    data: {
      Amount: (invoice.amount_paid || 0) / 100,
      paymentStatus: 'paid',
      Provider: 'stripe',
      paymentMethod: 'stripe',
      paymentDate: new Date(),
      purchaseType: 'renewal',
      stripeInvoiceId: invoice.id,
      stripeEventId: eventId,
      users_permissions_user: userId || undefined,
      membership: membership.id,
      publishedAt: new Date(),
    },
  });
}

async function handleInvoiceFailed(strapi, invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  const memberships = await strapi.entityService.findMany('api::membership.membership', {
    filters: { stripeSubscriptionId: subscriptionId },
    limit: 1,
  });
  const m = memberships && memberships[0];
  if (!m) return;
  await strapi.entityService.update('api::membership.membership', m.id, {
    data: { subscriptionStatus: 'past_due' },
  });
}

async function handleSubscriptionDeleted(strapi, sub) {
  const memberships = await strapi.entityService.findMany('api::membership.membership', {
    filters: { stripeSubscriptionId: sub.id },
    limit: 1,
  });
  const m = memberships && memberships[0];
  if (!m) return;
  await strapi.entityService.update('api::membership.membership', m.id, {
    data: { subscriptionStatus: 'cancelled' },
  });
}
