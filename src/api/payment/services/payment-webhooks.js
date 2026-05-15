"use strict";

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  PAYMENT_PROVIDER,
  formatMoney,
  getPaymentCurrency,
} = require("./payment-utils");
const { linePayPost } = require("./payment-providers");

async function getActiveMembership(strapi, userId) {
  const found = await strapi.entityService.findMany(
    "api::membership.membership",
    {
      filters: {
        users_permissions_user: userId,
        subscriptionStatus: { $in: ["active", "past_due"] },
      },
      limit: 1,
    },
  );
  return found && found[0];
}

async function syncUserSubscriptionLevel(strapi, userId) {
  const membership = await getActiveMembership(strapi, userId);
  const level = membership
    ? membership.accessLevel || "free_user"
    : "free_user";

  // Find roles by type for best practice
  const [membershipRole, authenticatedRole] = await Promise.all([
    strapi
      .query("plugin::users-permissions.role")
      .findOne({ where: { type: "membership" } }),
    strapi
      .query("plugin::users-permissions.role")
      .findOne({ where: { type: "authenticated" } }),
  ]);

  // Determine target role: 'membership' for active users, 'authenticated' for others
  const targetRole = membership ? membershipRole : authenticatedRole;

  await strapi.entityService.update("plugin::users-permissions.user", userId, {
    data: {
      subscriptionLevel: level,
      role: targetRole ? targetRole.id : undefined,
    },
  });
}

async function upsertMembershipApplication(strapi, user, body, selectedPlanId) {
  const { normalizeMembershipApplicationPayload } = require("./payment-utils");
  const email = String(user.email || "")
    .toLowerCase()
    .trim();
  if (!email) throw new Error("User email required");
  const data = {
    email,
    users_permissions_user: user.id,
    ...normalizeMembershipApplicationPayload(body, selectedPlanId),
    submittedAt: new Date(),
    rawAnswers: body,
  };
  const existing = await strapi.entityService.findMany(
    "api::membership-application.membership-application",
    {
      filters: { email },
      limit: 1,
    },
  );
  if (existing && existing.length > 0) {
    return strapi.entityService.update(
      "api::membership-application.membership-application",
      existing[0].id,
      { data },
    );
  }
  return strapi.entityService.create(
    "api::membership-application.membership-application",
    { data },
  );
}

async function saveMembershipApplicationForPaidPayment(strapi, payment) {
  if (
    payment.purchaseType !== "membership" ||
    !payment.membershipApplicationData
  )
    return null;
  const user = payment.users_permissions_user;
  const userId = user?.id || user;
  const email = (user?.email || payment.membershipApplicationData.email || "")
    .toLowerCase()
    .trim();
  if (!userId || !email) return null;
  return upsertMembershipApplication(
    strapi,
    { id: userId, email },
    payment.membershipApplicationData,
    payment.membershipApplicationData.planId,
  );
}

async function grantPurchasedAccess(strapi, payment) {
  const userId =
    payment.users_permissions_user?.id || payment.users_permissions_user;

  if (payment.purchaseType === "membership") {
    const membershipId = payment.membership?.id || payment.membership;
    if (!membershipId) return;
    const membership = payment.membership;
    const oldStart = membership?.startDate
      ? new Date(membership.startDate)
      : null;
    const oldEnd = membership?.endDate ? new Date(membership.endDate) : null;
    const durationDays =
      oldStart && oldEnd && oldEnd > oldStart
        ? Math.max(
            1,
            Math.ceil((oldEnd.getTime() - oldStart.getTime()) / 86400000),
          )
        : 365;
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + durationDays);
    await strapi.entityService.update(
      "api::membership.membership",
      membershipId,
      {
        data: { subscriptionStatus: "active", startDate: start, endDate: end },
      },
    );
    if (userId) await syncUserSubscriptionLevel(strapi, userId);
  }

  if (payment.purchaseType === "course") {
    const courseId = payment.course?.id || payment.course;
    if (!userId || !courseId) return;
    const existing = await strapi.entityService.findMany(
      "api::enrollment.enrollment",
      {
        filters: { users_permissions_user: userId, course: courseId },
        limit: 1,
      },
    );
    if (!existing || existing.length === 0) {
      await strapi.entityService.create("api::enrollment.enrollment", {
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

  if (payment.purchaseType === "webinar") {
    const webinarId = payment.webinar?.id || payment.webinar;
    if (!userId || !webinarId) return;
    const existing = await strapi.entityService.findMany(
      "api::webinar-registration.webinar-registration",
      {
        filters: { learner: userId, webinar: webinarId },
        limit: 1,
      },
    );
    if (!existing || existing.length === 0) {
      await strapi.entityService.create(
        "api::webinar-registration.webinar-registration",
        {
          data: {
            learner: userId,
            webinar: webinarId,
            state: "confirmed",
            registered_at: new Date(),
            publishedAt: new Date(),
          },
        },
      );
    }
  }
}

async function markExternalPaymentPaid(strapi, payment) {
  if (payment.paymentStatus === "paid") return payment;
  await saveMembershipApplicationForPaidPayment(strapi, payment);
  await grantPurchasedAccess(strapi, payment);
  return strapi.entityService.update("api::payment.payment", payment.id, {
    data: { paymentStatus: "paid", paymentDate: new Date() },
  });
}

async function findPaymentByReference(strapi, provider, reference) {
  const found = await strapi.entityService.findMany("api::payment.payment", {
    filters: { provider, transactionReference: reference },
    populate: ["users_permissions_user", "course", "webinar", "membership"],
    limit: 1,
  });
  return found && found[0];
}

// ─── Stripe webhook handlers ─────────────────────────────

async function handleSubscriptionCheckout(strapi, session, eventId) {
  const userId = session.metadata && Number(session.metadata.userId);
  const planId = session.metadata && Number(session.metadata.planId);
  if (!userId || !planId) return;
  const plan = await strapi.entityService.findOne(
    "api::subscription-plan.subscription-plan",
    planId,
  );
  if (!plan) return;
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + (plan.duration || 365));
  const accessLevel = (plan.accessLevel || "").toLowerCase();
  const membership = await strapi.entityService.create(
    "api::membership.membership",
    {
      data: {
        users_permissions_user: userId,
        subscriptionStatus: "active",
        accessLevel,
        startDate: start,
        endDate: end,
        stripeSubscriptionId: session.subscription,
        stripeCustomerId: session.customer,
      },
    },
  );
  await syncUserSubscriptionLevel(strapi, userId);
  let membershipApplicationData = null;
  if (session.metadata?.membershipApplicationData) {
    try {
      membershipApplicationData = JSON.parse(
        session.metadata.membershipApplicationData,
      );
    } catch (e) {
      /**/
    }
  }
  const pending = await strapi.entityService.findMany("api::payment.payment", {
    filters: {
      provider: PAYMENT_PROVIDER.STRIPE,
      stripeSessionId: session.id,
      purchaseType: "membership",
    },
    populate: ["users_permissions_user", "membership"],
    limit: 1,
  });
  if (pending && pending[0]) {
    await saveMembershipApplicationForPaidPayment(strapi, pending[0]);
    await strapi.entityService.update("api::payment.payment", pending[0].id, {
      data: {
        amount: (session.amount_total || 0) / 100,
        paymentStatus: "paid",
        paymentDate: new Date(),
        stripeEventId: eventId,
        membership: membership.id,
      },
    });
    return;
  }
  const paymentData = {
    amount: (session.amount_total || 0) / 100,
    paymentStatus: "paid",
    provider: "stripe",
    paymentMethod: "stripe",
    paymentDate: new Date(),
    purchaseType: "membership",
    stripeSessionId: session.id,
    stripeEventId: eventId,
    users_permissions_user: userId,
    membership: membership.id,
  };
  if (membershipApplicationData)
    paymentData.membershipApplicationData = membershipApplicationData;
  const payment = await strapi.entityService.create("api::payment.payment", {
    data: paymentData,
  });
  if (membershipApplicationData)
    await saveMembershipApplicationForPaidPayment(strapi, payment);
}

async function handleCourseCheckout(strapi, session, eventId) {
  const userId = Number(session.metadata.userId);
  const courseId = Number(session.metadata.courseId);
  if (!userId || !courseId) return;
  const existing = await strapi.entityService.findMany(
    "api::enrollment.enrollment",
    { filters: { users_permissions_user: userId, course: courseId }, limit: 1 },
  );
  if (!existing || existing.length === 0) {
    await strapi.entityService.create("api::enrollment.enrollment", {
      data: {
        users_permissions_user: userId,
        course: courseId,
        enrolled_at: new Date(),
        progress: 0,
        completed: false,
      },
    });
  }
  await strapi.entityService.create("api::payment.payment", {
    data: {
      amount: (session.amount_total || 0) / 100,
      paymentStatus: "paid",
      provider: "stripe",
      paymentMethod: "stripe",
      paymentDate: new Date(),
      purchaseType: "course",
      stripeSessionId: session.id,
      stripeEventId: eventId,
      users_permissions_user: userId,
      course: courseId,
    },
  });
}

async function handleWebinarCheckout(strapi, session, eventId) {
  const userId = Number(session.metadata.userId);
  const webinarId = Number(session.metadata.webinarId);
  if (!userId || !webinarId) return;
  const existing = await strapi.entityService.findMany(
    "api::webinar-registration.webinar-registration",
    { filters: { learner: userId, webinar: webinarId }, limit: 1 },
  );
  if (!existing || existing.length === 0) {
    await strapi.entityService.create(
      "api::webinar-registration.webinar-registration",
      {
        data: {
          learner: userId,
          webinar: webinarId,
          state: "confirmed",
          registered_at: new Date(),
        },
      },
    );
  }
  await strapi.entityService.create("api::payment.payment", {
    data: {
      amount: (session.amount_total || 0) / 100,
      paymentStatus: "paid",
      provider: "stripe",
      paymentMethod: "stripe",
      paymentDate: new Date(),
      purchaseType: "webinar",
      stripeSessionId: session.id,
      stripeEventId: eventId,
      users_permissions_user: userId,
      webinar: webinarId,
    },
  });
}

async function handleDonationCheckout(strapi, session, eventId) {
  const metadata = session.metadata || {};
  const userId = metadata.userId ? Number(metadata.userId) : null;
  await strapi.entityService.create("api::payment.payment", {
    data: {
      amount: (session.amount_total || 0) / 100,
      paymentStatus: "paid",
      provider: "stripe",
      paymentMethod: "stripe",
      paymentDate: new Date(),
      purchaseType: "donation",
      stripeSessionId: session.id,
      stripeEventId: eventId,
      transactionReference: session.payment_intent,
      users_permissions_user: userId || undefined,
      donorName: metadata.donorName || undefined,
      donorEmail:
        metadata.donorEmail || session.customer_details?.email || undefined,
      donorMessage: metadata.donorMessage || undefined,
    },
  });
}

async function handleInvoicePaid(strapi, invoice, eventId) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  const memberships = await strapi.entityService.findMany(
    "api::membership.membership",
    { filters: { stripeSubscriptionId: subscriptionId }, limit: 1 },
  );
  const membership = memberships && memberships[0];
  if (!membership) return;
  let plan = null;
  let userId = null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.metadata) {
      const pid = sub.metadata.planId ? Number(sub.metadata.planId) : null;
      userId = sub.metadata.userId ? Number(sub.metadata.userId) : null;
      if (pid)
        plan = await strapi.entityService.findOne(
          "api::subscription-plan.subscription-plan",
          pid,
        );
    }
  } catch (e) {
    /**/
  }
  if (invoice.billing_reason === "subscription_create") {
    if (plan?.stripeRenewalCouponId) {
      try {
        await stripe.subscriptions.update(subscriptionId, {
          coupon: plan.stripeRenewalCouponId,
        });
      } catch (e) {
        /**/
      }
    }
    return;
  }
  const newEnd = new Date();
  newEnd.setDate(newEnd.getDate() + (plan?.duration || 365));
  await strapi.entityService.update(
    "api::membership.membership",
    membership.id,
    { data: { endDate: newEnd, subscriptionStatus: "active" } },
  );
  if (userId) await syncUserSubscriptionLevel(strapi, userId);
  await strapi.entityService.create("api::payment.payment", {
    data: {
      amount: (invoice.amount_paid || 0) / 100,
      paymentStatus: "paid",
      provider: "stripe",
      paymentMethod: "stripe",
      paymentDate: new Date(),
      purchaseType: "renewal",
      stripeInvoiceId: invoice.id,
      stripeEventId: eventId,
      users_permissions_user: userId || undefined,
      membership: membership.id,
    },
  });
}

async function handleInvoiceFailed(strapi, invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  const memberships = await strapi.entityService.findMany(
    "api::membership.membership",
    { filters: { stripeSubscriptionId: subscriptionId }, limit: 1 },
  );
  const m = memberships && memberships[0];
  if (!m) return;
  await strapi.entityService.update("api::membership.membership", m.id, {
    data: { subscriptionStatus: "past_due" },
  });
}

async function handleSubscriptionDeleted(strapi, sub) {
  const memberships = await strapi.entityService.findMany(
    "api::membership.membership",
    { filters: { stripeSubscriptionId: sub.id }, limit: 1 },
  );
  const m = memberships && memberships[0];
  if (!m) return;
  await strapi.entityService.update("api::membership.membership", m.id, {
    data: { subscriptionStatus: "cancelled" },
  });
  const userId = m.users_permissions_user?.id || m.users_permissions_user;
  if (userId) await syncUserSubscriptionLevel(strapi, userId);
}

// ─── External provider callbacks ──────────────────────────

async function capturePayPal(strapi, orderId) {
  const { paypalRequest } = require("./payment-providers");
  const { paymentSuccessPath, getClientUrl } = require("./payment-utils");
  const payment = await findPaymentByReference(
    strapi,
    PAYMENT_PROVIDER.PAYPAL,
    orderId,
  );
  if (!payment)
    throw Object.assign(new Error("Payment not found"), { isNotFound: true });
  if (payment.paymentStatus !== "paid") {
    const capture = await paypalRequest(
      `/v2/checkout/orders/${orderId}/capture`,
      { method: "POST", body: "{}" },
    );
    if (capture.status !== "COMPLETED")
      throw Object.assign(
        new Error(`PayPal payment is ${capture.status || "not complete"}`),
        { isBadRequest: true },
      );
    await markExternalPaymentPaid(strapi, payment);
  }
  return `${getClientUrl()}${paymentSuccessPath(payment)}`;
}

async function confirmLinePay(strapi, transactionId) {
  const { paymentSuccessPath, getClientUrl } = require("./payment-utils");
  const payment = await findPaymentByReference(
    strapi,
    PAYMENT_PROVIDER.LINE_PAY,
    String(transactionId),
  );
  if (!payment)
    throw Object.assign(new Error("Payment not found"), { isNotFound: true });
  if (payment.paymentStatus !== "paid") {
    await linePayPost(`/v3/payments/${transactionId}/confirm`, {
      amount: Number(formatMoney(payment.amount)),
      currency: getPaymentCurrency(PAYMENT_PROVIDER.LINE_PAY),
    });
    await markExternalPaymentPaid(strapi, payment);
  }
  return `${getClientUrl()}${paymentSuccessPath(payment)}`;
}

module.exports = {
  getActiveMembership,
  syncUserSubscriptionLevel,
  grantPurchasedAccess,
  markExternalPaymentPaid,
  findPaymentByReference,
  saveMembershipApplicationForPaidPayment,
  upsertMembershipApplication,
  handleSubscriptionCheckout,
  handleCourseCheckout,
  handleWebinarCheckout,
  handleDonationCheckout,
  handleInvoicePaid,
  handleInvoiceFailed,
  handleSubscriptionDeleted,
  capturePayPal,
  confirmLinePay,
};
