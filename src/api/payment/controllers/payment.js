'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::payment.payment', ({ strapi }) => ({

  async createMembershipCheckout(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    try {
      ctx.body = await strapi.service('api::payment.payment').createMembershipCheckout(ctx.state.user, ctx.request.body);
    } catch (err) {
      if (err.isBadRequest) return ctx.badRequest(err.message);
      if (err.isNotFound) return ctx.notFound(err.message);
      strapi.log.error('Membership checkout error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createCourseCheckout(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    try {
      ctx.body = await strapi.service('api::payment.payment').createCourseCheckout(ctx.state.user, ctx.request.body);
    } catch (err) {
      if (err.isBadRequest) return ctx.badRequest(err.message);
      if (err.isNotFound) return ctx.notFound(err.message);
      strapi.log.error('Course checkout error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createWebinarCheckout(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    try {
      ctx.body = await strapi.service('api::payment.payment').createWebinarCheckout(ctx.state.user, ctx.request.body);
    } catch (err) {
      if (err.isBadRequest) return ctx.badRequest(err.message);
      if (err.isNotFound) return ctx.notFound(err.message);
      strapi.log.error('Webinar checkout error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createDonationCheckout(ctx) {
    try {
      ctx.body = await strapi.service('api::payment.payment').createDonationCheckout(ctx.request.body);
    } catch (err) {
      if (err.isBadRequest) return ctx.badRequest(err.message);
      strapi.log.error('Donation checkout error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async createBillingPortal(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    try {
      ctx.body = await strapi.service('api::payment.payment').createBillingPortalSession(ctx.state.user);
    } catch (err) {
      if (err.isBadRequest) return ctx.badRequest(err.message);
      strapi.log.error('Billing portal error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async capturePayPalPayment(ctx) {
    const orderId = ctx.query.token || ctx.query.orderId;
    if (!orderId) return ctx.badRequest('PayPal order token required');
    try {
      const webhooks = require('../services/payment-webhooks');
      const redirectUrl = await webhooks.capturePayPal(strapi, orderId);
      ctx.redirect(redirectUrl);
    } catch (err) {
      if (err.isNotFound) return ctx.notFound(err.message);
      if (err.isBadRequest) return ctx.badRequest(err.message);
      strapi.log.error('PayPal capture error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async confirmLinePayPayment(ctx) {
    const transactionId = ctx.query.transactionId || ctx.request.body?.transactionId;
    if (!transactionId) return ctx.badRequest('LINE Pay transactionId required');
    try {
      const webhooks = require('../services/payment-webhooks');
      const redirectUrl = await webhooks.confirmLinePay(strapi, transactionId);
      ctx.redirect(redirectUrl);
    } catch (err) {
      if (err.isNotFound) return ctx.notFound(err.message);
      if (err.isBadRequest) return ctx.badRequest(err.message);
      strapi.log.error('LINE Pay confirm error:', err);
      return ctx.internalServerError(err.message);
    }
  },

  async handleWebhook(ctx) {
    const sig = ctx.request.headers['stripe-signature'];
    const raw = ctx.request.body && ctx.request.body[Symbol.for('unparsedBody')];
    if (!sig || !raw) return ctx.badRequest('Missing Stripe signature or raw request body');
    try {
      ctx.body = await strapi.service('api::payment.payment').processWebhook(sig, raw);
    } catch (err) {
      strapi.log.warn(`Stripe webhook error: ${err.message}`);
      return ctx.badRequest(`Webhook failed: ${err.message}`);
    }
  },
}));
