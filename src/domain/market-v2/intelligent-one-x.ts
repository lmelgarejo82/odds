import { normalizeName } from "./daily-analysis";

export const INTELLIGENT_ONE_X_POLICY = Object.freeze({
  version: "intelligent-1x/1.0.0",
  minimumProbability: 0.75,
  minimumProtectionGap: 0.15,
  market: "1X" as const,
});

export type IntelligentOneXInput = Readonly<{
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  homeName: string;
  winnerName: string | null;
  advice: string | null;
}>;

export type IntelligentOneXAssessment = Readonly<{
  market: "1X";
  probability: number;
  protectionGap: number;
  winnerSupportsHome: boolean;
  adviceSupportsOneX: boolean;
  over15Context: boolean;
  contextualAgreement: number;
  contradictory: boolean;
  publishable: boolean;
  reasons: readonly string[];
  risks: readonly string[];
}>;

function normalizedText(value: string | null): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
}

export function assessIntelligentOneX(input: IntelligentOneXInput): IntelligentOneXAssessment {
  const probability = input.homeProbability + input.drawProbability;
  const protectionGap = Math.min(input.homeProbability, input.drawProbability) - input.awayProbability;
  const winnerSupportsHome = Boolean(input.winnerName && normalizeName(input.winnerName) === normalizeName(input.homeName));
  const advice = normalizedText(input.advice);
  const normalizedHome = normalizeName(input.homeName);
  const adviceSupportsOneX = advice.includes("double chance") && advice.includes("draw") && normalizedHome.split(" ").filter((token) => token.length > 2).every((token) => normalizeName(advice).includes(token));
  const over15Context = /(?:\+|over\s*)1[.,]5\s*goals?/iu.test(advice);
  const winnerOpposesHome = Boolean(input.winnerName && !winnerSupportsHome);
  const strongModelSeparation = probability >= INTELLIGENT_ONE_X_POLICY.minimumProbability && protectionGap >= INTELLIGENT_ONE_X_POLICY.minimumProtectionGap;
  const contextualAgreement = adviceSupportsOneX ? 1 : winnerSupportsHome ? 0.8 : 0.35;
  const contradictory = winnerOpposesHome;
  const publishable = strongModelSeparation && winnerSupportsHome && !contradictory;
  const reasons = ["ONE_X_ONLY", strongModelSeparation ? "AWAY_CLEARLY_EXCLUDED" : "AWAY_NOT_CLEARLY_EXCLUDED", winnerSupportsHome ? "WINNER_SUPPORTS_HOME" : "WINNER_DOES_NOT_SUPPORT_HOME", ...(adviceSupportsOneX ? ["ADVICE_SUPPORTS_ONE_X"] : []), ...(over15Context ? ["OVER_15_CONTEXT"] : [])];
  const risks = [...(!adviceSupportsOneX ? ["ONE_X_NOT_EXPLICIT_IN_ADVICE"] : []), "SIN_COTIZACION_DIRECTA", "CALIBRATION_BOOTSTRAP"];
  return Object.freeze({ market: "1X", probability, protectionGap, winnerSupportsHome, adviceSupportsOneX, over15Context, contextualAgreement, contradictory, publishable, reasons: Object.freeze(reasons), risks: Object.freeze(risks) });
}
