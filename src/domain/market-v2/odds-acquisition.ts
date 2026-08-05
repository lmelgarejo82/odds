import type { DiscoveredFixture } from "./daily-analysis";

export const ODDS_ACQUISITION_POLICY = Object.freeze({
  version: "odds-acquisition/capability-gated-v2",
  maximumRequestsPerRun: 3,
  kickoffPaddingMinutes: 20,
  groupedSportKeysSupported: false,
  polling: false,
});

export type OddsCapabilityView = Readonly<{ sportKey: string; catalogActive: boolean; h2hStatus: "UNKNOWN" | "SUPPORTED" | "UNSUPPORTED" | "TEMPORARILY_EMPTY"; totalsStatus: "UNKNOWN" | "SUPPORTED" | "UNSUPPORTED" | "TEMPORARILY_EMPTY" }>;

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
  regions: readonly ["eu"];
  markets: readonly ("h2h" | "totals")[];
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

export function selectOddsAcquisition(fixtures: readonly DiscoveredFixture[], capabilities: readonly OddsCapabilityView[] = []): OddsAcquisitionSelection {
  const resolved = fixtures.map((fixture) => ({ fixture, sportKey: resolveOddsSportKey(fixture) }));
  const capabilityByKey = new Map(capabilities.map((item) => [item.sportKey, item]));
  const requestedKeys = [...new Set(resolved.flatMap((item) => { const capability = item.sportKey ? capabilityByKey.get(item.sportKey) : null; return item.sportKey && capability?.catalogActive && capability.h2hStatus === "SUPPORTED" ? [item.sportKey] : []; }))].sort();
  const allowedKeys = new Set(requestedKeys.slice(0, ODDS_ACQUISITION_POLICY.maximumRequestsPerRun));
  const diagnostics: OddsCoverageDiagnostic[] = resolved.map(({ fixture, sportKey }) => Object.freeze({
    fixtureId: fixture.providerFixtureId,
    country: fixture.country,
    competition: fixture.competitionName,
    kickoffAtUtc: fixture.kickoffAtUtc,
    sportKey,
    status: sportKey === null || !capabilityByKey.get(sportKey)?.catalogActive || capabilityByKey.get(sportKey)?.h2hStatus !== "SUPPORTED" ? "ODDS_COMPETITION_NOT_COVERED" : allowedKeys.has(sportKey) ? "COVERED" : "ODDS_SPORT_KEY_BUDGET_EXCEEDED",
    policyVersion: ODDS_ACQUISITION_POLICY.version,
  }));
  const requests = [...allowedKeys].map((sportKey): OddsSportRequest => {
    const covered = resolved.filter((item) => item.sportKey === sportKey).map((item) => item.fixture);
    const kickoffValues = covered.map((fixture) => Date.parse(fixture.kickoffAtUtc));
    if (kickoffValues.some((value) => !Number.isFinite(value))) throw new Error("ODDS_FIXTURE_KICKOFF_INVALID");
    const padding = ODDS_ACQUISITION_POLICY.kickoffPaddingMinutes * 60_000;
    const markets: ("h2h" | "totals")[] = ["h2h"];
    if (capabilityByKey.get(sportKey)?.totalsStatus === "SUPPORTED") markets.push("totals");
    return Object.freeze({
      sportKey,
      commenceTimeFrom: new Date(Math.min(...kickoffValues) - padding).toISOString(),
      commenceTimeTo: new Date(Math.max(...kickoffValues) + padding).toISOString(),
      fixtureIds: Object.freeze(covered.map((fixture) => fixture.providerFixtureId).sort()),
      regions: Object.freeze(["eu"] as const),
      markets: Object.freeze(markets),
    });
  });
  return Object.freeze({ requests: Object.freeze(requests), diagnostics: Object.freeze(diagnostics), requestBudget: ODDS_ACQUISITION_POLICY.maximumRequestsPerRun });
}

export function prioritizeDeepFixtures<T extends Readonly<{ fixture: DiscoveredFixture; filter: Readonly<{ quality: number }> }>>(values: readonly T[], capabilities: readonly OddsCapabilityView[], maximum: number): Readonly<{ selected: readonly T[]; reasons: ReadonlyMap<string, "ODDS_COVERAGE_PRIORITY" | "MODEL_ONLY_RESERVED_SLOT" | "NO_VALIDATED_SPORT_KEY"> }> {
  const byKey = new Map(capabilities.map((item) => [item.sportKey, item]));
  const ordered = [...values].sort((left, right) => right.filter.quality - left.filter.quality || left.fixture.kickoffAtUtc.localeCompare(right.fixture.kickoffAtUtc) || left.fixture.providerFixtureId.localeCompare(right.fixture.providerFixtureId));
  const covered = ordered.filter(({ fixture }) => { const key = resolveOddsSportKey(fixture); const capability = key ? byKey.get(key) : null; return Boolean(capability?.catalogActive && capability.h2hStatus === "SUPPORTED"); }).slice(0, Math.min(8, maximum));
  const selectedIds = new Set(covered.map(({ fixture }) => fixture.providerFixtureId));
  const modelOnly = ordered.filter(({ fixture }) => !selectedIds.has(fixture.providerFixtureId)).slice(0, Math.min(2, Math.max(0, maximum - covered.length)));
  const modelIds = new Set(modelOnly.map(({ fixture }) => fixture.providerFixtureId));
  const reasons = new Map<string, "ODDS_COVERAGE_PRIORITY" | "MODEL_ONLY_RESERVED_SLOT" | "NO_VALIDATED_SPORT_KEY">();
  for (const { fixture } of values) reasons.set(fixture.providerFixtureId, selectedIds.has(fixture.providerFixtureId) ? "ODDS_COVERAGE_PRIORITY" : modelIds.has(fixture.providerFixtureId) ? "MODEL_ONLY_RESERVED_SLOT" : "NO_VALIDATED_SPORT_KEY");
  return Object.freeze({ selected: Object.freeze([...covered, ...modelOnly]), reasons });
}
