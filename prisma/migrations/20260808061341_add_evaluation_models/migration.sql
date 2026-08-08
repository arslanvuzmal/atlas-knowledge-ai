-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "testCases" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evaluation_knowledgeBaseId_idx" ON "Evaluation"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "EvaluationRun_evaluationId_idx" ON "EvaluationRun"("evaluationId");

-- CreateIndex
CREATE INDEX "EvaluationRun_status_idx" ON "EvaluationRun"("status");

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
