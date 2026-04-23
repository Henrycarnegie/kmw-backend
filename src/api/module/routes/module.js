'use strict';

module.exports = {
  routes: [
    // Default routes
    {
      method: 'GET',
      path: '/modules',
      handler: 'module.find',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/modules/:id',
      handler: 'module.findOne',
      config: { policies: [] },
    },
    // Custom AI quiz generation route
    {
      method: 'POST',
      path: '/modules/:id/generate-quiz',
      handler: 'module.generateQuiz',
      config: {
        policies: [],
        middlewares: [],
        description: 'Generate AI quiz questions from module content',
      },
    },
    // Custom quiz submission route
    {
      method: 'POST',
      path: '/modules/:id/submit-quiz',
      handler: 'module.submitQuiz',
      config: {
        policies: [],
        middlewares: [],
        description: 'Submit quiz answers and get score',
      },
    },
  ],
};