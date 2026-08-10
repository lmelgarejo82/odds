import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { filterFixture, type DiscoveredFixture } from "@/domain/market-v2/daily-analysis";
import { assessIntelligentOneX } from "@/domain/market-v2/intelligent-one-x";

const fixture: DiscoveredFixture = { providerFixtureId: "1", providerCompetitionId: "2", providerHomeTeamId: "3", providerAwayTeamId: "4", sportsDate: "2026-08-10", kickoffAtUtc: "2026-08-10T18:00:00.000Z", sourceTimezone: "UTC", status: "NS", season: 2026, round: "Regular Season - 1", competitionName: "Primera División", country: "Paraguay", homeName: "Olimpia", awayName: "Cerro Porteño" };

describe("Intelligent 1X", () => {
  it("publica 1X cuando la derrota queda claramente excluida y el ganador apoya al local", () => {
    expect(assessIntelligentOneX({ homeProbability: .45, drawProbability: .45, awayProbability: .1, homeName: "Olimpia", winnerName: "Olimpia", advice: "Double chance: Olimpia or draw" })).toMatchObject({ market: "1X", probability: .9, protectionGap: .35, winnerSupportsHome: true, adviceSupportsOneX: true, publishable: true });
  });

  it("usa +1,5 solo como contexto explícito de una lectura 1X", () => {
    const result = assessIntelligentOneX({ homeProbability: .45, drawProbability: .45, awayProbability: .1, homeName: "Olimpia", winnerName: "Olimpia", advice: "Double chance: Olimpia or draw and +1.5 goals" });
    expect(result).toMatchObject({ market: "1X", over15Context: true, publishable: true });
    expect(result.reasons).toContain("OVER_15_CONTEXT");
  });

  it("rechaza una lectura que favorece al visitante aunque la suma 1X sea alta", () => {
    expect(assessIntelligentOneX({ homeProbability: .45, drawProbability: .45, awayProbability: .1, homeName: "Olimpia", winnerName: "Cerro Porteño", advice: "Away team to win" })).toMatchObject({ contradictory: true, publishable: false });
  });

  it("excluye amistosos y equipos de desarrollo antes del análisis profundo", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    expect(filterFixture({ ...fixture, competitionName: "Club Friendlies" }, now).reasonCode).toBe("FRIENDLY_EXCLUDED");
    expect(filterFixture({ ...fixture, homeName: "Olimpia II" }, now).reasonCode).toBe("DEVELOPMENT_TEAM_EXCLUDED");
    expect(filterFixture({ ...fixture, awayName: "Cerro Porteño U21" }, now).reasonCode).toBe("DEVELOPMENT_TEAM_EXCLUDED");
    expect(filterFixture({ ...fixture, homeName: "Olimpia B" }, now).reasonCode).toBe("DEVELOPMENT_TEAM_EXCLUDED");
  });

  it("limita runtime, UI y replay offline al mercado 1X", async () => {
    const [runtime, ui, replay] = await Promise.all([
      readFile("src/infrastructure/market-v2/daily/runtime.ts", "utf8"),
      readFile("src/components/daily-ranking-status.tsx", "utf8"),
      readFile("src/infrastructure/market-v2/daily/derive-intelligent-one-x.ts", "utf8"),
    ]);
    expect(runtime).toContain('candidate.market === "1X"');
    expect(runtime).toContain('modelSuggestedMarket: "1X"');
    expect(ui).toContain("Local o empate");
    expect(ui).not.toContain("<DailyMarketAnalysis");
    expect(replay).toContain("apiFootballRequests: 0");
    expect(replay).toContain("oddsRequests: 0");
    expect(replay).not.toMatch(/\.listFixtures\(|\.getPrediction\(|\.bySport\(/u);
  });
});
