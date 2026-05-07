'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function membershipCovers(accessLevel, tier) {
  if (tier === 'free') return true;
  if (!accessLevel) return false;
  const lvl = String(accessLevel).toLowerCase();
  if (lvl === 'premium') return true;
  if (lvl === 'low' && tier === 'lowcost') return true;
  return false;
}

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

module.exports = createCoreController('api::payment.payment', ({ strapi }) => ({

  async createMembershipCheckout(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { planId } = ctx.request.body || {};
    if (!planId) return ctx.badRequest('planId required');

    const application = await getApplicationByEmail(strapi, user.email);
    if (!application) {
      return ctx.badRequest('Please complete the membership application form before purchasing');
    }

    const plan = await strapi.entityService.findOne('api::subscrition-plan.subscrition-plan', planId);
    if (!plan || !plan.active) return ctx.badRequest('Plan not found or inactive');
    if (!plan.stripePriceId) return ctx.badRequest('Plan has no Stripe price configured');

    const existing = await getActiveMembership(strapi, user.id);
    if (existing) return ctx.badRequest('You already have an active membership; use the billing portal to manage it');

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
      ctx.body = { url: session.url, id: session.id };
    } catch (err) {
      strapi.log.error('Stripe checkout (membership) error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createCourseCheckout(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { courseId } = ctx.request.body || {};
    if (!courseId) return ctx.badRequest('courseId required');

    const course = await strapi.entityService.findOne('api::course.course', courseId);
    if (!course) return ctx.notFound('Course not found');
    if (course.tier === 'free') return ctx.badRequest('Course is free');
    if (!course.price || course.price <= 0) return ctx.badRequest('Course has no price set');

    const membership = await getActiveMembership(strapi, user.id);
    if (membership && membershipCovers(membership.accessLevel, course.tier)) {
      return ctx.badRequest('Your membership already covers this course');
    }

    const enrollments = await strapi.entityService.findMany('api::enrollment.enrollment', {
      filters: { users_permissions_user: user.id, course: courseId },
      limit: 1,
    });
    if (enrollments && enrollments.length > 0) return ctx.badRequest('You are already enrolled in this course');

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
      ctx.body = { url: session.url, id: session.id };
    } catch (err) {
      strapi.log.error('Stripe checkout (course) error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createWebinarCheckout(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { webinarId } = ctx.request.body || {};
    if (!webinarId) return ctx.badRequest('webinarId required');

    const webinar = await strapi.entityService.findOne('api::webinar.webinar', webinarId);
    if (!webinar) return ctx.notFound('Webinar not found');
    if (webinar.tier === 'free') return ctx.badRequest('Webinar is free');
    if (!webinar.price || webinar.price <= 0) return ctx.badRequest('Webinar has no price set');

    const membership = await getActiveMembership(strapi, user.id);
    if (membership && membershipCovers(membership.accessLevel, webinar.tier)) {
      return ctx.badRequest('Your membership already covers this webinar');
    }

    const registrations = await strapi.entityService.findMany('api::webinar-registration.webinar-registration', {
      filters: { learner: user.id, webinar: webinarId },
      limit: 1,
    });
    if (registrations && registrations.length > 0) return ctx.badRequest('You are already registered for this webinar');

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
      ctx.body = { url: session.url, id: session.id };
    } catch (err) {
      strapi.log.error('Stripe checkout (webinar) error:', err);
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
