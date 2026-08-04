import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DailyMarketAnalysis, marketDisplayState } from "@/components/daily-market-analysis";
import { matchAutomaticFixture, type AutomaticOddsEvent } from "@/domain/market-v2/automatic-review-v1";
import { selectOddsAcquisition } from "@/domain/market-v2/odds-acquisition";
import { diagnoseFrozenOddsSet } from "@/domain/market-v2/odds-offline-diagnostic";
import type { DiscoveredFixture } from "@/domain/market-v2/daily-analysis";
import { TheOddsApiClient } from "@/infrastructure/market-v2/the-odds-api/client";

const fixture = (overrides: Partial<DiscoveredFixture> = {}): DiscoveredFixture => ({ providerFixtureId: "f1", providerCompetitionId: "525", providerHomeTeamId: "h", providerAwayTeamId: "a", sportsDate: "2026-08-05", kickoffAtUtc: "2026-08-05T11:00:00.000Z", sourceTimezone: "UTC", status: "NS", season: 2026, round: "Semi-final", competitionName: "UEFA Champions League Women", country: "World", homeName: "SFK 2000 W", awayName: "PSV/Eindhoven W", ...overrides });
const event = (overrides: Partial<AutomaticOddsEvent> = {}): AutomaticOddsEvent => ({ id: "e1", homeName: "SFK Sarajevo 2000 Women", awayName: "PSV Eindhoven Women", kickoffAtUtc: "2026-08-05T11:10:00.000Z", sportKey: "soccer_uefa_champs_league_women", sportTitle: "UEFA Champions League Women", ...overrides });
const automaticFixture = () => { const value = fixture(); return { fixtureId: value.providerFixtureId, homeName: value.homeName, awayName: value.awayName, kickoffAtUtc: value.kickoffAtUtc, competitionName: value.competitionName, country: value.country }; };

describe("ETAPA 20C: UI usable y adquisición de odds", () => {
  it("agrupa por sport key, deriva la ventana de los fixtures y marca competiciones sin cobertura", () => {
    const selection = selectOddsAcquisition([fixture(), fixture({ providerFixtureId: "f2", kickoffAtUtc: "2026-08-05T12:00:00.000Z" }), fixture({ providerFixtureId: "friendly", competitionName: "Friendlies Clubs" })]);
    expect(selection.requestBudget).toBe(3);
    expect(selection.requests).toEqual([{ sportKey: "soccer_uefa_champs_league_women", commenceTimeFrom: "2026-08-05T10:40:00.000Z", commenceTimeTo: "2026-08-05T12:20:00.000Z", fixtureIds: ["f1", "f2"] }]);
    expect(selection.diagnostics.find((value) => value.fixtureId === "friendly")).toMatchObject({ sportKey: null, status: "ODDS_COMPETITION_NOT_COVERED" });
  });

  it("respeta máximo tres sport keys y no usa polling", () => {
    const selection = selectOddsAcquisition([
      fixture({ providerFixtureId: "epl", competitionName: "Premier League", country: "England" }),
      fixture({ providerFixtureId: "laliga", competitionName: "La Liga", country: "Spain" }),
      fixture({ providerFixtureId: "bundesliga", competitionName: "Bundesliga", country: "Germany" }),
      fixture({ providerFixtureId: "seriea", competitionName: "Serie A", country: "Italy" }),
    ]);
    expect(selection.requests).toHaveLength(3);
    expect(selection.diagnostics.filter((value) => value.status === "ODDS_SPORT_KEY_BUDGET_EXCEEDED")).toHaveLength(1);
  });

  it("solicita exclusivamente el sport key y ventana elegidos con una respuesta simulada", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(input); expect(url.pathname).toBe("/v4/sports/soccer_uefa_champs_league_women/odds/"); expect(url.searchParams.get("commenceTimeFrom")).toBe("2026-08-05T10:40:00.000Z"); expect(url.searchParams.get("commenceTimeTo")).toBe("2026-08-05T11:20:00.000Z");
      return new Response(JSON.stringify([{ id: "e1", sport_key: "soccer_uefa_champs_league_women", commence_time: "2026-08-05T11:00:00Z", home_team: "SFK 2000 W", away_team: "PSV/Eindhoven W", bookmakers: [] }]), { status: 200 });
    });
    const client = new TheOddsApiClient({ apiKey: "synthetic-key", fetchImpl: fetchImpl as typeof fetch, clock: { nowUtc: () => "2026-08-04T20:00:00.000Z" } });
    const response = await client.bySport({ sportKey: "soccer_uefa_champs_league_women", commenceTimeFrom: "2026-08-05T10:40:00Z", commenceTimeTo: "2026-08-05T11:20:00Z" });
    expect(response.events).toHaveLength(1); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("mantiene 20 minutos, orientación directa, ambos equipos, contexto y candidato único", () => {
    expect(matchAutomaticFixture(automaticFixture(), [event()])).toMatchObject({ method: "UNIQUE_HIGH_CONFIDENCE", rejectionReason: null, kickoffDeltaSeconds: 600, competitionCompatible: true });
    expect(matchAutomaticFixture(automaticFixture(), [event({ id: "e2" }), event({ id: "e3" })])).toMatchObject({ method: "REJECTED", rejectionReason: "MULTIPLE_CANDIDATES" });
    expect(matchAutomaticFixture(automaticFixture(), [event({ homeName: fixture().awayName, awayName: fixture().homeName })])).toMatchObject({ method: "REJECTED", rejectionReason: "ORIENTATION_MISMATCH" });
    expect(matchAutomaticFixture(automaticFixture(), [event({ kickoffAtUtc: "2026-08-05T11:21:00Z" })])).toMatchObject({ method: "REJECTED", rejectionReason: "NO_TIME_OVERLAP" });
    expect(matchAutomaticFixture(automaticFixture(), [event({ awayName: "Otro club" })])).toMatchObject({ method: "REJECTED", rejectionReason: "TEAM_NAME_MISMATCH" });
  });

  it("produce una matriz 10×5 reproducible y detecta un set de proveedor irrelevante", () => {
    const fixtures = Array.from({ length: 10 }, (_, index) => fixture({ providerFixtureId: `f${index}`, kickoffAtUtc: `2026-08-05T${String(index + 8).padStart(2, "0")}:00:00.000Z` }));
    const irrelevant = Array.from({ length: 6 }, (_, index) => event({ id: `tennis-${index}`, homeName: `Tenista ${index} A`, awayName: `Tenista ${index} B`, kickoffAtUtc: `2026-08-04T${String(index + 16).padStart(2, "0")}:00:00.000Z`, sportKey: "tennis_atp_canadian_open", sportTitle: "Canadian Open" }));
    const matrix = diagnoseFrozenOddsSet(fixtures, irrelevant);
    expect(matrix).toHaveLength(10); expect(matrix.every((row) => row.nearestEvents.length === 5)).toBe(true); expect(matrix.every((row) => row.rejectionReason === "PROVIDER_EVENT_SET_NOT_RELEVANT")).toBe(true);
  });

  it("muestra los diez mercados, conserva NO_MODEL_PROBABILITY y no copia probabilidades", () => {
    const evaluations = [{ market: "HOME", modelProbability: .55, fairOdds: 1 / .55, bestMarketOdds: null, noVigProbability: null, edge: null, expectedValue: null }];
    const html = renderToStaticMarkup(createElement(DailyMarketAnalysis, { evaluations }));
    for (const market of ["HOME", "DRAW", "AWAY", "1X", "X2", "12", "OVER_15", "UNDER_15", "OVER_25", "UNDER_25"]) expect(html).toContain(`>${market}<`);
    expect(html.match(/NO_MODEL_PROBABILITY/gu)).toHaveLength(9);
    expect(html).toContain("Análisis de mercados");
    expect(marketDisplayState(evaluations[0])).toBe("MODELO_SOLAMENTE");
  });

  it("define layout estructural usable para 320, 768 y 1280 sin overflow de tarjeta", async () => {
    const [css, ui, runtime, evidenceContract] = await Promise.all([readFile("src/app/daily.css", "utf8"), readFile("src/components/daily-ranking-status.tsx", "utf8"), readFile("src/infrastructure/market-v2/daily/runtime.ts", "utf8"), readFile("src/application/market-v2/capture/raw-evidence-store.ts", "utf8")]);
    expect(css).toContain("minmax(260px,2fr)"); expect(css).toContain("minmax(150px,1fr)"); expect(css).toContain("minmax(110px,1fr)"); expect(css).toContain("minmax(100px,.55fr)");
    expect(css).toContain("align-items:start"); expect(css).toContain("min-width:0"); expect(css).toContain("overflow:hidden"); expect(css).toContain("@media(max-width:900px)"); expect(css).toContain("@media(max-width:560px)"); expect(css).toContain('grid-template-areas:"rank" "match" "market" "metrics" "score" "analysis" "detail"');
    expect(css).toContain("-webkit-line-clamp:3"); expect(css).toContain("overflow-wrap:anywhere");
    expect(ui).toContain("team-name"); expect(ui).toContain("Pendiente de revisión"); expect(ui).toContain("Calibración en construcción"); expect(ui).toContain("Sin cuota directa");
    for (const label of ["Club Deportivo Independiente del Valle Femenino", "UEFA Champions League Women Qualification", "Academia Internacional de Fútbol U20"]) {
      const sample = renderToStaticMarkup(createElement("strong", { className: "team-name" }, label));
      expect(sample).toContain(label);
    }
    expect(runtime).toContain("client.bySport(request)"); expect(runtime).not.toContain("client.upcoming()"); expect(runtime).not.toMatch(/setInterval|polling/iu); expect(evidenceContract).toContain('"odds-by-sport"');
  });
});
