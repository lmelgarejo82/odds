import type { DailyMarket } from "@/domain/market-v2/daily-analysis";

const labels: Readonly<Record<DailyMarket, string>> = Object.freeze({
  HOME: "Gana el local",
  DRAW: "Empate",
  AWAY: "Gana el visitante",
  "1X": "Local o empate",
  X2: "Empate o visitante",
  "12": "Sin empate",
  OVER_15: "Más de 1,5 goles",
  UNDER_15: "Menos de 1,5 goles",
  OVER_25: "Más de 2,5 goles",
  UNDER_25: "Menos de 2,5 goles",
});

export function marketLabel(market: string): string {
  return labels[market as DailyMarket] ?? market.replaceAll("_", " ");
}
