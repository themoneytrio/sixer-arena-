import nodemailer from "nodemailer";
import { config, usingRealEmail } from "../config.js";

export interface EmailProvider {
  send(to: string, code: string): Promise<{ messageId: string }>;
}

const SUBJECT = "Your Sixer Arena login code";

function textBody(code: string) {
  return `Your Sixer Arena login code is ${code}. It's valid for 5 minutes.\n\nIf you didn't request this, you can ignore this email.`;
}

function htmlBody(code: string) {
  // Inline styles only — email clients strip <style>/external CSS.
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;padding:8px">
    <div style="background:#14130E;border-radius:16px;padding:28px 24px;text-align:center">
      <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:15px;background:#FFD400;color:#14130E;font-size:34px;font-weight:800">6</div>
      <div style="color:#fff;font-size:22px;font-weight:800;margin-top:16px">Sixer Arena</div>
      <div style="color:#9a988a;font-size:13px;margin-top:4px">Box Cricket · Turf Booking</div>
    </div>
    <div style="text-align:center;padding:26px 12px 8px">
      <div style="color:#6C6C61;font-size:13px">Your login code</div>
      <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#14130E;margin:10px 0">${code}</div>
      <div style="color:#6C6C61;font-size:12px">Valid for 5 minutes. Don't share it with anyone.</div>
    </div>
  </div>`;
}

/** Dev transport — no SMTP configured. Logs the code; the plaintext is also
 *  stored on the challenge row and surfaced by the app so login works offline. */
class DevEmail implements EmailProvider {
  async send(to: string, code: string) {
    console.log(`[email:dev] → ${to}: login code ${code}`);
    return { messageId: "dev_" + Date.now() };
  }
}

/** Real transport over SMTP (Gmail by default). */
class SmtpEmail implements EmailProvider {
  private transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  async send(to: string, code: string) {
    const info = await this.transport.sendMail({
      from: config.smtp.from,
      to,
      subject: SUBJECT,
      text: textBody(code),
      html: htmlBody(code),
    });
    return { messageId: info.messageId };
  }
}

export const email: EmailProvider = usingRealEmail ? new SmtpEmail() : new DevEmail();
export const emailIsDev = !usingRealEmail;
