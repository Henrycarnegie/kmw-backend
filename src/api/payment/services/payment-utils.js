"use strict";

const crypto = require("crypto");

const DEFAULT_CURRENCY = "USD";
const PAYMENT_PROVIDER = {
  STRIPE: "stripe",
  PAYPAL: "paypal",
  LINE_PAY: "line_pay",
};

function normalizeDonationAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePaymentProvider(provider) {
  const n = String(provider || PAYMENT_PROVIDER.STRIPE)
    .trim()
    .toLowerCase()
    .replace("-", "_");
  if (n === "linepay") return PAYMENT_PROVIDER.LINE_PAY;
  return n;
}

function isSupportedPaymentProvider(provider) {
  return Object.values(PAYMENT_PROVIDER).includes(provider);
}

function getClientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
}

function getPaymentCallbackUrl() {
  return (
    process.env.PAYMENT_CALLBACK_URL ||
    process.env.BACKEND_URL ||
    process.env.SERVER_URL ||
    "http://localhost:1337"
  ).replace(/\/$/, "");
}

function getPaymentCurrency(provider) {
  if (provider === PAYMENT_PROVIDER.LINE_PAY) {
    return (
      process.env.LINE_PAY_CURRENCY ||
      process.env.PAYMENT_CURRENCY ||
      DEFAULT_CURRENCY
    ).toUpperCase();
  }
  return (process.env.PAYMENT_CURRENCY || DEFAULT_CURRENCY).toUpperCase();
}

function formatMoney(amount) {
  return Number(amount).toFixed(2);
}

function paymentReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function getMembershipDates(durationDays) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + (durationDays || 365));
  return { start, end };
}

function getPlanAccessLevel(plan) {
  return String(plan.accessLevel || "").toLowerCase();
}

function paymentSuccessPath(payment) {
  if (payment.purchaseType === "membership") {
    return `/membership/${payment.membership?.tier || payment.membership}/checkout/success`;
  }
  if (payment.purchaseType === "course") {
    return `/courses/${payment.course?.id || payment.course}/success`;
  }
  if (payment.purchaseType === "webinar") {
    return `/webinars/${payment.webinar?.id || payment.webinar}/success`;
  }
  if (payment.purchaseType === "donation") {
    return "/donate/success";
  }
  return "/account";
}

function normalizeMembershipApplicationPayload(body, selectedPlanId) {
  const allowedFields = [
    "fullName",
    "birthday",
    "idNumber",
    "gender",
    "positionTitle",
    "isUniversityStudent",
    "address",
    "phone",
    "lineId",
  ];
  const data = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined && body[field] !== null)
      data[field] = body[field];
  }
  if (selectedPlanId) data.planId = Number(selectedPlanId);
  return data;
}

function hasMembershipApplicationPayload(body) {
  return [
    "fullName",
    "birthday",
    "gender",
    "lineId",
    "idNumber",
    "phone",
    "address",
    "positionTitle",
    "isUniversityStudent",
  ].some(
    (field) =>
      body[field] !== undefined && body[field] !== null && body[field] !== "",
  );
}

class ServiceError extends Error {
  constructor(message, type = "internal") {
    super(message);
    this.isBadRequest = type === "badRequest";
    this.isNotFound = type === "notFound";
  }
}

module.exports = {
  DEFAULT_CURRENCY,
  PAYMENT_PROVIDER,
  ServiceError,
  normalizeDonationAmount,
  isValidEmail,
  normalizePaymentProvider,
  isSupportedPaymentProvider,
  getClientUrl,
  getPaymentCallbackUrl,
  getPaymentCurrency,
  formatMoney,
  paymentReference,
  getMembershipDates,
  getPlanAccessLevel,
  paymentSuccessPath,
  normalizeMembershipApplicationPayload,
  hasMembershipApplicationPayload,
};
