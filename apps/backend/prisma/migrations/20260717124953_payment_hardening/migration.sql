-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundedPaise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
