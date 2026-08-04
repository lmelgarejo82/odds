import Link from "next/link";
import { database } from "@/infrastructure/database";
import { DAILY_LOCALE, DAILY_TIME_ZONE, sportsDateInAsuncion, type DailyMarket } from "@/domain/market-v2/daily-analysis";
import { evaluateOperationalResult } from "@/domain/market-v2/operational-history";

const dateTime = new Intl.DateTimeFormat(DAILY_LOCALE, { timeZone: DAILY_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const percent = (value: unknown) => value === null || value === undefined ? "No disponible" : `${(Number(value) * 100).toLocaleString(DAILY_LOCALE, { maximumFractionDigits: 1 })} %`;
const decimal = (value: unknown) => value === null || value === undefined ? "No disponible" : Number(value).toLocaleString(DAILY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const validDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value));

export async function OperationalHistoryStatus({ selectedDate, selectedRun }: Readonly<{ selectedDate?: string; selectedRun?: string }>) {
  const runs = await database.dailyAnalysisRun.findMany({
    where: { candidates: { some: { recommendations: { some: {} } } } },
    orderBy: [{ sportsDate: "desc" }, { completedAtUtc: "desc" }, { id: "desc" }],
    select: { id: true, sportsDate: true, completedAtUtc: true, scoringPolicyVersion: true, selectionPolicyVersion: true, matcherVersion: true },
  });
  if (runs.length === 0) return <section className="panel empty-state"><span className="eyebrow">Historial operativo</span><h1>Historial</h1><p>Aún no existen runs con selecciones congeladas.</p></section>;
  const dates = [...new Set(runs.map((run) => run.sportsDate))];
  const sportsDate = validDate(selectedDate) && dates.includes(selectedDate) ? selectedDate : dates[0];
  const dateRuns = runs.filter((run) => run.sportsDate === sportsDate);
  const runHeader = dateRuns.find((run) => run.id === selectedRun) ?? dateRuns[0];
  const run = await database.dailyAnalysisRun.findUnique({
    where: { id: runHeader.id },
    include: { candidates: { orderBy: { discoveryOrdinal: "asc" }, include: { fixture: { include: { homeTeam: true, awayTeam: true, dailyOutcomes: { orderBy: { observedAtUtc: "desc" }, take: 1 } } }, recommendations: { orderBy: { rank: "asc" }, include: { marketEvaluation: true } } } } },
  });
  if (!run) throw new Error("HISTORY_RUN_NOT_FOUND");
  const rows = run.candidates
    .filter((candidate) => sportsDateInAsuncion(candidate.fixture.kickoffAtUtc) === run.sportsDate)
    .flatMap((candidate) => candidate.recommendations.map((recommendation) => {
      const outcome = candidate.fixture.dailyOutcomes[0] ?? null;
      const status = evaluateOperationalResult(recommendation.market as DailyMarket, outcome ? { result1X2: outcome.result1X2 as "HOME" | "DRAW" | "AWAY", regulationHomeScore: outcome.regulationHomeScore, regulationAwayScore: outcome.regulationAwayScore } : null);
      return { candidate, recommendation, outcome, status };
    }));
  const dateIndex = dates.indexOf(sportsDate), newer = dateIndex > 0 ? dates[dateIndex - 1] : null, older = dateIndex + 1 < dates.length ? dates[dateIndex + 1] : null;

  return <>
    <section className="daily-hero"><div><span className="eyebrow">Registro append-only</span><h1>Historial</h1><p className="subtitle">Fecha deportiva {sportsDate} · America/Asuncion</p></div><div className="daily-mode"><strong>{rows.length}</strong><small>selecciones congeladas</small></div></section>
    <nav className="history-controls" aria-label="Navegación del historial">{older ? <Link href={`/historial?date=${older}`}>← {older}</Link> : <span>Sin fecha anterior</span>}<form action="/historial"><label>Fecha <select name="date" defaultValue={sportsDate}>{dates.map((date) => <option key={date}>{date}</option>)}</select></label><button type="submit">Ver</button></form>{newer ? <Link href={`/historial?date=${newer}`}>{newer} →</Link> : <span>Fecha más reciente</span>}</nav>
    <section className="panel history-run-picker"><span className="eyebrow">Runs de la fecha</span>{dateRuns.map((item) => <Link className={item.id === run.id ? "active" : ""} key={item.id} href={`/historial?date=${sportsDate}&run=${item.id}`}>{dateTime.format(item.completedAtUtc)} · {item.id.slice(0, 12)}</Link>)}</section>
    <section className="panel history-table-wrap"><table className="operation-table"><thead><tr><th>Captura</th><th>Partido</th><th>Kickoff Asunción</th><th>Mercado</th><th>Modelo</th><th>Cuota congelada</th><th>Score</th><th>Categoría</th><th>Resultado</th><th>Estado</th><th>Política</th></tr></thead><tbody>{rows.map(({ candidate, recommendation, outcome, status }) => <tr key={recommendation.id}><td>{dateTime.format(run.completedAtUtc)}</td><td><strong>{candidate.fixture.homeTeam.displayName}</strong><br />{candidate.fixture.awayTeam.displayName}</td><td>{dateTime.format(candidate.fixture.kickoffAtUtc)}</td><td>{recommendation.market}</td><td>{percent(recommendation.marketEvaluation.modelProbability)}</td><td>{decimal(recommendation.marketEvaluation.bestMarketOdds)}</td><td>{Number(recommendation.scoreTotal).toFixed(1)}</td><td>{recommendation.automaticCategory.replaceAll("_", " ")}</td><td>{outcome ? `${outcome.regulationHomeScore}–${outcome.regulationAwayScore}` : "No disponible"}</td><td><span className={`result-pill result-${status.toLowerCase()}`}>{status}</span></td><td>{run.selectionPolicyVersion ?? run.scoringPolicyVersion}<br /><small>{run.matcherVersion ?? "No disponible"}</small></td></tr>)}</tbody></table>{rows.length === 0 && <p>No hay selecciones del día local correcto en este run.</p>}</section>
  </>;
}
