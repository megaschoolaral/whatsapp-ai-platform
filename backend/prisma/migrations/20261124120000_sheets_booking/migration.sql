-- CreateTable
CREATE TABLE "TenantSheetsSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "spreadsheetId" TEXT,
    "sheetName" TEXT,
    "daysAhead" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSheetsSettings_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "TenantSheetsSettings" ADD CONSTRAINT "TenantSheetsSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
