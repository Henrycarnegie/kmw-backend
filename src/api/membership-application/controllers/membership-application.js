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
  '匯款銀行與帳號後五碼': 'bankTransferInfo',
  '你是否有任何問題或需求?': 'questionsNeeds',
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

module.exports = {
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

    const existing = await strapi.entityService.findMany('api::membership-application.membership-application', {
      filters: { email },
      limit: 1,
    });

    let row;
    if (existing && existing.length > 0) {
      row = await strapi.entityService.update('api::membership-application.membership-application', existing[0].id, { data });
    } else {
      row = await strapi.entityService.create('api::membership-application.membership-application', { data });
    }

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
