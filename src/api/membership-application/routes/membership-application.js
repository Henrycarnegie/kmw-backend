'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/membership-applications/intake',
      handler: 'membership-application.intake',
      config: { auth: false, policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/membership-applications/me',
      handler: 'membership-application.me',
      config: { policies: [], middlewares: [] },
    },
  ],
};
