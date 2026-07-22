import Decimal from "decimal.js";
import { z } from "zod";

export const suggestedSideSchema = z.enum(["OVER_2_5", "UNDER_2_5", "NO_SUGGESTION"]);
export type SuggestedSide = z.infer<typeof suggestedSideSchema>;

export const scoreComponentsSchema = z.object({
  signalScore: z.number().int().min(0).max(40),
  historicalEvidenceScore: z.number().int().min(0).max(40),
  dataQualityScore: z.number().int().min(0).max(20),
}).strict();

export type ScoreComponents = z.infer<typeof scoreComponentsSchema>;

export function calculatePriorityScore(input: ScoreComponents): number {
  const scores = scoreComponentsSchema.parse(input);
  return new Decimal(scores.signalScore)
    .plus(scores.historicalEvidenceScore)
    .plus(scores.dataQualityScore)
    .toNumber();
}

export function assertCandidateIsEligible(status: string): void {
  if (status === "AMBIGUOUS") throw new Error("Un emparejamiento ambiguo no puede entrar al ranking");
}

export function rankDeterministically<T extends { priorityScore: number; canonicalKey: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.priorityScore - a.priorityScore || a.canonicalKey.localeCompare(b.canonicalKey));
}
