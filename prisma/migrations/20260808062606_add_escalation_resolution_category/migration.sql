-- CreateEnum
CREATE TYPE "EscalationResolutionCategory" AS ENUM ('MISSING_KNOWLEDGE', 'OUTDATED_SOURCE', 'CONFLICTING_SOURCE', 'RETRIEVAL_FAILURE', 'ACCESS_PROBLEM', 'INCORRECT_ANSWER', 'USER_MISUNDERSTANDING', 'OTHER');

-- AlterTable
ALTER TABLE "Escalation" ADD COLUMN     "resolutionCategory" "EscalationResolutionCategory";
