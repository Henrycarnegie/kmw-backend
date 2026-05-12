'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/debug/plans',
      handler: 'subscription-plan.find', // wait, I'll use the existing find
      config: { auth: false, policies: [], middlewares: [] },
    },
  ],
};
