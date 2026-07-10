-- Email OTP auth: phone becomes optional, add optional unique email, and let
-- OTP challenges target either a phone or an email.

-- AlterTable: User.phone nullable + add email
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "email" TEXT;

-- AlterTable: OtpChallenge.phone nullable + add email
ALTER TABLE "OtpChallenge" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "OtpChallenge" ADD COLUMN "email" TEXT;

-- Indexes / constraints
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "OtpChallenge_email_idx" ON "OtpChallenge"("email");
