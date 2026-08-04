import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { filterFixture, sportsDateInAsuncion, type DiscoveredFixture } from "@/domain/market-v2/daily-analysis";
import { evaluateOperationalResult, groupPerformance, summarizePerformance, type PerformanceRecord } from "@/domain/market-v2/operational-history";
import { mapPriceableOdds } from "@/domain/market-v2/odds-market-mapping";
import type { OddsApiEvent } from "@/infrastructure/market-v2/the-odds-api/client";

const discovered = (kickoffAtUtc: string, sportsDate = "2026-08-05"): DiscoveredFixture => ({
  providerFixtureId: "100",
  providerCompetitionId: "200",
  providerHomeTeamId: "300",
  providerAwayTeamId: "400",
  sportsDate,
  kickoffAtUtc,
  sourceTimezone: "UTC",
  status: "NS",
  season: 2026,
  round: "Round 1",
  competitionName: "Primera División",
  country: "Paraguay",
  homeName: "Local",
  awayName: "Visitante",
});

describe("Automatic V1: fecha local, mercados e historial", () => {
  it("deriva la fecha deportiva con IANA America/Asuncion y excluye el UTC del día anterior local", () => {
    expect(sportsDateInAsuncion("2026-08-05T01:00:00.000Z")).toBe("2026-08-04");
    expect(sportsDateInAsuncion("2026-08-05T04:00:00.000Z")).toBe("2026-08-05");
    expect(sportsDateInAsuncion("invalid")).toBeNull();
    expect(filterFixture(discovered("2026-08-05T01:00:00.000Z"), new Date("2026-08-04T18:00:00.000Z"))).toMatchObject({ eligible: false, reasonCode: "LOCAL_SPORTS_DATE_MISMATCH" });
    expect(filterFixture(discovered("2026-08-05T12:00:00.000Z"), new Date("2026-08-04T18:00:00.000Z"))).toMatchObject({ eligible: true, reasonCode: "ELIGIBLE" });
  });

  it("mapea de forma directa h2h y totals 1.5/2.5 sin fabricar doble oportunidad", () => {
    const event: OddsApiEvent = {
      id: "odds-1",
      commence_time: "2026-08-05T12:00:00.000Z",
      home_team: "Local",
      away_team: "Visitante",
      bookmakers: [{
        key: "book",
        title: "Book",
        markets: [
          { key: "h2h", outcomes: [{ name: "Local", price: 2.1 }, { name: "Draw", price: 3.2 }, { name: "Visitante", price: 3.6 }] },
          { key: "totals", outcomes: [{ name: "Over", point: 1.5, price: 1.4 }, { name: "Under", point: 1.5, price: 2.9 }, { name: "Over", point: 2.5, price: 2 }, { name: "Under", point: 2.5, price: 1.8 }] },
          { key: "double_chance", outcomes: [{ name: "Local or Draw", price: 1.25 }] },
        ],
      }],
    };
    const result = mapPriceableOdds(event);
    expect(result.matchedMarkets).toEqual(["HOME", "DRAW", "AWAY", "OVER_15", "UNDER_15", "OVER_25", "UNDER_25"]);
    expect(result.quotes.map((quote) => quote.market)).not.toEqual(expect.arrayContaining(["1X", "X2", "12"]));
    expect(result.unsupportedMarketKeys).toContain("double_chance");
  });

  it.each([
    ["HOME", "HOME", 2, 0, "HIT"], ["DRAW", "DRAW", 1, 1, "HIT"], ["AWAY", "AWAY", 0, 1, "HIT"],
    ["1X", "DRAW", 0, 0, "HIT"], ["X2", "AWAY", 0, 1, "HIT"], ["12", "HOME", 1, 0, "HIT"],
    ["OVER_15", "HOME", 1, 1, "HIT"], ["UNDER_15", "DRAW", 0, 0, "HIT"],
    ["OVER_25", "HOME", 2, 1, "HIT"], ["UNDER_25", "AWAY", 0, 2, "HIT"],
    ["HOME", "AWAY", 0, 1, "MISS"], ["12", "DRAW", 1, 1, "MISS"],
  ] as const)("resuelve %s sin reinterpretar el mercado", (market, result1X2, regulationHomeScore, regulationAwayScore, expected) => {
    expect(evaluateOperationalResult(market, { result1X2, regulationHomeScore, regulationAwayScore })).toBe(expected);
  });

  it("conserva PENDING/VOID y calcula rendimiento solo sobre resultados válidos", () => {
    expect(evaluateOperationalResult("HOME", null)).toBe("PENDING");
    expect(evaluateOperationalResult("HOME", { result1X2: "HOME", regulationHomeScore: 1, regulationAwayScore: 0, void: true })).toBe("VOID");
    const records: PerformanceRecord[] = [
      { market: "HOME", category: "MODEL_REVIEW", probability: 0.7, frozenOdds: 2, validPrematchOdds: true, status: "HIT" },
      { market: "HOME", category: "MODEL_REVIEW", probability: 0.6, frozenOdds: 2.1, validPrematchOdds: true, status: "MISS" },
      { market: "OVER_25", category: "WATCH", probability: 0.55, frozenOdds: null, validPrematchOdds: false, status: "PENDING" },
      { market: "OVER_25", category: "WATCH", probability: 0.5, frozenOdds: 1.9, validPrematchOdds: true, status: "VOID" },
    ];
    expect(summarizePerformance(records)).toMatchObject({ sample: 4, pending: 1, resolved: 2, hits: 1, misses: 1, void: 1, hitRate: 0.5, pricedSample: 3, pricedNetUnits: 0, calibrationStatus: "BOOTSTRAP" });
    expect(groupPerformance(records, "market").map((group) => group.key)).toEqual(["HOME", "OVER_25"]);
    expect(groupPerformance(records, "category").map((group) => group.key)).toEqual(["MODEL_REVIEW", "WATCH"]);
  });

  it("expone historial/rendimiento y mantiene el replay offline sin clientes de red", async () => {
    const [page, navigation, daily, history, performance, replay, migration] = await Promise.all([
      readFile("src/app/[section]/page.tsx", "utf8"),
      readFile("src/components/navigation.tsx", "utf8"),
      readFile("src/components/daily-ranking-status.tsx", "utf8"),
      readFile("src/components/operational-history-status.tsx", "utf8"),
      readFile("src/components/operational-performance-status.tsx", "utf8"),
      readFile("scripts/market-v2-automatic-replay.ts", "utf8"),
      readFile("prisma/migrations/20260803190000_add_daily_next_day_ranking/migration.sql", "utf8"),
    ]);
    expect(page).toContain('section === "historial"');
    expect(page).toContain('section === "rendimiento"');
    expect(navigation).toContain('["Historial","/historial"]');
    expect(navigation).toContain('["Rendimiento","/rendimiento"]');
    expect([daily, history, performance].join("\n")).toContain("sportsDateInAsuncion");
    expect(history).toContain("recommendation.market");
    expect(history).toContain("evaluateOperationalResult");
    expect(performance).toContain("groupPerformance");
    expect(replay).toContain("NETWORK_CALLS: 0");
    expect(replay).not.toMatch(/fetch\s*\(|axios|createApiFootball|createTheOddsApi/iu);
    expect(migration).toContain('CREATE TRIGGER "DailyAnalysisRun_no_update"');
    expect(migration).toContain('CREATE TRIGGER "DailyAnalysisRun_no_delete"');
    expect([daily, history, performance, replay].join("\n")).not.toMatch(/API_FOOTBALL_KEY|THE_ODDS_API_KEY|process\.env/iu);
  });
});
