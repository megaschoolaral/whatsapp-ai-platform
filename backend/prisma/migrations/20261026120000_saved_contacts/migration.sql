-- CreateTable
CREATE TABLE "SavedContact" (
    "tenantId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedContact_pkey" PRIMARY KEY ("tenantId","jid")
);

-- AddForeignKey
ALTER TABLE "SavedContact" ADD CONSTRAINT "SavedContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
