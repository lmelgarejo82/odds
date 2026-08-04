import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { calculateProspectiveCalibration, matchAutomaticFixture, normalizeAutomaticTeamName, scoreAutomaticReview, selectAutomaticReview, type AutomaticOddsEvent } from "@/domain/market-v2/automatic-review-v1";
import { evaluateMarkets } from "@/domain/market-v2/daily-analysis";
import { mapPriceableOdds } from "@/domain/market-v2/odds-market-mapping";
import type { OddsApiEvent } from "@/infrastructure/market-v2/the-odds-api/client";

const fixture = { fixtureId: "f1", homeName: "Club Atlético Paraná", awayName: "Deportes Temuco Women", kickoffAtUtc: "2026-08-05T18:00:00.000Z", competitionName: "Primera B", country: "Chile" };
const event = (overrides: Partial<AutomaticOddsEvent> = {}): AutomaticOddsEvent => ({ id: "e1", homeName: "Atletico Parana", awayName: "Deportivo Temuco W", kickoffAtUtc: "2026-08-05T18:10:00.000Z", sportKey: "soccer_chile_primera_b", sportTitle: "Primera B Chile", ...overrides });

describe("automatic review V1", () => {
  it("hace EXACT normalizado con acentos, FC/Club y Women/W", () => expect(matchAutomaticFixture(fixture, [event()])).toMatchObject({ method: "EXACT_NORMALIZED", confidence: 1, matchedEventId: "e1" }));
  it("hace UNIQUE_HIGH_CONFIDENCE con identidad conservadora y contexto", () => expect(matchAutomaticFixture({ ...fixture, homeName: "Central Cordoba de Santiago" }, [event({ homeName: "Central Cordoba SdE" })])).toMatchObject({ method: "UNIQUE_HIGH_CONFIDENCE", matchedEventId: "e1" }));
  it("rechaza dos candidatos, un solo equipo, orientación inversa y kickoff fuera", () => {
    expect(matchAutomaticFixture(fixture, [event(), event({ id: "e2" })]).warnings).toContain("AMBIGUOUS_EVENT");
    expect(matchAutomaticFixture(fixture, [event({ awayName: "Otro equipo" })]).warnings).toContain("ONLY_ONE_TEAM_MATCHED");
    expect(matchAutomaticFixture(fixture, [event({ homeName: fixture.awayName, awayName: fixture.homeName })]).warnings).toContain("ORIENTATION_REVERSED");
    expect(matchAutomaticFixture(fixture, [event({ kickoffAtUtc: "2026-08-05T19:00:00Z" })]).warnings).toContain("KICKOFF_OUTSIDE_TOLERANCE");
  });
  it("normaliza equivalencias autorizadas sin borrar identidad", () => {
    expect(normalizeAutomaticTeamName("Santos Laguna Women FC")).toBe("santos laguna w");
    expect(normalizeAutomaticTeamName("Deportes Copiapó")).toBe("deportivo copiapo");
  });
  it("mapea solo h2h y totals 1.5/2.5; ignora lay, otros puntos y doble oportunidad", () => {
    const odds: OddsApiEvent = { id: "e", commence_time: fixture.kickoffAtUtc, home_team: "Home", away_team: "Away", bookmakers: [{ key: "b", title: "Book", markets: [{ key: "h2h", outcomes: [{ name: "Home", price: 2.2 }, { name: "Draw", price: 3.4 }, { name: "Away", price: 4.5 }] }, { key: "totals", outcomes: [{ name: "Over", point: 1.5, price: 1.5 }, { name: "Under", point: 1.5, price: 2.7 }, { name: "Over", point: 2.5, price: 1.9 }, { name: "Under", point: 2.5, price: 2.1 }, { name: "Over", point: 3.5, price: 1.4 }] }, { key: "h2h_lay", outcomes: [{ name: "Home", price: 2.3 }] }, { key: "double_chance", outcomes: [{ name: "Home or Draw", price: 1.2 }] }] }] };
    const mapped = mapPriceableOdds(odds);
    expect(mapped.matchedMarkets).toEqual(["HOME", "DRAW", "AWAY", "OVER_15", "UNDER_15", "OVER_25", "UNDER_25"]);
    expect(mapped.quotes).toHaveLength(7);
    expect(mapped.unsupportedMarketKeys).toEqual(["double_chance", "h2h_lay"]);
    const values = evaluateMarkets({ home: .5, draw: .3, away: .2, over25: .6, under25: .4, contextualAgreement: .8, contradictory: false, rawSignals: {} }, mapped.quotes);
    const home = values.find((x) => x.market === "HOME")!;
    expect(home.fairOdds).toBe(2); expect(home.noVigProbability).toBeCloseTo((1 / 2.2) / (1 / 2.2 + 1 / 3.4 + 1 / 4.5)); expect(home.edge).toBeCloseTo(.5 - home.noVigProbability!); expect(home.expectedValue).toBeCloseTo(.1);
    expect(values.find((x) => x.market === "1X")).toMatchObject({ bestMarketOdds: null, edge: null, expectedValue: null });
  });
  it("clasifica VALUE, MODEL_REVIEW, WATCH y PASS sin histórico", () => {
    const base = { market: "HOME" as const, modelProbability: .7, topMargin: .3, dataQuality: 1, contextualAgreement: 1, contradictory: false, dispersion: .02 };
    expect(scoreAutomaticReview({ ...base, edge: .12, expectedValue: .15 }).category).toBe("VALUE_DETECTED");
    expect(scoreAutomaticReview({ ...base, edge: null, expectedValue: null }).category).toBe("MODEL_REVIEW");
    expect(scoreAutomaticReview({ ...base, modelProbability: .62, contextualAgreement: .7, edge: .01, expectedValue: .01 }).category).toBe("WATCH");
    expect(scoreAutomaticReview({ ...base, topMargin: 0, edge: null, expectedValue: null }).category).toBe("PASS");
  });
  it("publica máximo cinco y máximo tres VALUE", () => {
    const values = Array.from({ length: 10 }, (_, index) => ({ fixtureId: `f${index}`, category: index < 6 ? "VALUE_DETECTED" as const : "MODEL_REVIEW" as const, score: 90 - index, edge: .05, kickoffAtUtc: `2026-08-05T${String(index + 10).padStart(2, "0")}:00:00Z` }));
    const selected = selectAutomaticReview(values); expect(selected.primary).toHaveLength(5); expect(selected.primary.filter((x) => x.category === "VALUE_DETECTED")).toHaveLength(3);
  });
  it("calibra BOOTSTRAP y EARLY, rechazando resultados sin predicción prospectiva", () => {
    const valid = { market: "HOME" as const, probability: .6, hit: true, predictionCapturedAtUtc: "2026-08-05T10:00:00Z", kickoffAtUtc: "2026-08-05T18:00:00Z", outcomeObservedAtUtc: "2026-08-05T21:00:00Z" };
    expect(calculateProspectiveCalibration([valid])).toMatchObject({ status: "BOOTSTRAP", sample: 1, hits: 1, historicalPoints: 0 });
    expect(calculateProspectiveCalibration(Array.from({ length: 30 }, () => valid))).toMatchObject({ status: "EARLY_CALIBRATION", sample: 30 });
    expect(calculateProspectiveCalibration([{ ...valid, predictionCapturedAtUtc: "2026-08-05T22:00:00Z" }])).toMatchObject({ sample: 0 });
  });
  it("incluye worker append-only, timers, UI y cero automatización de apuestas", async () => {
    const [migration, worker, service, timer, ui] = await Promise.all([readFile("prisma/migrations/20260804090000_automatic_review_v1/migration.sql", "utf8"), readFile("src/infrastructure/market-v2/daily/settle-pending.ts", "utf8"), readFile("deploy/systemd/odds-market-v2-settle.service", "utf8"), readFile("deploy/systemd/odds-market-v2-settle.timer", "utf8"), readFile("src/components/daily-ranking-status.tsx", "utf8")]);
    for (const table of ["DailySettlementRun", "DailySettlementEvidence", "DailyOutcome"]) { expect(migration).toContain(`${table}_no_update`); expect(migration).toContain(`${table}_no_delete`); }
    expect(worker.indexOf("store.publish(")).toBeLessThan(worker.indexOf("mapApiFootballResult(")); expect(worker).toContain("RESULT_NOT_TERMINAL"); expect(worker).toContain("take: args.maxFixtures");
    expect(service).toContain("/usr/bin/flock --nonblock"); expect(timer).toContain("03:30:00 America/Asuncion"); expect(timer).toContain("12:30:00 America/Asuncion"); expect(timer).toContain("Persistent=true");
    expect(ui).toContain("Selecciones automáticas para revisión"); expect(ui).toContain("Estas selecciones no constituyen una apuesta automática ni garantizan resultado."); expect(ui).toContain("slice(0, 5)");
    expect([migration, worker, service, timer, ui].join("\n")).not.toMatch(/placeBet|stakeAmount|kelly/iu);
  });
});
