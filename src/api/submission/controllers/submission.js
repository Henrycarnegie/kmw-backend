'use strict';

module.exports = {

  // Learner submits their answer
  async create(ctx) {
    try {
      const { moduleId, textAnswer, submittedLink } = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('You must be logged in to submit');
      }

      if (!moduleId) {
        return ctx.badRequest('Module ID is required');
      }

      // Check if module exists
      const module = await strapi.entityService.findOne(
        'api::module.module',
        moduleId
      );

      if (!module) {
        return ctx.notFound('Module not found');
      }

      // Check if learner already submitted for this module
      const existing = await strapi.entityService.findMany(
        'api::submission.submission',
        {
          filters: {
            module: moduleId,
            learner: userId,
          },
        }
      );

      // If already submitted, update instead of creating new
      if (existing && existing.length > 0) {
        const updated = await strapi.entityService.update(
          'api::submission.submission',
          existing[0].id,
          {
            data: {
              text_answer: textAnswer,
              submitted_link: submittedLink,
              status: 'submitted',
              submitted_at: new Date(),
            },
          }
        );
        return ctx.send({
          success: true,
          message: 'Submission updated successfully',
          data: updated,
        });
      }

      // Create new submission
      const submission = await strapi.entityService.create(
        'api::submission.submission',
        {
          data: {
            text_answer: textAnswer,
            submitted_link: submittedLink,
            module: moduleId,
            learner: userId,
            status: 'submitted',
            submitted_at: new Date(),
          },
        }
      );

      // Update enrollment progress
      await updateProgress(userId, module);

      return ctx.send({
        success: true,
        message: 'Submission received successfully',
        data: submission,
      });

    } catch (error) {
      strapi.log.error('Submission error:', error);
      return ctx.internalServerError('Something went wrong with your submission');
    }
  },

  // Teacher reviews a submission
  async review(ctx) {
    try {
      const { id } = ctx.params;
      const { feedback, status } = ctx.request.body;
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('You must be logged in');
      }

      const submission = await strapi.entityService.findOne(
        'api::submission.submission',
        id
      );

      if (!submission) {
        return ctx.notFound('Submission not found');
      }

      const updated = await strapi.entityService.update(
        'api::submission.submission',
        id,
        {
          data: {
            teacher_feedback: feedback,
            status: status || 'reviewed',
            reviewed_at: new Date(),
            reviewed_by: userId,
          },
        }
      );

      return ctx.send({
        success: true,
        message: 'Submission reviewed successfully',
        data: updated,
      });

    } catch (error) {
      strapi.log.error('Review error:', error);
      return ctx.internalServerError('Something went wrong');
    }
  },

  // Get all submissions for a module (teacher view)
  async findByModule(ctx) {
    try {
      const { moduleId } = ctx.params;

      const submissions = await strapi.entityService.findMany(
        'api::submission.submission',
        {
          filters: { module: moduleId },
          populate: ['learner', 'module'],
          sort: { submitted_at: 'desc' },
        }
      );

      return ctx.send({
        success: true,
        data: submissions,
      });

    } catch (error) {
      strapi.log.error('Find submissions error:', error);
      return ctx.internalServerError('Something went wrong');
    }
  },

  // Get a learner's own submissions
  async findMySubmissions(ctx) {
    try {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized('You must be logged in');
      }

      const submissions = await strapi.entityService.findMany(
        'api::submission.submission',
        {
          filters: { learner: userId },
          populate: ['module', 'module.course'],
          sort: { submitted_at: 'desc' },
        }
      );

      return ctx.send({
        success: true,
        data: submissions,
      });

    } catch (error) {
      strapi.log.error('Find my submissions error:', error);
      return ctx.internalServerError('Something went wrong');
    }
  },
};

// Helper function to update enrollment progress
async function updateProgress(userId, module) {
  try {
    const enrollments = await strapi.entityService.findMany(
      'api::enrollment.enrollment',
      {
        filters: {
          learner: userId,
          course: module.course,
        },
      }
    );

    if (!enrollments || enrollments.length === 0) return;

    // Get total modules in this course
    const allModules = await strapi.entityService.findMany(
      'api::module.module',
      {
        filters: { course: module.course },
      }
    );

    // Get all submissions by this learner for this course
    const allSubmissions = await strapi.entityService.findMany(
      'api::submission.submission',
      {
        filters: {
          learner: userId,
          module: {
            course: module.course,
          },
        },
      }
    );

    const progress = Math.round(
      (allSubmissions.length / allModules.length) * 100
    );

    const completed = progress === 100;

    await strapi.entityService.update(
      'api::enrollment.enrollment',
      enrollments[0].id,
      {
        data: {
          progress,
          completed,
          last_activity: new Date(),
        },
      }
    );

    // If completed, trigger certificate generation
    if (completed) {
      await strapi
        .service('api::certificate.certificate')
        .generate(userId, module.course);
    }

  } catch (error) {
    strapi.log.error('Progress update error:', error);
  }
}