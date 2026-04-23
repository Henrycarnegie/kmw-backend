'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = {

  // Get a single module
  async findOne(ctx) {
    const { id } = ctx.params;
    const module = await strapi.entityService.findOne(
      'api::module.module',
      id,
      { populate: ['course', 'quizzes'] }
    );
    if (!module) {
      return ctx.notFound('Module not found');
    }
    return module;
  },

  // Get all modules
  async find(ctx) {
    const modules = await strapi.entityService.findMany(
      'api::module.module',
      { populate: ['course', 'quizzes'] }
    );
    return modules;
  },

  // Generate AI quiz from module content
  async generateQuiz(ctx) {
    try {
      const { id } = ctx.params;

      // Step 1 — Get the module content from database
      const module = await strapi.entityService.findOne(
        'api::module.module',
        id
      );

      if (!module) {
        return ctx.notFound('Module not found');
      }

      if (!module.content) {
        return ctx.badRequest('Module has no content to generate quiz from');
      }

      // Step 2 — Connect to Google Gemini AI
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      // Step 3 — Build the prompt
      const prompt = `
        You are an educational quiz generator for a K-12 SEL (Social Emotional Learning) platform.
        
        Based on the following module content, generate exactly 5 multiple choice questions.
        The questions should test understanding of the key concepts in the content.
        Make the questions appropriate for K-12 students.
        
        Module Title: ${module.title}
        Module Content: ${module.content}
        
        You MUST return ONLY a valid JSON array with NO extra text, NO markdown, NO code blocks.
        Use exactly this format:
        [
          {
            "question": "Your question here?",
            "options": {
              "a": "First option",
              "b": "Second option", 
              "c": "Third option",
              "d": "Fourth option"
            },
            "correct_answer": "a",
            "explanation": "Brief explanation of why this is correct"
          }
        ]
      `;

      // Step 4 — Send to AI and get response
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Step 5 — Clean and parse the response
      const cleanedResponse = responseText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      let questions;
      try {
        questions = JSON.parse(cleanedResponse);
      } catch (parseError) {
        strapi.log.error('Failed to parse AI response:', responseText);
        return ctx.internalServerError(
          'AI returned an invalid response. Please try again.'
        );
      }

      // Step 6 — Save questions to database
      const savedQuizzes = await Promise.all(
        questions.map(async (q) => {
          return await strapi.entityService.create('api::quiz.quiz', {
            data: {
              question: q.question,
              options: q.options,
              answer: q.correct_answer,
              explanation: q.explanation,
              module: id,
              is_ai_generated: true,
            },
          });
        })
      );

      // Step 7 — Return the questions to frontend
      return ctx.send({
        success: true,
        message: `Generated ${questions.length} questions for module: ${module.title}`,
        data: {
          module_id: id,
          module_title: module.title,
          questions: savedQuizzes,
        },
      });

    } catch (error) {
      strapi.log.error('Quiz generation error:', error);
      return ctx.internalServerError(
        'Something went wrong generating the quiz. Please try again.'
      );
    }
  },

  // Submit quiz answers and get score
  async submitQuiz(ctx) {
    try {
      const { id } = ctx.params;
      const { answers, userId } = ctx.request.body;

      // Get all quizzes for this module
      const quizzes = await strapi.entityService.findMany(
        'api::quiz.quiz',
        {
          filters: { module: id },
        }
      );

      if (!quizzes || quizzes.length === 0) {
        return ctx.notFound('No quiz found for this module');
      }

      // Calculate score
      let correct = 0;
      const results = quizzes.map((quiz) => {
        const userAnswer = answers[quiz.id];
        const isCorrect = userAnswer === quiz.answer;
        if (isCorrect) correct++;
        return {
          quiz_id: quiz.id,
          question: quiz.question,
          user_answer: userAnswer,
          correct_answer: quiz.answer,
          is_correct: isCorrect,
          explanation: quiz.explanation,
        };
      });

      const score = Math.round((correct / quizzes.length) * 100);
      const passed = score >= 70;

      // Save progress to enrollment
      if (userId) {
        const enrollments = await strapi.entityService.findMany(
          'api::enrollment.enrollment',
          {
            filters: {
              user: userId,
            },
            populate: ['course'],
          }
        );

        if (enrollments && enrollments.length > 0) {
          await strapi.entityService.update(
            'api::enrollment.enrollment',
            enrollments[0].id,
            {
              data: {
                last_quiz_score: score,
                last_activity: new Date(),
              },
            }
          );
        }
      }

      return ctx.send({
        success: true,
        data: {
          score,
          passed,
          correct_answers: correct,
          total_questions: quizzes.length,
          results,
          message: passed
            ? 'Congratulations! You passed!'
            : 'Keep studying and try again!',
        },
      });

    } catch (error) {
      strapi.log.error('Quiz submission error:', error);
      return ctx.internalServerError('Something went wrong submitting your quiz.');
    }
  },
};