import type { DiscoveredFixture } from "./daily-analysis";

export const ODDS_ACQUISITION_POLICY = Object.freeze({
  version: "odds-acquisition/fixture-sports-v1",
  maximumRequestsPerRun: 3,
  kickoffPaddingMinutes: 20,
  groupedSportKeysSupported: false,
  polling: false,
});

type CoverageRule = Readonly<{
  competition: RegExp;
  country?: RegExp;
  sportKey: `soccer_${string}`;
}>;

const COVERAGE_RULES: readonly CoverageRule[] = Object.freeze([
  { competition: /^UEFA Champions League Women$/iu, sportKey: "soccer_uefa_champs_league_women" },
  { competition: /^UEFA Champions League$/iu, sportKey: "soccer_uefa_champs_league" },
  { competition: /^UEFA Europa League$/iu, sportKey: "soccer_uefa_europa_league" },
  { competition: /^Premier League$/iu, country: /^England$/iu, sportKey: "soccer_epl" },
  { competition: /^(La Liga|Primera Division)$/iu, country: /^Spain$/iu, sportKey: "soccer_spain_la_liga" },
  { competition: /^Bundesliga$/iu, country: /^Germany$/iu, sportKey: "soccer_germany_bundesliga" },
  { competition: /^Serie A$/iu, country: /^Italy$/iu, sportKey: "soccer_italy_serie_a" },
  { competition: /^Ligue 1$/iu, country: /^France$/iu, sportKey: "soccer_france_ligue_one" },
  { competition: /^(Major League Soccer|MLS)$/iu, country: /^(USA|United States)$/iu, sportKey: "soccer_usa_mls" },
  { competition: /^Liga MX$/iu, country: /^Mexico$/iu, sportKey: "soccer_mexico_ligamx" },
  { competition: /^(Primera Division|Liga Profesional)$/iu, country: /^Argentina$/iu, sportKey: "soccer_argentina_primera_division" },
]);

export type OddsCoverageDiagnostic = Readonly<{
  fixtureId: string;
  country: string;
  competition: string;
  kickoffAtUtc: string;
  sportKey: `soccer_${string}` | null;
  status: "COVERED" | "ODDS_COMPETITION_NOT_COVERED" | "ODDS_SPORT_KEY_BUDGET_EXCEEDED";
  policyVersion: string;
}>;

export type OddsSportRequest = Readonly<{
  sportKey: `soccer_${string}`;
  commenceTimeFrom: string;
  commenceTimeTo: string;
  fixtureIds: readonly string[];
}>;

export type OddsAcquisitionSelection = Readonly<{
  requests: readonly OddsSportRequest[];
  diagnostics: readonly OddsCoverageDiagnostic[];
  requestBudget: number;
}>;

export function resolveOddsSportKey(fixture: Pick<DiscoveredFixture, "competitionName" | "country">): `soccer_${string}` | null {
  const rule = COVERAGE_RULES.find((candidate) => candidate.competition.test(fixture.competitionName.trim()) && (!candidate.country || candidate.country.test(fixture.country.trim())));
  return rule?.sportKey ?? null;
}

export function selectOddsAcquisition(fixtures: readonly DiscoveredFixture[]): OddsAcquisitionSelection {
  const resolved = fixtures.map((fixture) => ({ fixture, sportKey: resolveOddsSportKey(fixture) }));
  const requestedKeys = [...new Set(resolved.flatMap((item) => item.sportKey ? [item.sportKey] : []))].sort();
  const allowedKeys = new Set(requestedKeys.slice(0, ODDS_ACQUISITION_POLICY.maximumRequestsPerRun));
  const diagnostics: OddsCoverageDiagnostic[] = resolved.map(({ fixture, sportKey }) => Object.freeze({
    fixtureId: fixture.providerFixtureId,
    country: fixture.country,
    competition: fixture.competitionName,
    kickoffAtUtc: fixture.kickoffAtUtc,
    sportKey,
    status: sportKey === null ? "ODDS_COMPETITION_NOT_COVERED" : allowedKeys.has(sportKey) ? "COVERED" : "ODDS_SPORT_KEY_BUDGET_EXCEEDED",
    policyVersion: ODDS_ACQUISITION_POLICY.version,
  }));
  const requests = [...allowedKeys].map((sportKey): OddsSportRequest => {
    const covered = resolved.filter((item) => item.sportKey === sportKey).map((item) => item.fixture);
    const kickoffValues = covered.map((fixture) => Date.parse(fixture.kickoffAtUtc));
    if (kickoffValues.some((value) => !Number.isFinite(value))) throw new Error("ODDS_FIXTURE_KICKOFF_INVALID");
    const padding = ODDS_ACQUISITION_POLICY.kickoffPaddingMinutes * 60_000;
    return Object.freeze({
      sportKey,
      commenceTimeFrom: new Date(Math.min(...kickoffValues) - padding).toISOString(),
      commenceTimeTo: new Date(Math.max(...kickoffValues) + padding).toISOString(),
      fixtureIds: Object.freeze(covered.map((fixture) => fixture.providerFixtureId).sort()),
    });
  });
  return Object.freeze({ requests: Object.freeze(requests), diagnostics: Object.freeze(diagnostics), requestBudget: ODDS_ACQUISITION_POLICY.maximumRequestsPerRun });
}
