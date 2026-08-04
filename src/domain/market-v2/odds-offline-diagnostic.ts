import { DAILY_LOCALE, DAILY_TIME_ZONE, type DiscoveredFixture } from "./daily-analysis";
import { normalizeAutomaticTeamName, type AutomaticOddsEvent, type AutomaticRejectionReason } from "./automatic-review-v1";
import { resolveOddsSportKey } from "./odds-acquisition";

export type OfflineOddsDiagnosticRow = Readonly<{
  fixtureId: string;
  homeName: string;
  awayName: string;
  kickoffAtUtc: string;
  kickoffAtAsuncion: string;
  competition: string;
  country: string;
  rejectionReason: AutomaticRejectionReason | null;
  nearestEvents: readonly Readonly<{
    eventId: string;
    homeName: string;
    awayName: string;
    kickoffAtUtc: string;
    deltaMinutes: number;
    sportKey: string | null;
  }>[];
}>;

const dateTime = new Intl.DateTimeFormat(DAILY_LOCALE, { timeZone: DAILY_TIME_ZONE, dateStyle: "short", timeStyle: "short", hour12: false });
const compatibleNames = (fixture: DiscoveredFixture, event: AutomaticOddsEvent) => normalizeAutomaticTeamName(fixture.homeName) === normalizeAutomaticTeamName(event.homeName) && normalizeAutomaticTeamName(fixture.awayName) === normalizeAutomaticTeamName(event.awayName);
const reversedNames = (fixture: DiscoveredFixture, event: AutomaticOddsEvent) => normalizeAutomaticTeamName(fixture.homeName) === normalizeAutomaticTeamName(event.awayName) && normalizeAutomaticTeamName(fixture.awayName) === normalizeAutomaticTeamName(event.homeName);

export function diagnoseFrozenOddsSet(fixtures: readonly DiscoveredFixture[], events: readonly AutomaticOddsEvent[]): readonly OfflineOddsDiagnosticRow[] {
  return Object.freeze(fixtures.map((fixture) => {
    const kickoff = Date.parse(fixture.kickoffAtUtc);
    const nearest = events.map((event) => ({ event, deltaMinutes: Math.abs(Date.parse(event.kickoffAtUtc) - kickoff) / 60_000 })).filter((item) => Number.isFinite(item.deltaMinutes)).sort((a, b) => a.deltaMinutes - b.deltaMinutes || a.event.id.localeCompare(b.event.id));
    const within = nearest.filter((item) => item.deltaMinutes <= 20);
    const direct = within.filter((item) => compatibleNames(fixture, item.event));
    const reversed = within.filter((item) => reversedNames(fixture, item.event));
    const expectedSportKey = resolveOddsSportKey(fixture);
    const relevantCompetition = expectedSportKey === null ? [] : events.filter((event) => event.sportKey === expectedSportKey);
    const rejectionReason: AutomaticRejectionReason | null = direct.length > 1 ? "MULTIPLE_CANDIDATES"
      : reversed.length > 0 ? "ORIENTATION_MISMATCH"
      : direct.length === 1 ? null
      : relevantCompetition.length === 0 ? "PROVIDER_EVENT_SET_NOT_RELEVANT"
      : within.length === 0 ? "NO_TIME_OVERLAP"
      : within.some((item) => item.event.sportKey !== expectedSportKey) ? "NO_COMPETITION_OVERLAP"
      : "TEAM_NAME_MISMATCH";
    return Object.freeze({
      fixtureId: fixture.providerFixtureId,
      homeName: fixture.homeName,
      awayName: fixture.awayName,
      kickoffAtUtc: fixture.kickoffAtUtc,
      kickoffAtAsuncion: dateTime.format(new Date(fixture.kickoffAtUtc)),
      competition: fixture.competitionName,
      country: fixture.country,
      rejectionReason,
      nearestEvents: Object.freeze(nearest.slice(0, 5).map(({ event, deltaMinutes }) => Object.freeze({ eventId: event.id, homeName: event.homeName, awayName: event.awayName, kickoffAtUtc: event.kickoffAtUtc, deltaMinutes, sportKey: event.sportKey ?? null }))),
    });
  }));
}
