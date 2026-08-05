import { describe, expect, it, vi } from "vitest";
import { prioritizeDeepFixtures, selectOddsAcquisition, type OddsCapabilityView } from "@/domain/market-v2/odds-acquisition";
import type { DiscoveredFixture } from "@/domain/market-v2/daily-analysis";
import { classifyOddsProviderFailure, TheOddsApiClient, TheOddsApiError } from "@/infrastructure/market-v2/the-odds-api/client";

const KEY = "soccer_uefa_champs_league_women";
const fixture = (id: string, competitionName = "UEFA Champions League Women", country = "World", quality = 1) => ({ fixture: { providerFixtureId: id, providerCompetitionId: "525", providerHomeTeamId: `${id}h`, providerAwayTeamId: `${id}a`, sportsDate: "2026-08-05", kickoffAtUtc: "2026-08-05T08:00:00.000Z", sourceTimezone: "UTC", status: "NS", season: 2026, round: "Round 1", competitionName, country, homeName: `Home ${id}`, awayName: `Away ${id}` } satisfies DiscoveredFixture, filter: { quality } });
const capability = (overrides: Partial<OddsCapabilityView> = {}): OddsCapabilityView => ({ sportKey: KEY, catalogActive: true, h2hStatus: "SUPPORTED", totalsStatus: "UNKNOWN", ...overrides });
const client = (response: Response, apiKey = "synthetic-secret") => new TheOddsApiClient({ apiKey, fetchImpl: vi.fn(async () => response) as typeof fetch, clock: { nowUtc: () => "2026-08-05T08:00:00.000Z" } });

describe("ETAPA 20E: descubrimiento de capacidades y errores 422", () => {
  it.each([[true, "ACTIVE_SUPPORTED"], [false, "INACTIVE_SUPPORTED"]] as const)("captura catálogo con clave active=%s", async (active, expected) => {
    const result = await client(new Response(JSON.stringify([{ key: KEY, group: "Soccer", title: "Women", description: "UEFA Women", active, has_outrights: false }]), { status: 200 })).sportsCatalog();
    const entry = result.sports.find((item) => item.key === KEY); expect(entry ? entry.active ? "ACTIVE_SUPPORTED" : "INACTIVE_SUPPORTED" : "KEY_NOT_PRESENT").toBe(expected); expect(result.request.endpointKey).toBe("sports-catalog");
  });

  it("detecta clave ausente", async () => { const result = await client(new Response("[]", { status: 200 })).sportsCatalog(); expect(result.sports.find((item) => item.key === KEY)).toBeUndefined(); });

  it.each([[1], [0]] as const)("acepta events 200 con %s eventos", async (count) => {
    const body = count ? [{ id: "e1", sport_key: KEY, sport_title: "Women", commence_time: "2026-08-05T08:00:00Z", home_team: "Home", away_team: "Away" }] : [];
    const result = await client(new Response(JSON.stringify(body), { status: 200 })).eventsBySport({ sportKey: KEY, commenceTimeFrom: "2026-08-05T07:40:00Z", commenceTimeTo: "2026-08-05T11:20:00Z" }); expect(result.events).toHaveLength(count);
  });

  it("acepta odds h2h 200 con región eu y un solo mercado", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => { const url = new URL(input); expect(url.searchParams.get("regions")).toBe("eu"); expect(url.searchParams.get("markets")).toBe("h2h"); expect(url.searchParams.get("commenceTimeFrom")).toBe("2026-08-05T07:40:00Z"); expect(url.searchParams.get("commenceTimeTo")).toBe("2026-08-05T11:20:00Z"); return new Response("[]", { status: 200 }); });
    const result = await new TheOddsApiClient({ apiKey: "secret", fetchImpl: fetchImpl as typeof fetch, clock: { nowUtc: () => "2026-08-05T08:00:00.000Z" } }).bySport({ sportKey: KEY, commenceTimeFrom: "2026-08-05T07:40:00Z", commenceTimeTo: "2026-08-05T11:20:00Z", regions: ["eu"], markets: ["h2h"] }); expect(result.events).toHaveLength(0);
  });

  it.each([["INVALID_SPORT", "INVALID_SPORT"], ["INVALID_REGION", "INVALID_REGION"], ["INVALID_MARKET", "INVALID_MARKET"]] as const)("preserva y clasifica 422 %s", async (providerCode, expected) => {
    const secret = "never-persist-this"; const instance = client(new Response(JSON.stringify({ error_code: providerCode, message: `Rejected ${providerCode} ${secret}` }), { status: 422, headers: { "content-type": "application/json", "x-requests-last": "0", "x-request-id": "request-1" } }), secret);
    try { await instance.bySport({ sportKey: KEY, commenceTimeFrom: "2026-08-05T07:40:00Z", commenceTimeTo: "2026-08-05T11:20:00Z", regions: ["eu"], markets: ["h2h"] }); expect.fail("expected error"); } catch (error) { expect(error).toBeInstanceOf(TheOddsApiError); const failure = (error as TheOddsApiError).providerFailure!; expect(classifyOddsProviderFailure(failure)).toBe(expected); const evidence = new TextDecoder().decode(failure.evidenceBytes); expect(evidence).not.toContain(secret); expect(evidence).not.toContain("apiKey"); }
  });

  it("limita mensajes saneados a 2 KB y descarta HTML", async () => {
    const instance = client(new Response(JSON.stringify({ error_code: "INVALID_MARKET", message: "x".repeat(5000) }), { status: 422, headers: { "content-type": "application/json" } }));
    await expect(instance.bySport({ sportKey: KEY, commenceTimeFrom: "2026-08-05T07:40:00Z", commenceTimeTo: "2026-08-05T11:20:00Z" })).rejects.toMatchObject({ providerFailure: { providerErrorMessage: "x".repeat(2048) } });
    const html = client(new Response("<html><body>remote stack</body></html>", { status: 500, headers: { "content-type": "text/html" } }));
    await expect(html.sportsCatalog()).rejects.toMatchObject({ providerFailure: { providerErrorMessage: "HTML_ERROR_BODY_REDACTED" } });
  });

  it("no solicita totals UNKNOWN y sí solicita h2h SUPPORTED", () => {
    const selection = selectOddsAcquisition([fixture("1").fixture], [capability()]); expect(selection.requests).toHaveLength(1); expect(selection.requests[0].markets).toEqual(["h2h"]);
  });

  it("prioriza hasta ocho cubiertos y reserva dos MODEL_ONLY", () => {
    const covered = Array.from({ length: 9 }, (_, index) => fixture(`c${index}`, "UEFA Champions League Women", "World", 1 - index / 100)); const modelOnly = Array.from({ length: 4 }, (_, index) => fixture(`m${index}`, "Friendlies Clubs", "World", .9 - index / 100));
    const result = prioritizeDeepFixtures([...covered, ...modelOnly], [capability()], 10); expect(result.selected.filter((value) => result.reasons.get(value.fixture.providerFixtureId) === "ODDS_COVERAGE_PRIORITY")).toHaveLength(8); expect(result.selected.filter((value) => result.reasons.get(value.fixture.providerFixtureId) === "MODEL_ONLY_RESERVED_SLOT")).toHaveLength(2); expect(result.reasons.get("m2")).toBe("NO_VALIDATED_SPORT_KEY");
  });
});
