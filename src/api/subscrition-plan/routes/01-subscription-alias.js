'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/subscriptions',
      handler: 'subscrition-plan.find',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/subscriptions/:id',
      handler: 'subscrition-plan.findOne',
      config: { policies: [], middlewares: [] },
    },
  ],
};
