import { config, usingRealSms } from "../config.js";

export interface SmsProvider {
  send(to: string, body: string): Promise<{ messageId: string }>;
}

/** Deterministic mock — logs to stdout; the plaintext OTP is also stored on the
 *  challenge row and exposed via GET /dev/last-otp so dev clients auto-fill. */
class MockSms implements SmsProvider {
  async send(to: string, body: string) {
    console.log(`[sms:mock] → ${to}: ${body}`);
    return { messageId: "mock_" + Date.now() };
  }
}

/** Real transport (Twilio-style). Kept as a thin "send a message" abstraction so
 *  the exact same OTP generate/hash/verify path runs regardless of transport. */
class TwilioSms implements SmsProvider {
  async send(to: string, body: string) {
    const sid = process.env.TWILIO_SID!;
    const token = process.env.TWILIO_TOKEN!;
    const from = process.env.TWILIO_FROM!;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`twilio: ${json.message ?? res.status}`);
    return { messageId: json.sid };
  }
}

export const sms: SmsProvider = usingRealSms && config.sms.provider === "twilio" ? new TwilioSms() : new MockSms();
export const smsIsMock = !(usingRealSms && config.sms.provider === "twilio");
