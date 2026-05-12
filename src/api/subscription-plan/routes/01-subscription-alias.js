'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/subscriptions',
      handler: 'subscription-plan.find',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/subscriptions/:id',
      handler: 'subscription-plan.findOne',
      config: { policies: [], middlewares: [] },
    },
  ],
};
