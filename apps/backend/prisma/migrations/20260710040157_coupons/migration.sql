-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discountPaise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "maxDiscountPaise" INTEGER,
    "minSubtotalPaise" INTEGER NOT NULL DEFAULT 0,
    "usageCap" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_venueId_code_key" ON "Coupon"("venueId", "code");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
