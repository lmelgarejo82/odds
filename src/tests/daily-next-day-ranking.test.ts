import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { DAILY_SCORING_POLICY, deterministicFixtureMatch, evaluateMarkets, filterFixture, noVig, rankDeterministically, scoreEvaluation, sportsDateD1, type DiscoveredFixture } from "@/domain/market-v2/daily-analysis";
import { DailyRuntimeError, parseDailyArguments, runDaily } from "@/infrastructure/market-v2/daily/runtime";
import { TheOddsApiClient } from "@/infrastructure/market-v2/the-odds-api/client";

const fixture: DiscoveredFixture = { providerFixtureId:"1",providerCompetitionId:"2",providerHomeTeamId:"3",providerAwayTeamId:"4",sportsDate:"2026-08-04",kickoffAtUtc:"2026-08-04T18:00:00.000Z",sourceTimezone:"UTC",status:"NS",season:2026,round:"Regular Season - 1",competitionName:"Primera División",country:"Paraguay",homeName:"Club Olimpia",awayName:"Cerro Porteño" };

describe("motor diario D+1", () => {
  it("calcula D+1 en America/Asuncion incluso cerca del límite UTC", () => expect(sportsDateD1(new Date("2026-08-04T02:30:00.000Z"))).toBe("2026-08-04"));
  it("exige modo de ejecución y presupuestos relacionados", () => {
    expect(() => parseDailyArguments(["--database-url","file:/tmp/x","--evidence-root","/tmp/e","--max-fixtures","10","--deep-candidates","4","--top","2","--dry-run"], new Date("2026-08-03T12:00:00Z"))).not.toThrow();
    expect(() => parseDailyArguments(["--database-url","file:/tmp/x","--evidence-root","/tmp/e","--max-fixtures","2","--deep-candidates","4","--top","2","--dry-run"])).toThrowError("BUDGET_RELATION_INVALID");
  });
  it("filtra status, amistosos, pasado e identidades", () => {
    expect(filterFixture(fixture,new Date("2026-08-03T12:00:00Z")).eligible).toBe(true);
    expect(filterFixture({...fixture,status:"FT"},new Date("2026-08-03T12:00:00Z")).reasonCode).toBe("STATUS_NOT_NS");
    expect(filterFixture({...fixture,competitionName:"International Friendly"},new Date("2026-08-03T12:00:00Z")).reasonCode).toBe("FRIENDLY_EXCLUDED");
    expect(filterFixture({...fixture,kickoffAtUtc:"2026-08-02T12:00:00Z"},new Date("2026-08-03T12:00:00Z")).reasonCode).toBe("KICKOFF_NOT_FUTURE");
  });
  it("hace binding determinista sin fuzzy silencioso", () => {
    expect(deterministicFixtureMatch(fixture,{homeName:"Olimpia",awayName:"Cerro Porteno",kickoffAtUtc:"2026-08-04T18:10:00Z"})).toBe(true);
    expect(deterministicFixtureMatch(fixture,{homeName:"Olimpia Asunción",awayName:"Cerro Porteno",kickoffAtUtc:"2026-08-04T18:10:00Z"})).toBe(false);
  });
  it("calcula no-vig, cuota justa, edge y EV sin inventar odds", () => {
    const normalized=noVig([2,3,4]); expect(normalized.reduce((a,b)=>a+b,0)).toBeCloseTo(1);
    const values=evaluateMarkets({home:.5,draw:.3,away:.2,contextualAgreement:.8,contradictory:false,rawSignals:{}},[{market:"HOME",bookmaker:"A",odds:2.2},{market:"DRAW",bookmaker:"A",odds:3.4},{market:"AWAY",bookmaker:"A",odds:4.5}]);
    const home=values.find((value)=>value.market==="HOME")!; expect(home.fairOdds).toBe(2); expect(home.noVigProbability).toBeCloseTo((1/2.2)/(1/2.2+1/3.4+1/4.5)); expect(home.edge).not.toBeNull(); expect(home.expectedValue).toBeCloseTo(.1); expect(values.find((v)=>v.market==="OVER_25")?.status).toBe("MODEL_UNAVAILABLE");
  });
  it("penaliza el empate 45/45/10 y permite evaluar 1X", () => {
    const markets=evaluateMarkets({home:.45,draw:.45,away:.1,contextualAgreement:.8,contradictory:false,rawSignals:{}},[]); expect(markets.find((v)=>v.market==="1X")?.modelProbability).toBeCloseTo(.9);
    const score=scoreEvaluation({market:"HOME",probability:.45,topMargin:0,dataQuality:1,contextualAgreement:.8,contradictory:false,historicalSample:0,edge:null,expectedValue:null,dispersion:null}); expect(score.penalties).toContain("TIED_TOP"); expect(score.status).toBe("MODEL_ONLY"); expect(score.classification).toBe("PASS");
  });
  it("bloquea full sin histórico validado y explicita provisional", async () => {
    const base=parseDailyArguments(["--sports-date","2026-08-04","--database-url","file:/tmp/unused","--evidence-root","/tmp/unused","--max-fixtures","3","--deep-candidates","2","--top","2","--mode","full","--dry-run"]);
    await expect(runDaily(base)).rejects.toMatchObject({code:"FULL_MODE_REQUIRES_VALIDATED_HISTORY"} satisfies Partial<DailyRuntimeError>);
  });
  it("dry-run es sintético, determinista y hace cero red", async () => {
    const fetchImpl=vi.fn(()=>{throw new Error("network forbidden")}); const args=parseDailyArguments(["--sports-date","2026-08-04","--database-url","file:/tmp/unused","--evidence-root","/tmp/unused","--max-fixtures","3","--deep-candidates","2","--top","2","--mode","provisional","--dry-run"]);
    const first=await runDaily(args,{fetchImpl:fetchImpl as typeof fetch,now:()=>new Date("2026-08-03T12:00:00Z")}); const second=await runDaily(args,{fetchImpl:fetchImpl as typeof fetch,now:()=>new Date("2026-08-03T12:00:00Z")}); expect(fetchImpl).not.toHaveBeenCalled(); expect(first).toEqual(second); expect(first.runMode).toBe("MODEL_ONLY_PROVISIONAL"); expect(first.fixturesExcluded).toBe(1); expect(first.apiFootballRequests).toBe(0); expect(first.apiFootballBudget).toBe(3); expect(first.oddsBudget).toBe(1);
  });
  it("adapter The Odds usa host y operación allowlisted, fetch inyectado y redirect manual", async () => {
    const fetchImpl=vi.fn(async (input: string | URL,init?:RequestInit)=>{expect(new URL(input).origin).toBe("https://api.the-odds-api.com");expect(new URL(input).pathname).toBe("/v4/sports/upcoming/odds/");expect(init?.redirect).toBe("manual");return new Response(JSON.stringify([{id:"e1",commence_time:"2026-08-04T18:00:00Z",home_team:"Olimpia",away_team:"Cerro Porteño",bookmakers:[]}]),{status:200,headers:{"content-type":"application/json"}})});
    const client=new TheOddsApiClient({apiKey:"test-key",fetchImpl:fetchImpl as typeof fetch,clock:{nowUtc:()=>"2026-08-03T12:00:00.000Z"}}); const result=await client.upcoming(); expect(result.events).toHaveLength(1); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("adapter The Odds bloquea redirects", async () => { const client=new TheOddsApiClient({apiKey:"test-key",fetchImpl:vi.fn(async()=>new Response(null,{status:302})) as typeof fetch,clock:{nowUtc:()=>"2026-08-03T12:00:00.000Z"}}); await expect(client.upcoming()).rejects.toThrow("ODDS_REDIRECT_BLOCKED"); });
  it("ordena de forma determinista", () => expect(rankDeterministically([{score:2,kickoffAtUtc:"2026-01-01T12:00:00Z",fixtureId:"b"},{score:2,kickoffAtUtc:"2026-01-01T12:00:00Z",fixtureId:"a"}]).map(x=>x.fixtureId)).toEqual(["a","b"]));
  it("mantiene política versionada 25/25/25/15/10", () => expect(Object.values(DAILY_SCORING_POLICY.weights).reduce((a,b)=>a+b,0)).toBe(100));
  it("publica ruta dinámica es-PY y no expone escritura ni apuestas", async () => {
    const [page,component,schema,migration,script,service,timer,runtime]=await Promise.all([readFile("src/app/[section]/page.tsx","utf8"),readFile("src/components/daily-ranking-status.tsx","utf8"),readFile("prisma/schema.prisma","utf8"),readFile("prisma/migrations/20260803190000_add_daily_next_day_ranking/migration.sql","utf8"),readFile("scripts/market-v2-daily.ts","utf8"),readFile("deploy/systemd/odds-market-v2-daily.service","utf8"),readFile("deploy/systemd/odds-market-v2-daily.timer","utf8"),readFile("src/infrastructure/market-v2/daily/runtime.ts","utf8")]);
    expect(page).toContain('"mejores-partidos"'); expect(page).toContain("await connection()"); expect(component).toContain("PENDING_REVIEW"); expect(component).toContain("Cuota no disponible"); expect(component).not.toMatch(/process\.env|API_FOOTBALL_KEY|THE_ODDS_API_KEY/); for(const model of ["DailyAnalysisRun","DailyFixtureCandidate","DailyMarketEvaluation","DailyRecommendation","DailyExclusion"]) expect(schema).toContain(`model ${model}`); expect(migration).toContain("DailyRecommendation_no_update"); expect(script).toContain('["AUTOMATED_BETTING",false]'); expect(service).toContain("/usr/bin/flock --nonblock"); expect(service).toContain("providers.env"); expect(service).not.toContain("web.env"); expect(timer).toContain("15:30:00 America/Asuncion"); expect(timer).toContain("Persistent=true"); expect(runtime.match(/\.listFixtures\(/gu)).toHaveLength(1); expect(runtime.indexOf("publish({ providerKey: \"api-football\", endpointKey: \"fixtures-by-date\"")).toBeLessThan(runtime.indexOf("mapFixture(row")); expect(runtime).not.toMatch(/bet|stake|kelly/iu);
  });
});
