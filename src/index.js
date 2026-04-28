// // // 'use strict';

// // // module.exports = {
// // //   /**
// // //    * An asynchronous register function that runs before
// // //    * your application is initialized.
// // //    *
// // //    * This gives you an opportunity to extend code.
// // //    */
// // //   register(/*{ strapi }*/) {},

// // //   /**
// // //    * An asynchronous bootstrap function that runs before
// // //    * your application gets started.
// // //    *
// // //    * This gives you an opportunity to set up your data model,
// // //    * run jobs, or perform some special logic.
// // //    */
// // //   bootstrap(/*{ strapi }*/) {},
// // // };

// // 'use strict';

// // module.exports = {
// //   /**
// //    * Runs before the app initializes
// //    */
// //   register(/* { strapi } */) {},

// //   /**
// //    * Runs before the app starts
// //    */
// //   async bootstrap({ strapi }) {
// //     try {
// //       // Get Authenticated role
// //       const authenticatedRole = await strapi
// //         .query('plugin::users-permissions.role')
// //         .findOne({
// //           where: { type: 'authenticated' },
// //         });

// //       if (!authenticatedRole) {
// //         console.log('Authenticated role not found');
// //         return;
// //       }

// //       //  permissions
// //       const permissionsToEnable = [
// //         'api::membership.membership.find',
// //         'api::membership.membership.findOne',
// //         'api::membership.membership.create',
// //         'api::membership.membership.update',
// //       ];

// //       for (const action of permissionsToEnable) {
// //         await strapi
// //           .query('plugin::users-permissions.permission')
// //           .update({
// //             where: {
// //               action,
// //               role: authenticatedRole.id,
// //             },
// //             data: {
// //               enabled: true,
// //             },
// //           });
// //       }

// //       console.log('Membership permissions enabled successfully');
// //     } catch (error) {
// //       console.error('Error setting membership permissions:', error);
// //     }
// //   },
// // };

// const existingRole = await strapi
//   .query('plugin::users-permissions.role')
//   .findOne({
//     where: { name: 'Membership' },
//   });

// if (!existingRole) {
//   await strapi
//     .query('plugin::users-permissions.role')
//     .create({
//       data: {
//         name: 'Membership',
//         description: 'Membership users role',
//         type: 'membership',
//       },
//     });
// }
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
      // Check if Membership role already exists
      let membershipRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({
          where: { type: 'membership' },
        });

      // If role does not exist, create it
      if (!membershipRole) {
        membershipRole = await strapi
          .query('plugin::users-permissions.role')
          .create({
            data: {
              name: 'Membership',
              description: 'Users with active membership access',
              type: 'membership',
            },
          });

        console.log('Membership role created successfully');
      } else {
        console.log('Membership role already exists');
      }

      // Permissions to enable for Membership role
      const permissionsToEnable = [
        'api::membership.membership.find',
        'api::membership.membership.findOne',
        'api::membership.membership.create',
        'api::membership.membership.update',

        'api::course.course.find',
        'api::course.course.findOne',

        'api::webinar.webinar.find',
        'api::webinar.webinar.findOne',

        'api::payment.payment.create',
        'api::payment.payment.find',
      ];

      // Enable permissions for Membership role
      for (const action of permissionsToEnable) {
        const permission = await strapi
          .query('plugin::users-permissions.permission')
          .findOne({
            where: {
              action,
              role: membershipRole.id,
            },
          });

        if (permission) {
          await strapi
            .query('plugin::users-permissions.permission')
            .update({
              where: {
                id: permission.id,
              },
              data: {
                enabled: true,
              },
            });
        }
      }

      console.log('Membership permissions enabled successfully');
    } catch (error) {
      console.error('Error creating Membership role:', error);
    }
  },
};