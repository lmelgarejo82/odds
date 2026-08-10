import Link from "next/link";
import { database } from "@/infrastructure/database";
import { DAILY_LOCALE, DAILY_TIME_ZONE, sportsDateInAsuncion, type DailyMarket } from "@/domain/market-v2/daily-analysis";
import { calculateProspectiveCalibration, type AutomaticCategory, type CalibrationObservation } from "@/domain/market-v2/automatic-review-v1";
import { DailyMarketAnalysis } from "@/components/daily-market-analysis";

const dateTime = new Intl.DateTimeFormat(DAILY_LOCALE, { timeZone: DAILY_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const percent = (value: unknown) => value === null || value === undefined ? "No disponible" : `${(Number(value) * 100).toLocaleString(DAILY_LOCALE, { maximumFractionDigits: 1 })} %`;
const decimal = (value: unknown) => value === null || value === undefined ? "No disponible" : Number(value).toLocaleString(DAILY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const list = (value: string): string[] => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };
const labels: Record<AutomaticCategory, string> = { VALUE_DETECTED: "Valor detectado", MODEL_REVIEW: "Revisión por modelo", WATCH: "Observar", PASS: "Descartar" };
const validCategory = (value: string): AutomaticCategory => value === "VALUE_DETECTED" || value === "MODEL_REVIEW" || value === "WATCH" ? value : "PASS";
const readableAudit: Readonly<Record<string, string>> = Object.freeze({ SIN_COTIZACION_DIRECTA: "Sin cuota directa", CALIBRATION_BOOTSTRAP: "Calibración en construcción", PENDING_REVIEW: "Pendiente de revisión", MODEL_REVIEW: "Revisión por modelo", VALUE_DETECTED: "Valor detectado", WATCH: "Observar", PASS: "Descartado" });
const readable = (value: string) => readableAudit[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("es-PY");

function marketHit(market: string, outcome: Readonly<{ result1X2: string; regulationHomeScore: number; regulationAwayScore: number }>): boolean | null {
  if (market === "HOME" || market === "DRAW" || market === "AWAY") return outcome.result1X2 === market;
  if (market === "1X") return outcome.result1X2 !== "AWAY";
  if (market === "X2") return outcome.result1X2 !== "HOME";
  if (market === "12") return outcome.result1X2 !== "DRAW";
  const total = outcome.regulationHomeScore + outcome.regulationAwayScore;
  if (market === "OVER_15") return total >= 2;
  if (market === "UNDER_15") return total <= 1;
  if (market === "OVER_25") return total > 2.5;
  if (market === "UNDER_25") return total < 2.5;
  return null;
}

export async function DailyRankingStatus() {
  const [run, prospective, capability] = await Promise.all([
    database.dailyAnalysisRun.findFirst({ orderBy: [{ completedAtUtc: "desc" }, { id: "desc" }], include: { requestAudits: true, evidence: true, exclusions: { orderBy: { createdAtUtc: "asc" } }, candidates: { include: { fixture: { include: { homeTeam: true, awayTeam: true } }, evaluations: true, recommendations: { include: { marketEvaluation: true }, orderBy: { rank: "asc" } } } } } }),
    database.dailyRecommendation.findMany({ include: { marketEvaluation: true, candidate: { include: { run: true, fixture: { include: { dailyOutcomes: { orderBy: { observedAtUtc: "desc" }, take: 1 } } } } } } }),
    database.oddsSportCapability.findFirst({ where: { provider: "the-odds-api" }, orderBy: [{ lastValidatedAt: "desc" }, { id: "desc" }] }),
  ]);
  if (!run) return <section className="panel empty-state"><span className="eyebrow">Revisión automática D+1</span><h1>Selecciones automáticas para revisión</h1><p>Aún no existe una ejecución publicada.</p></section>;

  const observations: CalibrationObservation[] = [];
  for (const recommendation of prospective) {
    const outcome = recommendation.candidate.fixture.dailyOutcomes[0];
    const hit = outcome ? marketHit(recommendation.market, outcome) : null;
    const probability = recommendation.marketEvaluation.modelProbability;
    if (sportsDateInAsuncion(recommendation.candidate.fixture.kickoffAtUtc) === recommendation.candidate.run.sportsDate && outcome && hit !== null && probability !== null) observations.push({ market: recommendation.market as DailyMarket, probability: Number(probability), hit, predictionCapturedAtUtc: recommendation.candidate.run.completedAtUtc.toISOString(), kickoffAtUtc: recommendation.candidate.fixture.kickoffAtUtc.toISOString(), outcomeObservedAtUtc: outcome.observedAtUtc.toISOString() });
  }
  const calibration = calculateProspectiveCalibration(observations);
  const localCandidates = run.candidates.filter((candidate) => sportsDateInAsuncion(candidate.fixture.kickoffAtUtc) === run.sportsDate);
  const wrongLocalDateFixtures = run.candidates.length - localCandidates.length;
  const entries = localCandidates.flatMap((candidate) => candidate.recommendations.map((recommendation) => ({ candidate, recommendation, category: validCategory(recommendation.automaticCategory) })));
  const ordered = [...entries].sort((a, b) => {
    const priority: Record<AutomaticCategory, number> = { VALUE_DETECTED: 0, MODEL_REVIEW: 1, WATCH: 2, PASS: 3 };
    return priority[a.category] - priority[b.category] || Number(b.recommendation.scoreTotal) - Number(a.recommendation.scoreTotal) || Number(b.recommendation.marketEvaluation.edge ?? -Infinity) - Number(a.recommendation.marketEvaluation.edge ?? -Infinity) || a.candidate.fixture.kickoffAtUtc.valueOf() - b.candidate.fixture.kickoffAtUtc.valueOf();
  });
  const primary = ordered.filter((x) => x.category !== "PASS").slice(0, 5);
  const primaryIds = new Set(primary.map((entry) => entry.recommendation.id));
  const remaining = ordered.filter((entry) => !primaryIds.has(entry.recommendation.id));
  const providerValidationError = [...run.requestAudits].reverse().find((audit) => audit.providerId === "provider-the-odds-api" && audit.sanitizedErrorCode);
  const oddsMessage = run.usableOddsAvailable ? "Análisis con cuotas reales" : "Análisis de modelo disponible";

  const cards = (values: typeof entries) => values.map(({ candidate, recommendation, category }, index) => {
    const evaluation = recommendation.marketEvaluation;
    const pricedEvaluation = recommendation.bestPricedMarket ? candidate.evaluations.find((item) => item.market === recommendation.bestPricedMarket) : evaluation.bestMarketOdds !== null ? evaluation : null;
    const reasons = list(recommendation.explanationJson), risks = list(recommendation.risksJson);
    const directQuote = pricedEvaluation?.bestMarketOdds !== null && pricedEvaluation?.bestMarketOdds !== undefined;
    return <article className="daily-card" key={recommendation.id}>
      <div className="daily-rank">#{index + 1}</div>
      <div className="daily-match"><span className="daily-country">{candidate.fixture.country}</span><span className="daily-competition">{candidate.fixture.competitionName}</span><h2><span className="team-name">{candidate.fixture.homeTeam.displayName}</span><i>vs.</i><span className="team-name">{candidate.fixture.awayTeam.displayName}</span></h2><small className="daily-kickoff">{dateTime.format(candidate.fixture.kickoffAtUtc)} · hora de Asunción</small></div>
      <div className="daily-market"><span>Señal</span><strong>{labels[category]}</strong><span>Mercado sugerido</span><strong>{recommendation.market}</strong><small>{directQuote ? `Cuota real ${decimal(pricedEvaluation?.bestMarketOdds)}` : "Sin cuota directa"}</small></div>
      <dl className="daily-numbers"><div><dt>Probabilidad</dt><dd>{percent(evaluation.modelProbability)}</dd></div><div><dt>Cuota justa</dt><dd>{decimal(evaluation.fairOdds)}</dd></div><div><dt>Edge</dt><dd>{directQuote ? percent(pricedEvaluation?.edge) : "—"}</dd></div><div><dt>EV</dt><dd>{directQuote ? percent(pricedEvaluation?.expectedValue) : "—"}</dd></div></dl>
      <div className="daily-score"><strong>{Number(recommendation.scoreTotal).toFixed(1)}</strong><span>puntuación</span><small>Revisión manual</small></div>
      <details className="daily-card-audit"><summary>Ver análisis completo</summary><DailyMarketAnalysis evaluations={candidate.evaluations} discarded={category === "PASS"} /><div className="daily-detail"><p><b>Razones:</b> {reasons.length ? reasons.map(readable).join(" · ") : "Revisión automática explicable"}</p><p><b>Riesgos:</b> {risks.length ? risks.map(readable).join(" · ") : "No disponible"}</p><p><b>Histórico propio:</b> muestra {calibration.sample} · {calibration.status === "BOOTSTRAP" ? "Calibración en construcción" : calibration.status}</p><small className="audit-code">Estado congelado: {recommendation.reviewStatus}</small></div></details>
    </article>;
  });

  return <>
    <section className="daily-hero"><div><span className="eyebrow">Agenda analizada · decisión manual</span><h1>Mejores partidos del día</h1><p className="subtitle">Fecha deportiva {run.sportsDate} · {DAILY_TIME_ZONE}</p><p>Hasta diez partidos analizados. Las cuotas enriquecen la señal, pero no limitan el análisis.</p></div><div className="daily-mode"><strong>USABLE V1</strong><small>Actualizado · {dateTime.format(run.completedAtUtc)}</small></div></section>
    <section className="metric-grid daily-metrics">{[["Descubiertos", run.fixturesDiscovered], ["Elegibles", run.fixturesEligible], ["Analizados", run.fixturesDeepAnalyzed], ["Destacados", primary.length], ["Cuotas útiles", run.usableOddsCount]].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="panel daily-availability"><span className="eyebrow">Estado de hoy</span><h2>{oddsMessage}</h2><p>{run.fixturesDeepAnalyzed} partidos tienen análisis profundo. {run.usableOddsAvailable ? "Las señales con precio muestran edge y EV." : "Las señales sin precio se muestran como análisis de modelo, sin afirmar valor."}</p><p className="route-links"><Link href={`/historial?date=${run.sportsDate}`}>Ver historial</Link><Link href="/rendimiento">Ver rendimiento</Link></p><details className="daily-audit"><summary>Ver estado técnico</summary><p>Matcher {run.matcherVersion ?? "odds-matching/automatic-v1"} · eventos de cuotas {run.oddsEventsReceived} · fixtures vinculados {run.oddsFixturesMatched} · mercados cotizados {run.oddsMarketsMatched} · calibración {calibration.status} · fuera de fecha local {wrongLocalDateFixtures}.</p><small className="audit-code">Provider error {capability?.lastProviderErrorCode ?? providerValidationError?.sanitizedErrorCode ?? "NONE"} · sport key {capability?.sportKey ?? "NONE"} · catálogo {capability ? capability.catalogActive ? "activo" : "inactivo" : "no disponible"} · evidencia {capability?.evidenceReference ?? "NONE"}</small></details></section>
    {primary.length === 0 ? <section className="panel daily-warning"><span className="eyebrow">Destacados</span><h2>Sin recomendaciones publicables para esta fecha</h2><p>Los partidos analizados permanecen en observación o sin señal suficiente.</p></section> : <section><div className="section-heading"><div><span className="eyebrow">Máximo cinco</span><h2>Partidos destacados</h2></div></div><div className="daily-list">{cards(primary)}</div></section>}
    {remaining.length > 0 && <section className="daily-secondary"><div className="section-heading"><div><span className="eyebrow">Análisis restante</span><h2>Otros partidos analizados</h2></div><span className="date">{remaining.length} partidos</span></div><div className="daily-compact-list">{remaining.map(({ candidate, recommendation, category }) => <article className="daily-compact-row" key={recommendation.id}><div><strong>{candidate.fixture.homeTeam.displayName} — {candidate.fixture.awayTeam.displayName}</strong><small>{candidate.fixture.competitionName} · {dateTime.format(candidate.fixture.kickoffAtUtc)}</small></div><div><span>Mercado</span><strong>{recommendation.market}</strong></div><div><span>Modelo</span><strong>{percent(recommendation.marketEvaluation.modelProbability)}</strong></div><div><span>Estado</span><strong>{labels[category]}</strong></div></article>)}</div></section>}
    <details className="panel daily-methodology"><summary>Metodología y calibración</summary><p>Muestra propia {calibration.sample} · aciertos {calibration.hits} · fallos {calibration.misses} · hit rate {percent(calibration.hitRate)} · Brier {decimal(calibration.brier)}.</p><p>La calibración sigue {calibration.status === "BOOTSTRAP" ? "en construcción" : calibration.status}. No hay apuestas automáticas ni garantías de resultado. Edge y EV solo aparecen con una cuota real vinculada.</p><small>Scoring {run.scoringPolicyVersion} · selección {run.selectionPolicyVersion} · FULL, STRONG e INTERESTING deshabilitados sin calibración suficiente.</small></details>
    {run.exclusions.length > 0 && <details className="panel daily-exclusions"><summary>No elegibles ({run.exclusions.length})</summary>{run.exclusions.map((exclusion) => <p key={exclusion.id}><strong>{exclusion.fixtureLabel}</strong> · {exclusion.reasonCode.replaceAll("_", " ")}</p>)}</details>}
  </>;
}
