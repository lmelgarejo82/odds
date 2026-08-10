import Link from "next/link";
import { database } from "@/infrastructure/database";
import { DAILY_LOCALE, DAILY_TIME_ZONE, sportsDateInAsuncion, type DailyMarket } from "@/domain/market-v2/daily-analysis";
import { evaluateOperationalResult, selectCanonicalDailyRuns } from "@/domain/market-v2/operational-history";
import { marketLabel } from "@/components/market-labels";
import { AUTOMATIC_DAILY_RANKING_POLICY } from "@/domain/market-v2/automatic-review-v1";

const dateTime = new Intl.DateTimeFormat(DAILY_LOCALE, { timeZone: DAILY_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${(Number(value) * 100).toLocaleString(DAILY_LOCALE, { maximumFractionDigits: 1 })} %`;
const decimal = (value: unknown) => value === null || value === undefined ? "—" : Number(value).toLocaleString(DAILY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const validDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value));
const statusLabel = Object.freeze({ PENDING: "Pendiente", HIT: "Acierto", MISS: "Fallo", VOID: "Anulado" });

export async function OperationalHistoryStatus({ selectedDate }: Readonly<{ selectedDate?: string }>) {
  const allRuns = await database.dailyAnalysisRun.findMany({
    where: { candidates: { some: { recommendations: { some: {} } } } },
    orderBy: [{ sportsDate: "desc" }, { completedAtUtc: "desc" }, { id: "desc" }],
    select: { id: true, sportsDate: true, completedAtUtc: true, derivedFromRunId: true, scoringPolicyVersion: true, selectionPolicyVersion: true, matcherVersion: true },
  });
  const canonicalRuns = selectCanonicalDailyRuns(allRuns);
  if (canonicalRuns.length === 0) return <section className="empty-product"><span className="eyebrow">Historial</span><h1>Todavía no hay resultados</h1><p>Las selecciones aparecerán aquí sin mezclar repeticiones técnicas.</p></section>;
  const dates = canonicalRuns.map(({ sportsDate }) => sportsDate);
  const sportsDate = validDate(selectedDate) && dates.includes(selectedDate) ? selectedDate : dates[0];
  const runHeader = allRuns
    .filter((run) => run.sportsDate === sportsDate && run.scoringPolicyVersion === AUTOMATIC_DAILY_RANKING_POLICY.version)
    .sort((left, right) => right.completedAtUtc.valueOf() - left.completedAtUtc.valueOf())[0]
    ?? canonicalRuns.find((run) => run.sportsDate === sportsDate)!;
  const run = await database.dailyAnalysisRun.findUnique({ where: { id: runHeader.id }, include: { candidates: { orderBy: { discoveryOrdinal: "asc" }, include: { fixture: { include: { homeTeam: true, awayTeam: true, dailyOutcomes: { orderBy: { observedAtUtc: "desc" }, take: 1 } } }, recommendations: { orderBy: { rank: "asc" }, include: { marketEvaluation: true } } } } } });
  if (!run) throw new Error("HISTORY_RUN_NOT_FOUND");
  const rows = run.candidates.filter((candidate) => sportsDateInAsuncion(candidate.fixture.kickoffAtUtc) === run.sportsDate).flatMap((candidate) => candidate.recommendations.filter((recommendation) => recommendation.market === "1X").map((recommendation) => {
    const outcome = candidate.fixture.dailyOutcomes[0] ?? null;
    const status = evaluateOperationalResult(recommendation.market as DailyMarket, outcome ? { result1X2: outcome.result1X2 as "HOME" | "DRAW" | "AWAY", regulationHomeScore: outcome.regulationHomeScore, regulationAwayScore: outcome.regulationAwayScore } : null);
    return { candidate, recommendation, outcome, status };
  }));
  const dateIndex = dates.indexOf(sportsDate), newer = dateIndex > 0 ? dates[dateIndex - 1] : null, older = dateIndex + 1 < dates.length ? dates[dateIndex + 1] : null;
  const technicalRuns = allRuns.filter((item) => item.sportsDate === sportsDate).length;

  return <>
    <section className="product-hero"><div><span className="eyebrow">Registro Intelligent 1X</span><h1>Historial 1X</h1><p>{sportsDate} · {run.derivedFromRunId ? "Revisión offline vigente" : "Ejecución principal"}</p></div><div className="run-status"><strong>{rows.length}</strong> selecciones 1X<small>{technicalRuns - 1} ejecuciones preservadas</small></div></section>
    <nav className="date-navigation" aria-label="Cambiar fecha">{older ? <Link href={`/historial?date=${older}`}>← Anterior</Link> : <span />}
      <form action="/historial"><label><span>Fecha</span><select name="date" defaultValue={sportsDate}>{dates.map((date) => <option key={date}>{date}</option>)}</select></label><button type="submit">Ver fecha</button></form>
      {newer ? <Link href={`/historial?date=${newer}`}>Siguiente →</Link> : <span />}</nav>

    {rows.length === 0 ? <section className="empty-product compact"><h2>Sin selecciones para esta fecha</h2><p>La ejecución se conserva, pero no produjo señales válidas para el día local.</p></section> : <section className="history-list">{rows.map(({ candidate, recommendation, outcome, status }) => <article className="history-card" key={recommendation.id}>
      <div className="history-result"><span className={`result-pill result-${status.toLowerCase()}`}>{statusLabel[status]}</span>{outcome && <strong>{outcome.regulationHomeScore}–{outcome.regulationAwayScore}</strong>}</div>
      <div className="history-match"><small>{candidate.fixture.competitionName}</small><h2>{candidate.fixture.homeTeam.displayName}<i>vs</i>{candidate.fixture.awayTeam.displayName}</h2><time dateTime={candidate.fixture.kickoffAtUtc.toISOString()}>{dateTime.format(candidate.fixture.kickoffAtUtc)}</time></div>
      <div className="history-decision"><span>Lectura</span><strong>{marketLabel(recommendation.market)}</strong><small>Modelo {percent(recommendation.marketEvaluation.modelProbability)} · Cuota {decimal(recommendation.marketEvaluation.bestMarketOdds)}</small></div>
    </article>)}</section>}

    <details className="method-detail"><summary>Detalles de trazabilidad</summary><p>Lectura vigente {dateTime.format(run.completedAtUtc)} · {run.id}. Las {technicalRuns - 1} ejecuciones adicionales de esta fecha se conservan append-only, pero no se duplican en pantalla.</p><small>Política {run.scoringPolicyVersion} · selección {run.selectionPolicyVersion ?? "no disponible"} · matcher {run.matcherVersion ?? "no disponible"}.</small></details>
  </>;
}
