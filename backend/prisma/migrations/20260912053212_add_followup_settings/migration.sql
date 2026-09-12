-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastInboundMessageAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TenantFollowupSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "delay1hMinutes" INTEGER NOT NULL DEFAULT 60,
    "delay2hMinutes" INTEGER NOT NULL DEFAULT 720,
    "message1Text" TEXT NOT NULL DEFAULT '',
    "message2Text" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFollowupSettings_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "TenantFollowupSettings" ADD CONSTRAINT "TenantFollowupSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
