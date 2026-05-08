-- AlterTable
ALTER TABLE "KnowledgeFile" ADD COLUMN "indexingState" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "KnowledgeFile" ADD COLUMN "indexingError" TEXT;
