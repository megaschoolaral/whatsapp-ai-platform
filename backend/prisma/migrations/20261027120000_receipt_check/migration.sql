-- CreateTable
CREATE TABLE "TenantReceiptSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sellerIin" TEXT,
    "minAmount" INTEGER,
    "telegramBotTokenEnc" TEXT,
    "telegramChatId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantReceiptSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sellerIin" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "qrUrl" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_tenantId_receiptId_key" ON "Receipt"("tenantId", "receiptId");

-- AddForeignKey
ALTER TABLE "TenantReceiptSettings" ADD CONSTRAINT "TenantReceiptSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

