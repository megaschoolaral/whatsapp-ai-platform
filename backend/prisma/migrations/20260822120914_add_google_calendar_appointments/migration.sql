-- CreateEnum
CREATE TYPE "GoogleCalendarStatus" AS ENUM ('connected', 'error', 'disconnected');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('booked', 'cancelled');

-- CreateTable
CREATE TABLE "TenantGoogleCalendar" (
    "tenantId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "status" "GoogleCalendarStatus" NOT NULL DEFAULT 'connected',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,

    CONSTRAINT "TenantGoogleCalendar_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'booked',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startAt_idx" ON "Appointment"("tenantId", "startAt");

-- AddForeignKey
ALTER TABLE "TenantGoogleCalendar" ADD CONSTRAINT "TenantGoogleCalendar_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
