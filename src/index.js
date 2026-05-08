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

      // Phase 2: Public role for Stripe webhook + Google Form intake
      const publicRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });
      if (publicRole) {
        const publicActions = [
          'api::payment.payment.handleWebhook',
          'api::membership-application.membership-application.intake',
        ];
        for (const action of publicActions) {
          const existing = await strapi
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: publicRole.id } });
          if (!existing) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: publicRole.id } });
          }
        }
        console.log('Public Stripe + form intake permissions enabled');
      }

      // Phase 2: Authenticated role for checkout/portal/me endpoints
      const authRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } });
      if (authRole) {
        const authActions = [
          'api::payment.payment.createMembershipCheckout',
          'api::payment.payment.createCourseCheckout',
          'api::payment.payment.createWebinarCheckout',
          'api::payment.payment.createBillingPortal',
          'api::membership-application.membership-application.me',
        ];
        for (const action of authActions) {
          const existing = await strapi
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: authRole.id } });
          if (!existing) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: authRole.id } });
          }
        }
        console.log('Authenticated checkout permissions enabled');
      }
    } catch (error) {
      console.error('Error creating Membership role:', error);
    }
  },
};