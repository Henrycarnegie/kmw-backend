'use strict';

const crypto = require('crypto');

const KEY_MAP = {
  '本名': 'fullName',
  '出生年月日': 'birthday',
  '身分證字號': 'idNumber',
  '性別': 'gender',
  '現職、服務單位與職稱': 'positionTitle',
  'Are you a university student?': 'isUniversityStudent',
  '戶籍地址': 'address',
  '聯絡電話': 'phone',
  'Line 帳號': 'lineId',
};

function normalizeAnswers(answers) {
  const out = {};
  if (!answers || typeof answers !== 'object') return out;
  for (const [k, v] of Object.entries(answers)) {
    const target = KEY_MAP[k];
    if (target) out[target] = v;
  }
  return out;
}

function normalizeWebsiteApplication(body) {
  const allowedFields = [
    'planId',
    'fullName',
    'birthday',
    'email',
    'idNumber',
    'gender',
    'positionTitle',
    'isUniversityStudent',
    'address',
    'phone',
    'lineId',
  ];
  const data = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined && body[field] !== null) data[field] = body[field];
  }
  delete data.email;
  return data;
}

async function upsertApplication(email, data) {
  const existing = await strapi.entityService.findMany('api::membership-application.membership-application', {
    filters: { email },
    limit: 1,
  });

  if (existing && existing.length > 0) {
    return strapi.entityService.update('api::membership-application.membership-application', existing[0].id, { data });
  }

  return strapi.entityService.create('api::membership-application.membership-application', { data });
}

module.exports = {
  async submit(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const payload = ctx.request.body || {};
    const email = (user.email || '').toLowerCase().trim();
    if (!email) return ctx.badRequest('User email required');

    const data = {
      email,
      users_permissions_user: user.id,
      ...normalizeWebsiteApplication(payload),
      submittedAt: new Date(),
      rawAnswers: payload,
    };

    const row = await upsertApplication(email, data);
    ctx.body = { ok: true, id: row.id, email: row.email };
  },

  async intake(ctx) {
    const sig = ctx.request.headers['x-form-signature'];
    const raw = ctx.request.body && ctx.request.body[Symbol.for('unparsedBody')];
    const secret = process.env.FORM_INTAKE_SECRET;

    if (!secret) {
      strapi.log.error('FORM_INTAKE_SECRET not configured');
      return ctx.internalServerError('Server misconfigured');
    }
    if (!sig || !raw) return ctx.badRequest('Missing signature or body');

    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    let valid = false;
    try {
      valid = sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch (e) {
      valid = false;
    }
    if (!valid) return ctx.unauthorized('Invalid form signature');

    const payload = ctx.request.body || {};
    const email = (payload.email || '').toLowerCase().trim();
    if (!email) return ctx.badRequest('email required');

    const fields = normalizeAnswers(payload.answers);

    const data = {
      email,
      ...fields,
      googleFormResponseId: payload.googleFormResponseId,
      submittedAt: payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
      rawAnswers: payload.answers || null,
    };

    const row = await upsertApplication(email, data);

    ctx.body = { ok: true, id: row.id, email: row.email };
  },

  async me(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const email = (user.email || '').toLowerCase();

    const found = await strapi.entityService.findMany('api::membership-application.membership-application', {
      filters: { email },
      limit: 1,
    });
    if (!found || found.length === 0) return ctx.notFound('No application on file');
    ctx.body = found[0];
  },
};
