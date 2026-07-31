import type { PreMatchDecisionRecord } from "../decision/types";
import type { OutcomeRecord } from "../outcome/outcome-repository";

export type EvaluationInput = Readonly<{
  decision: PreMatchDecisionRecord;
  outcome: OutcomeRecord;
}>;

export type DecisionEvaluationRecord = Readonly<{
  id: string;
  evaluationRunId: string;
  preMatchDecisionId: string;
  outcomeId: string;
  resultCode: string;
  evaluatedAtUtc: string;
}>;

export interface EvaluationRepository {
  append(evaluation: DecisionEvaluationRecord): Promise<void>;
  listForRun(evaluationRunId: string): Promise<readonly DecisionEvaluationRecord[]>;
}

export function createEvaluationInput(
  decision: PreMatchDecisionRecord,
  outcome: OutcomeRecord,
): EvaluationInput {
  return { decision, outcome };
}
