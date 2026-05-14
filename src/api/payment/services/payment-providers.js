'use strict';

const crypto = require('crypto');

// ─── PayPal ───────────────────────────────────────────────
function getPayPalBaseUrl() {
  if (process.env.PAYPAL_API_BASE_URL) return process.env.PAYPAL_API_BASE_URL.replace(/\/$/, '');
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials are not configured');
  }
  const credentials = Buffer
    .from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`)
    .toString('base64');

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || 'PayPal token request failed');
  return data.access_token;
}

async function paypalRequest(path, options = {}) {
  const token = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error_description || data.error || 'PayPal request failed');
  return data;
}

// ─── LINE Pay ─────────────────────────────────────────────
function getLinePayBaseUrl() {
  if (process.env.LINE_PAY_API_BASE_URL) return process.env.LINE_PAY_API_BASE_URL.replace(/\/$/, '');
  return process.env.LINE_PAY_MODE === 'live'
    ? 'https://api-pay.line.me'
    : 'https://sandbox-api-pay.line.me';
}

function linePayHeaders(apiPath, bodyString) {
  if (!process.env.LINE_PAY_CHANNEL_ID || !process.env.LINE_PAY_CHANNEL_SECRET) {
    throw new Error('LINE Pay credentials are not configured');
  }
  const nonce = crypto.randomUUID();
  const message = `${process.env.LINE_PAY_CHANNEL_SECRET}${apiPath}${bodyString}${nonce}`;
  const signature = crypto
    .createHmac('sha256', process.env.LINE_PAY_CHANNEL_SECRET)
    .update(message)
    .digest('base64');

  return {
    'Content-Type': 'application/json',
    'X-LINE-ChannelId': process.env.LINE_PAY_CHANNEL_ID,
    'X-LINE-Authorization-Nonce': nonce,
    'X-LINE-Authorization': signature,
  };
}

async function linePayPost(apiPath, body) {
  const bodyString = JSON.stringify(body || {});
  const response = await fetch(`${getLinePayBaseUrl()}${apiPath}`, {
    method: 'POST',
    headers: linePayHeaders(apiPath, bodyString),
    body: bodyString,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.returnMessage || 'LINE Pay request failed');
  if (data.returnCode && data.returnCode !== '0000') {
    throw new Error(data.returnMessage || `LINE Pay returned ${data.returnCode}`);
  }
  return data;
}

module.exports = { paypalRequest, linePayPost, getPayPalBaseUrl, getLinePayBaseUrl };
