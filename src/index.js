// 'use strict';

// module.exports = {
//   /**
//    * An asynchronous register function that runs before
//    * your application is initialized.
//    *
//    * This gives you an opportunity to extend code.
//    */
//   register(/*{ strapi }*/) {},

//   /**
//    * An asynchronous bootstrap function that runs before
//    * your application gets started.
//    *
//    * This gives you an opportunity to set up your data model,
//    * run jobs, or perform some special logic.
//    */
//   bootstrap(/*{ strapi }*/) {},
// };

'use strict';

module.exports = {
  /**
   * Runs before the app initializes
   */
  register(/* { strapi } */) {},

  /**
   * Runs before the app starts
   */
  async bootstrap({ strapi }) {
    try {
      // Get Authenticated role
      const authenticatedRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({
          where: { type: 'authenticated' },
        });

      if (!authenticatedRole) {
        console.log('Authenticated role not found');
        return;
      }

      // Hardcode Membership permissions
      const permissionsToEnable = [
        'api::membership.membership.find',
        'api::membership.membership.findOne',
        'api::membership.membership.create',
        'api::membership.membership.update',
      ];

      for (const action of permissionsToEnable) {
        await strapi
          .query('plugin::users-permissions.permission')
          .update({
            where: {
              action,
              role: authenticatedRole.id,
            },
            data: {
              enabled: true,
            },
          });
      }

      console.log('Membership permissions enabled successfully');
    } catch (error) {
      console.error('Error setting membership permissions:', error);
    }
  },
};
