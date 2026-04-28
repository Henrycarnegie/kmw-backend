'use strict';

module.exports = {
  routes: [
    // Learner submits answer
    {
      method: 'POST',
      path: '/submissions',
      handler: 'submission.create',
      config: {
        policies: [],
        description: 'Submit answer or link for a module exercise',
      },
    },
    // Get my submissions
    {
      method: 'GET',
      path: '/submissions/me',
      handler: 'submission.findMySubmissions',
      config: {
        policies: [],
        description: 'Get logged in learner submissions',
      },
    },
    // Teacher gets all submissions for a module
    {
      method: 'GET',
      path: '/submissions/module/:moduleId',
      handler: 'submission.findByModule',
      config: {
        policies: [],
        description: 'Get all submissions for a module',
      },
    },
    // Teacher reviews a submission
    {
      method: 'PUT',
      path: '/submissions/:id/review',
      handler: 'submission.review',
      config: {
        policies: [],
        description: 'Teacher reviews and gives feedback on submission',
      },
    },
  ],
};