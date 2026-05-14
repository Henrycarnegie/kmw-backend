'use strict';

/**
 * Membership Application Routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/membership-applications',
      handler: 'membership-application.submit',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/membership-applications/me',
      handler: 'membership-application.me',
      config: { policies: [], middlewares: [] },
    },
  ],
};