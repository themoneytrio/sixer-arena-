export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-sixer-secret",
  venueTz: process.env.VENUE_TZ ?? "Asia/Kolkata",
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? "mock",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "Sixer Arena <no-reply@sixerarena.app>",
  },
  accessTtlSec: 15 * 60,
  refreshTtlSec: 60 * 60 * 24 * 60, // 60 days
  holdTtlMs: 5 * 60 * 1000, // checkout hold window
};

export const usingRealPayments = Boolean(config.razorpay.keyId && config.razorpay.keySecret);
export const usingRealSms = config.sms.provider !== "mock";
// Real email delivery only when SMTP credentials are present; otherwise the
// email OTP runs in dev mode (code logged + surfaced in the app).
export const usingRealEmail = Boolean(config.smtp.user && config.smtp.pass);
