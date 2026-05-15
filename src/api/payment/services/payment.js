"use strict";

const { createCoreService } = require("@strapi/strapi").factories;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  PAYMENT_PROVIDER,
  ServiceError,
  normalizePaymentProvider,
  isSupportedPaymentProvider,
  getClientUrl,
  getPaymentCallbackUrl,
  getPaymentCurrency,
  formatMoney,
  paymentReference,
  getMembershipDates,
  getPlanAccessLevel,
  normalizeMembershipApplicationPayload,
  hasMembershipApplicationPayload,
  normalizeDonationAmount,
  isValidEmail,
} = require("./payment-utils");
const { paypalRequest, linePayPost } = require("./payment-providers");
const webhooks = require("./payment-webhooks");

module.exports = createCoreService("api::payment.payment", ({ strapi }) => ({
  // ─── Checkout: Membership ──────────────────────────────
  async createMembershipCheckout(user, body) {
    const { planId, subscriptionId } = body || {};
    const selectedPlanId = subscriptionId || planId;
    const provider = normalizePaymentProvider(
      body?.paymentProvider || body?.provider,
    );
    if (!isSupportedPaymentProvider(provider))
      throw new ServiceError("Unsupported payment provider", "badRequest");
    if (!selectedPlanId)
      throw new ServiceError("subscriptionId required", "badRequest");

    const membershipApplicationData = hasMembershipApplicationPayload(
      body || {},
    )
      ? {
          ...normalizeMembershipApplicationPayload(body || {}, selectedPlanId),
          email: user.email,
        }
      : null;

    const application = await strapi.entityService.findMany(
      "api::membership-application.membership-application",
      {
        filters: { email: String(user.email || "").toLowerCase() },
        limit: 1,
      },
    );
    if ((!application || !application[0]) && !membershipApplicationData) {
      throw new ServiceError(
        "Please complete the membership application form before purchasing",
        "badRequest",
      );
    }

    const plan = await strapi.entityService.findOne(
      "api::subscription-plan.subscription-plan",
      selectedPlanId,
    );
    if (!plan || !plan.active)
      throw new ServiceError(
        "Subscription not found or inactive",
        "badRequest",
      );
    if (!plan.price || plan.price <= 0)
      throw new ServiceError("Subscription has no price set", "badRequest");

    const existing = await webhooks.getActiveMembership(strapi, user.id);
    if (existing)
      throw new ServiceError(
        "You already have an active membership; use the billing portal to manage it",
        "badRequest",
      );

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      return this._createHostedCheckout(provider, {
        amount: Number(plan.price),
        title: plan.name,
        purchaseType: "membership",
        userId: user.id,
        membershipPlan: plan,
        membershipApplicationData,
        cancelPath: `/membership/${plan.accessLevel}/checkout/cancel`,
      });
    }

    if (!plan.stripePriceId)
      throw new ServiceError(
        "Subscription has no Stripe price configured",
        "badRequest",
      );
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${process.env.CLIENT_URL}/membership/${plan.accessLevel}/checkout/success`,
      cancel_url: `${process.env.CLIENT_URL}/membership/${plan.accessLevel}/checkout/cancel`,
      metadata: {
        purchaseType: "membership",
        userId: String(user.id),
        planId: String(plan.id),
        membershipApplicationData: membershipApplicationData
          ? JSON.stringify(membershipApplicationData)
          : "",
      },
      subscription_data: {
        metadata: {
          userId: String(user.id),
          planId: String(plan.id),
          membershipApplicationData: membershipApplicationData
            ? JSON.stringify(membershipApplicationData)
            : "",
        },
      },
    });
    return {
      url: session.url,
      id: session.id,
      provider: PAYMENT_PROVIDER.STRIPE,
    };
  },

  // ─── Checkout: Course ──────────────────────────────────
  async createCourseCheckout(user, body) {
    const { courseId } = body || {};
    const provider = normalizePaymentProvider(
      body?.paymentProvider || body?.provider,
    );
    if (!isSupportedPaymentProvider(provider))
      throw new ServiceError("Unsupported payment provider", "badRequest");
    if (!courseId) throw new ServiceError("courseId required", "badRequest");

    const course = await strapi.entityService.findOne(
      "api::course.course",
      courseId,
    );
    if (!course) throw new ServiceError("Course not found", "notFound");
    if (course.tier === "free")
      throw new ServiceError("Course is free", "badRequest");
    if (!course.price || course.price <= 0)
      throw new ServiceError("Course has no price set", "badRequest");

    const enrollments = await strapi.entityService.findMany(
      "api::enrollment.enrollment",
      {
        filters: { users_permissions_user: user.id, course: courseId },
        limit: 1,
      },
    );
    if (enrollments && enrollments.length > 0)
      throw new ServiceError(
        "You are already enrolled in this course",
        "badRequest",
      );

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      return this._createHostedCheckout(provider, {
        amount: Number(course.price),
        title: course.title,
        purchaseType: "course",
        userId: user.id,
        courseId: course.id,
        cancelPath: `/courses/${courseId}/cancel`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: course.title },
            unit_amount: Math.round(Number(course.price) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/courses/${courseId}/success`,
      cancel_url: `${process.env.CLIENT_URL}/courses/${courseId}/cancel`,
      metadata: {
        purchaseType: "course",
        userId: String(user.id),
        courseId: String(course.id),
      },
    });
    return {
      url: session.url,
      id: session.id,
      provider: PAYMENT_PROVIDER.STRIPE,
    };
  },

  // ─── Checkout: Webinar ─────────────────────────────────
  async createWebinarCheckout(user, body) {
    const { webinarId } = body || {};
    const provider = normalizePaymentProvider(
      body?.paymentProvider || body?.provider,
    );
    if (!isSupportedPaymentProvider(provider))
      throw new ServiceError("Unsupported payment provider", "badRequest");
    if (!webinarId) throw new ServiceError("webinarId required", "badRequest");

    const webinar = await strapi.entityService.findOne(
      "api::webinar.webinar",
      webinarId,
    );
    if (!webinar) throw new ServiceError("Webinar not found", "notFound");
    if (webinar.tier === "free")
      throw new ServiceError("Webinar is free", "badRequest");
    if (!webinar.price || webinar.price <= 0)
      throw new ServiceError("Webinar has no price set", "badRequest");

    const registrations = await strapi.entityService.findMany(
      "api::webinar-registration.webinar-registration",
      {
        filters: { learner: user.id, webinar: webinarId },
        limit: 1,
      },
    );
    if (registrations && registrations.length > 0)
      throw new ServiceError(
        "You are already registered for this webinar",
        "badRequest",
      );

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      return this._createHostedCheckout(provider, {
        amount: Number(webinar.price),
        title: webinar.title,
        purchaseType: "webinar",
        userId: user.id,
        webinarId: webinar.id,
        cancelPath: `/webinars/${webinarId}/cancel`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: webinar.title },
            unit_amount: Math.round(Number(webinar.price) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/webinars/${webinarId}/success`,
      cancel_url: `${process.env.CLIENT_URL}/webinars/${webinarId}/cancel`,
      metadata: {
        purchaseType: "webinar",
        userId: String(user.id),
        webinarId: String(webinar.id),
      },
    });
    return {
      url: session.url,
      id: session.id,
      provider: PAYMENT_PROVIDER.STRIPE,
    };
  },

  // ─── Checkout: Donation ────────────────────────────────
  async createDonationCheckout(body) {
    const { amount, donorName, donorEmail, donorMessage } = body || {};
    const provider = normalizePaymentProvider(
      body?.paymentProvider || body?.provider,
    );
    if (!isSupportedPaymentProvider(provider))
      throw new ServiceError("Unsupported payment provider", "badRequest");
    const unitAmount = normalizeDonationAmount(amount);
    if (!unitAmount) throw new ServiceError("amount required", "badRequest");
    if (unitAmount < 100)
      throw new ServiceError(
        "Donation amount must be at least $1.00",
        "badRequest",
      );
    const normalizedEmail = donorEmail
      ? String(donorEmail).trim().toLowerCase()
      : undefined;
    if (normalizedEmail && !isValidEmail(normalizedEmail))
      throw new ServiceError(
        "donorEmail must be a valid email address",
        "badRequest",
      );
    const normalizedName = donorName
      ? String(donorName).trim().slice(0, 120)
      : undefined;
    const normalizedMessage = donorMessage
      ? String(donorMessage).trim().slice(0, 1000)
      : undefined;
    const donationAmount = unitAmount / 100;

    if (provider !== PAYMENT_PROVIDER.STRIPE) {
      return this._createHostedCheckout(provider, {
        amount: donationAmount,
        title: "KMW Social Emotional Learning Donation",
        purchaseType: "donation",
        donorName: normalizedName,
        donorEmail: normalizedEmail,
        donorMessage: normalizedMessage,
        cancelPath: "/donate/cancel",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: normalizedEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "KMW Social Emotional Learning Donation" },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/donate/success`,
      cancel_url: `${process.env.CLIENT_URL}/donate/cancel`,
      metadata: {
        purchaseType: "donation",
        amount: String(donationAmount),
        userId: "",
        donorName: normalizedName || "",
        donorEmail: normalizedEmail || "",
        donorMessage: normalizedMessage || "",
      },
    });
    return {
      url: session.url,
      id: session.id,
      provider: PAYMENT_PROVIDER.STRIPE,
    };
  },

  // ─── Billing Portal ────────────────────────────────────
  async createBillingPortalSession(user) {
    const memberships = await strapi.entityService.findMany(
      "api::membership.membership",
      {
        filters: { users_permissions_user: user.id },
        sort: { createdAt: "desc" },
        limit: 1,
      },
    );
    const membership = memberships && memberships[0];
    if (!membership || !membership.stripeCustomerId)
      throw new ServiceError(
        "No Stripe customer found for this user",
        "badRequest",
      );
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: membership.stripeCustomerId,
      return_url: `${process.env.CLIENT_URL}/account`,
    });
    return { url: portalSession.url };
  },

  // ─── Webhook ───────────────────────────────────────────
  async processWebhook(sig, rawBody) {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    const seen = await strapi.entityService.findMany("api::payment.payment", {
      filters: { stripeEventId: event.id },
      limit: 1,
    });
    if (seen && seen.length > 0) return { received: true, duplicate: true };

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription")
          await webhooks.handleSubscriptionCheckout(strapi, session, event.id);
        else if (session.mode === "payment") {
          const pt = session.metadata?.purchaseType;
          if (pt === "course")
            await webhooks.handleCourseCheckout(strapi, session, event.id);
          else if (pt === "webinar")
            await webhooks.handleWebinarCheckout(strapi, session, event.id);
          else if (pt === "donation")
            await webhooks.handleDonationCheckout(strapi, session, event.id);
        }
        break;
      }
      case "invoice.paid":
        await webhooks.handleInvoicePaid(strapi, event.data.object, event.id);
        break;
      case "invoice.payment_failed":
        await webhooks.handleInvoiceFailed(strapi, event.data.object);
        break;
      case "customer.subscription.deleted":
        await webhooks.handleSubscriptionDeleted(strapi, event.data.object);
        break;
      default:
        strapi.log.info(`Unhandled webhook event: ${event.type}`);
    }
    return { received: true };
  },

  // ─── External provider helpers ─────────────────────────
  async _createHostedCheckout(provider, data) {
    if (provider === PAYMENT_PROVIDER.PAYPAL)
      return this._createPayPalCheckout(data);
    if (provider === PAYMENT_PROVIDER.LINE_PAY)
      return this._createLinePayCheckout(data);
    throw new ServiceError(
      `Unsupported payment provider: ${provider}`,
      "badRequest",
    );
  },

  async _createPayPalCheckout(data) {
    const currency = getPaymentCurrency(PAYMENT_PROVIDER.PAYPAL);
    const amount = formatMoney(data.amount);
    const callbackUrl = getPaymentCallbackUrl();
    const clientUrl = getClientUrl();
    const metadata = JSON.stringify({
      purchaseType: data.purchaseType,
      userId: data.userId || "",
      courseId: data.courseId || "",
      webinarId: data.webinarId || "",
    });
    const order = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: data.title,
            custom_id: metadata,
            amount: { currency_code: currency, value: amount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
              user_action: "PAY_NOW",
              return_url: `${callbackUrl}/api/payments/paypal/capture`,
              cancel_url: `${clientUrl}${data.cancelPath}`,
            },
          },
        },
      }),
    });
    const redirect = (order.links || []).find(
      (l) => l.rel === "payer-action" || l.rel === "approve",
    );
    if (!redirect) throw new Error("PayPal did not return an approval URL");
    await this._createPendingPayment(PAYMENT_PROVIDER.PAYPAL, order.id, data);
    return {
      url: redirect.href,
      id: order.id,
      provider: PAYMENT_PROVIDER.PAYPAL,
    };
  },

  async _createLinePayCheckout(data) {
    const currency = getPaymentCurrency(PAYMENT_PROVIDER.LINE_PAY);
    const amount = Number(formatMoney(data.amount));
    const orderId = paymentReference("kmw-line");
    const callbackUrl = getPaymentCallbackUrl();
    const clientUrl = getClientUrl();
    const response = await linePayPost("/v3/payments/request", {
      amount,
      currency,
      orderId,
      packages: [
        {
          id: "default",
          amount,
          products: [
            {
              id: data.purchaseType,
              name: data.title,
              quantity: 1,
              price: amount,
            },
          ],
        },
      ],
      redirectUrls: {
        confirmUrl: `${callbackUrl}/api/payments/line-pay/confirm`,
        cancelUrl: `${clientUrl}${data.cancelPath}`,
      },
    });
    const transactionId = String(response.info?.transactionId || orderId);
    await this._createPendingPayment(
      PAYMENT_PROVIDER.LINE_PAY,
      transactionId,
      data,
    );
    const paymentUrl =
      response.info?.paymentUrl?.web || response.info?.paymentUrl?.app;
    if (!paymentUrl) throw new Error("LINE Pay did not return a payment URL");
    return {
      url: paymentUrl,
      id: transactionId,
      provider: PAYMENT_PROVIDER.LINE_PAY,
    };
  },

  async _createPendingPayment(provider, reference, data) {
    let membershipId = data.membershipId;
    if (
      !membershipId &&
      data.purchaseType === "membership" &&
      data.userId &&
      data.membershipPlan
    ) {
      const { start, end } = getMembershipDates(data.membershipPlan.duration);
      const m = await strapi.entityService.create(
        "api::membership.membership",
        {
          data: {
            users_permissions_user: data.userId,
            subscriptionStatus: "pending_payment",
            accessLevel: getPlanAccessLevel(data.membershipPlan),
            startDate: start,
            endDate: end,
          },
        },
      );
      membershipId = m.id;
    }
    return strapi.entityService.create("api::payment.payment", {
      data: {
        amount: data.amount,
        paymentStatus: "pending",
        provider,
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
        membershipApplicationData: data.membershipApplicationData || undefined,
      },
    });
  },

  // Re-export for external use
  capturePayPal: (orderId) => webhooks.capturePayPal(strapi, orderId),
  confirmLinePay: (transactionId) =>
    webhooks.confirmLinePay(strapi, transactionId),
}));
