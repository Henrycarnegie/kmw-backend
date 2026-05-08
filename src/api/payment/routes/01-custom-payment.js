'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/payments/checkout/membership',
      handler: 'payment.createMembershipCheckout',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/payments/checkout/course',
      handler: 'payment.createCourseCheckout',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/payments/checkout/webinar',
      handler: 'payment.createWebinarCheckout',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/payments/portal',
      handler: 'payment.createBillingPortal',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/payments/webhook',
      handler: 'payment.handleWebhook',
      config: { auth: false, policies: [], middlewares: [] },
    },
  ],
};
