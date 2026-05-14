'use strict';

/**
 * Membership Application Service
 */

module.exports = {
  async createApplication(data) {
    strapi.log.debug('createApplication called with data:', data);

    // 1. Validate required fields
    const requiredFields = [
      'planId',
      'fullName',
      'birthday',
      'email',
      'gender',
      'positionTitle',
      'isUniversityStudent',
      'address',
      'phone',
      'lineId',
    ];

    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
      strapi.log.warn('Missing required fields:', missingFields);
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    strapi.log.info(`Creating membership application for email: ${data.email}`);

    try {
      // 2. Normalize email to lowercase
      const normalizedEmail = data.email.toLowerCase().trim();

      // 3. Check for duplicate email (case-insensitive)
      const existingApplications = await strapi.db.query('api::membership-application.membership-application').findMany({
        where: {
          email: normalizedEmail,
        },
        select: ['id'],
      });

      if (existingApplications.length > 0) {
        strapi.log.warn(`Duplicate application for email: ${normalizedEmail}, id: ${existingApplications[0].id}`);
        throw new Error(`Application with email ${normalizedEmail} already exists`);
      }

      // 4. Set submittedAt if not provided
      const applicationData = {
        ...data,
        email: normalizedEmail,
        submittedAt: data.submittedAt || new Date(),
      };

      // 5. Create the application
      const entry = await strapi.entityService.create('api::membership-application.membership-application', {
        data: applicationData,
      });

      strapi.log.info(`✅ Membership application created successfully, ID: ${entry.id}`);
      return entry;
    } catch (error) {
      strapi.log.error('Error creating membership application:', error);
      throw error;
    }
  },

  async findApplication(filter = {}) {
    try {
      const entry = await strapi.entityService.findMany('api::membership-application.membership-application', {
        filters: filter,
      });
      return entry;
    } catch (error) {
      strapi.log.error('Error finding membership application:', error);
      throw error;
    }
  },

  async findByEmail(email) {
    strapi.log.debug('findByEmail called with email:', email);

    try {
      // Normalize email to lowercase
      const normalizedEmail = email.toLowerCase().trim();

      const entry = await strapi.db.query('api::membership-application.membership-application').findOne({
        where: {
          email: normalizedEmail,
        },
      });

      if (!entry) {
        strapi.log.warn(`No membership application found for email: ${normalizedEmail}`);
      }

      return entry;
    } catch (error) {
      strapi.log.error('Error finding membership application by email:', error);
      throw error;
    }
  },

  async updateApplication(id, data) {
    strapi.log.debug(`updateApplication called for ID: ${id} with data:`, data);

    try {
      const entry = await strapi.entityService.update('api::membership-application.membership-application', id, {
        data,
      });
      return entry;
    } catch (error) {
      strapi.log.error(`Error updating membership application ID ${id}:`, error);
      throw error;
    }
  },

  async deleteApplication(id) {
    strapi.log.debug(`deleteApplication called for ID: ${id}`);

    try {
      await strapi.entityService.delete('api::membership-application.membership-application', id);
      return true;
    } catch (error) {
      strapi.log.error(`Error deleting membership application ID ${id}:`, error);
      throw error;
    }
  },
};
