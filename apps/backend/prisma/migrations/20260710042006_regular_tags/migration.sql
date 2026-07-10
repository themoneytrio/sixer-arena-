-- CreateTable
CREATE TABLE "RegularTag" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegularTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegularTag_venueId_phone_key" ON "RegularTag"("venueId", "phone");
