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