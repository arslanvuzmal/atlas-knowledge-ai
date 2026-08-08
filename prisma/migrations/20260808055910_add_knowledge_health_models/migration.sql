-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "KnowledgeConflictStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- DropIndex
DROP INDEX "DocumentChunk_embedding_hnsw_idx";

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'OPEN',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGapSuggestion" (
    "id" TEXT NOT NULL,
    "knowledgeGapId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "relevanceNote" TEXT,

    CONSTRAINT "KnowledgeGapSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeConflict" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "KnowledgeConflictStatus" NOT NULL DEFAULT 'OPEN',
    "authoritativeDocId" TEXT,
    "supersededDocId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeConflictDoc" (
    "id" TEXT NOT NULL,
    "knowledgeConflictId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,

    CONSTRAINT "KnowledgeConflictDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeGap_knowledgeBaseId_status_idx" ON "KnowledgeGap"("knowledgeBaseId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeGap_status_idx" ON "KnowledgeGap"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGapSuggestion_knowledgeGapId_documentId_key" ON "KnowledgeGapSuggestion"("knowledgeGapId", "documentId");

-- CreateIndex
CREATE INDEX "KnowledgeConflict_knowledgeBaseId_status_idx" ON "KnowledgeConflict"("knowledgeBaseId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeConflict_status_idx" ON "KnowledgeConflict"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeConflictDoc_knowledgeConflictId_documentId_key" ON "KnowledgeConflictDoc"("knowledgeConflictId", "documentId");

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGapSuggestion" ADD CONSTRAINT "KnowledgeGapSuggestion_knowledgeGapId_fkey" FOREIGN KEY ("knowledgeGapId") REFERENCES "KnowledgeGap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGapSuggestion" ADD CONSTRAINT "KnowledgeGapSuggestion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConflict" ADD CONSTRAINT "KnowledgeConflict_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConflict" ADD CONSTRAINT "KnowledgeConflict_authoritativeDocId_fkey" FOREIGN KEY ("authoritativeDocId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConflict" ADD CONSTRAINT "KnowledgeConflict_supersededDocId_fkey" FOREIGN KEY ("supersededDocId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConflictDoc" ADD CONSTRAINT "KnowledgeConflictDoc_knowledgeConflictId_fkey" FOREIGN KEY ("knowledgeConflictId") REFERENCES "KnowledgeConflict"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConflictDoc" ADD CONSTRAINT "KnowledgeConflictDoc_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
