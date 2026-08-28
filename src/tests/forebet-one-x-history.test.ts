import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FOREBET_ONE_X_HISTORY, forebetRankEvidence, normalizeForebetOneX, oneXExpectedValue } from "@/domain/market-v2/forebet-one-x-history";

describe("evidencia histórica Forebet Top 10 1X", () => {
  it("preserva los conteos auditados y calcula sus tasas desde enteros", () => {
    expect(FOREBET_ONE_X_HISTORY.datasetHash).toBe("95d596e7c1897bf733aa9c2365badedfeaedfd219a936a45be6bee5396ebd317");
    expect(FOREBET_ONE_X_HISTORY.topTen).toMatchObject({ selected: 359, settled: 348, hits: 307, misses: 41, unresolved: 11 });
    expect(FOREBET_ONE_X_HISTORY.topTen.hitRate).toBe(307 / 348);
    expect(FOREBET_ONE_X_HISTORY.verification).toMatchObject({ selected: 110, settled: 103, hits: 91, misses: 12, unresolved: 7 });
    expect(FOREBET_ONE_X_HISTORY.verification.hitRate).toBe(91 / 103);
  });

  it("mantiene bandas de ranking sin extrapolar después del puesto veinte", () => {
    expect(forebetRankEvidence(1)).toMatchObject({ label: "Puestos 1–3", verificationHits: 27, verificationSettled: 30 });
    expect(forebetRankEvidence(7)).toMatchObject({ label: "Puestos 4–10", verificationHits: 64, verificationSettled: 73 });
    expect(forebetRankEvidence(14)).toMatchObject({ label: "Puestos 11–20", verificationHits: 81, verificationSettled: 100 });
    expect(forebetRankEvidence(21)).toBeNull();
  });

  it("normaliza 1X y calcula EV únicamente con entradas válidas", () => {
    expect(normalizeForebetOneX(60, 25, 15)).toBeCloseTo(0.85);
    expect(normalizeForebetOneX(60, 25, 14)).toBeCloseTo(85 / 99);
    expect(normalizeForebetOneX(0, 0, 0)).toBeNull();
    expect(oneXExpectedValue(91 / 103, 1.25)).toBeCloseTo(0.104368932);
    expect(oneXExpectedValue(0.8, 1)).toBeNull();
  });

  it("muestra predicción, histórico, fuente, precio y trazabilidad sin mezclarlos", async () => {
    const [daily, history, performance, breakdown, evidence] = await Promise.all([
      readFile("src/components/daily-ranking-status.tsx", "utf8"),
      readFile("src/components/operational-history-status.tsx", "utf8"),
      readFile("src/components/operational-performance-status.tsx", "utf8"),
      readFile("src/components/one-x-prediction-breakdown.tsx", "utf8"),
      readFile("src/components/forebet-one-x-evidence.tsx", "utf8"),
    ]);
    for (const text of ["Distribución 1 · X · 2", "Referencia histórica · Forebet 1X2", "Cuota justa del modelo", "Cuota 1X real", "Fuente de predicción", "trazabilidad"]) expect(`${daily}\n${history}\n${breakdown}\n${evidence}`).toContain(text);
    expect(daily).toContain("Una fuente nunca se presenta como calibración de otra");
    expect(history).toContain("<HistoricalPrediction");
    expect(history).not.toContain("source={source} compact");
    expect(performance).toContain("Dos muestras, sin mezclarlas");
  });
});
