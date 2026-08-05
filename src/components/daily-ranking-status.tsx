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
  const primary = ordered.filter((x) => x.category === "VALUE_DETECTED" || x.category === "MODEL_REVIEW").slice(0, 5);
  const watch = ordered.filter((x) => x.category === "WATCH");
  const discarded = ordered.filter((x) => x.category === "PASS");
  const oddsResponseReceived = run.oddsResponseReceived || run.requestAudits.some((audit) => audit.classification==="SUCCESS");
  const providerValidationError = [...run.requestAudits].reverse().find((audit) => audit.providerId === "provider-the-odds-api" && audit.sanitizedErrorCode);
  const oddsMessage = run.usableOddsAvailable ? "Cuotas disponibles" : capability?.h2hStatus === "TEMPORARILY_EMPTY" ? "Competición reconocida, sin eventos cotizados" : capability?.h2hStatus === "SUPPORTED" ? "Mercado 1X2 disponible" : providerValidationError ? "Error de validación del proveedor" : capability ? "Competición reconocida, sin eventos cotizados" : oddsResponseReceived ? "Error de validación del proveedor" : "Competición sin mapping de cuotas";

  const cards = (values: typeof entries, showRank: boolean) => values.map(({ candidate, recommendation, category }, index) => {
    const evaluation = recommendation.marketEvaluation;
    const pricedEvaluation = recommendation.bestPricedMarket ? candidate.evaluations.find((item) => item.market === recommendation.bestPricedMarket) : evaluation.bestMarketOdds !== null ? evaluation : null;
    const reasons = list(recommendation.explanationJson), risks = list(recommendation.risksJson);
    const directQuote = pricedEvaluation?.bestMarketOdds !== null && pricedEvaluation?.bestMarketOdds !== undefined;
    return <article className="daily-card" key={recommendation.id}>
      {showRank && <div className="daily-rank">#{index + 1}</div>}
      <div className="daily-match"><span className="daily-country">{candidate.fixture.country}</span><span className="daily-competition">{candidate.fixture.competitionName}</span><h2><span className="team-name">{candidate.fixture.homeTeam.displayName}</span><i>vs.</i><span className="team-name">{candidate.fixture.awayTeam.displayName}</span></h2><small className="daily-kickoff">{dateTime.format(candidate.fixture.kickoffAtUtc)} · hora de Asunción</small></div>
      <div className="daily-market"><span>Categoría V1</span><strong>{labels[category]}</strong><span>Mercado sugerido por modelo</span><strong>{recommendation.market}</strong><span>Mercado cotizado</span><strong>{pricedEvaluation?.market ?? "Sin cuota directa"}</strong><small>{directQuote ? "Cotización directa vinculada" : "Sin cuota directa"}</small><small>Pendiente de revisión</small><small className="audit-code">Auditoría: {recommendation.reviewStatus}</small></div>
      <dl className="daily-numbers"><div><dt>Modelo</dt><dd>{percent(evaluation.modelProbability)}</dd></div><div><dt>Cuota justa modelo</dt><dd>{decimal(evaluation.fairOdds)}</dd></div><div><dt>Mejor cuota real</dt><dd>{decimal(pricedEvaluation?.bestMarketOdds)}</dd></div><div><dt>Mercado sin margen</dt><dd>{percent(pricedEvaluation?.noVigProbability)}</dd></div><div><dt>Edge</dt><dd>{directQuote ? percent(pricedEvaluation?.edge) : "No disponible"}</dd></div><div><dt>EV</dt><dd>{directQuote ? percent(pricedEvaluation?.expectedValue) : "No disponible"}</dd></div><div><dt>Bookmakers</dt><dd>{pricedEvaluation?.bookmakerCount ?? 0}</dd></div></dl>
      <div className="daily-score"><strong>{Number(recommendation.scoreTotal).toFixed(1)}</strong><span>{labels[category]}</span><small>Pendiente de revisión</small></div>
      <DailyMarketAnalysis evaluations={candidate.evaluations} discarded={category === "PASS"} />
      <div className="daily-detail"><p><b>Razones:</b> {reasons.length ? reasons.map(readable).join(" · ") : "Revisión automática explicable"}</p><p><b>Riesgos:</b> {risks.length ? risks.map(readable).join(" · ") : "No disponible"}</p><p><b>Histórico propio:</b> muestra {calibration.sample} · {calibration.status === "BOOTSTRAP" ? "Calibración en construcción" : calibration.status}</p></div>
    </article>;
  });

  return <>
    <section className="daily-hero"><div><span className="eyebrow">Evaluación D+1 · decisión manual</span><h1>Selecciones automáticas para revisión</h1><p className="subtitle">Fecha deportiva {run.sportsDate} · {DAILY_TIME_ZONE}</p><p>Estas selecciones no constituyen una apuesta automática ni garantizan resultado.</p></div><div className="daily-mode"><strong>AUTOMATIC V1</strong><small>Última ejecución · {dateTime.format(run.completedAtUtc)}</small></div></section>
    <section className="metric-grid daily-metrics">{[["Eventos odds", run.oddsEventsReceived], ["Fixtures exactos", run.fixturesMatchedExact], ["Fixtures por alta confianza", run.fixturesMatchedAlias], ["Fixtures no vinculados", run.fixturesUnmatched], ["Mercados cotizados", run.oddsMarketsMatched], ["Cuotas utilizables", run.usableOddsCount]].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="panel daily-warning"><span className="eyebrow">Disponibilidad operativa</span><h2>{oddsMessage}</h2><p>{capability?.h2hStatus === "SUPPORTED" ? "Mercado 1X2 disponible" : "El análisis por modelo continúa sin precio."} · {capability?.totalsStatus === "UNKNOWN" ? "Totales todavía no validados" : `Totales: ${readable(capability?.totalsStatus ?? "UNKNOWN")}`}.</p><p>Matcher {run.matcherVersion ?? "odds-matching/automatic-v1"} · cuotas vinculadas: {run.oddsFixturesMatched} · calibración: {calibration.status} · excluidos de esta vista por fecha local: {wrongLocalDateFixtures}.</p><small className="audit-code">Auditoría: provider error {capability?.lastProviderErrorCode ?? providerValidationError?.sanitizedErrorCode ?? "NONE"} · sport key {capability?.sportKey ?? "NONE"} · catálogo {capability ? capability.catalogActive ? "activo" : "inactivo" : "no disponible"} · evidencia {capability?.evidenceReference ?? "NONE"}</small><p className="route-links"><Link href={`/historial?date=${run.sportsDate}`}>Ver historial</Link><Link href="/rendimiento">Ver rendimiento</Link></p></section>
    {primary.length === 0 ? <section className="panel daily-warning"><span className="eyebrow">Recomendaciones</span><h2>Sin recomendaciones publicables para esta fecha</h2><p>Los candidatos continúan en observación o fueron descartados por riesgo/calidad.</p></section> : <section><div className="section-heading"><div><span className="eyebrow">Recomendaciones · máximo cinco · máximo tres con valor</span><h2>Selecciones automáticas para revisión</h2></div></div><div className="daily-list">{cards(primary, true)}</div></section>}
    <section className="panel daily-warning"><span className="eyebrow">Candidatos provisionales</span><h2>{ordered.filter((entry) => entry.category !== "PASS").length} bajo revisión</h2><p>Ningún candidato se convierte en apuesta automática; su estado permanece congelado en el run.</p></section>
    {watch.length > 0 && <section><div className="section-heading"><div><span className="eyebrow">Señal parcial</span><h2>Observación</h2></div></div><div className="daily-list">{cards(watch, false)}</div></section>}
    <section className="panel"><span className="eyebrow">Calibración prospectiva propia</span><h2>{calibration.status === "BOOTSTRAP" ? "Calibración en construcción" : calibration.status}</h2><p>Muestra {calibration.sample} · aciertos {calibration.hits} · fallos {calibration.misses} · hit rate {percent(calibration.hitRate)} · Brier {decimal(calibration.brier)} · Wilson 95 % {calibration.wilsonLower95 === null ? "No disponible" : `${percent(calibration.wilsonLower95)}–${percent(calibration.wilsonUpper95)}`}.</p><p>FULL, STRONG e INTERESTING permanecen deshabilitados. Solo cuentan predicciones propias congeladas antes del kickoff y outcomes posteriores.</p></section>
    <section className="panel"><span className="eyebrow">Metodología</span><h2>daily-ranking/automatic-v1</h2><p>Pesos 25/25/25/15/10. En bootstrap el histórico puntúa cero. Doble oportunidad muestra probabilidad y cuota justa del modelo, con “Sin cotización directa”; edge y EV permanecen vacíos.</p><small>Compatibilidad de auditoría: Cuota no disponible · Mercado sugerido sin cotización disponible · Mercado cotizado alternativo evaluado · Fixtures por alias sustituidos por alta confianza · Alias aprobados: no requeridos por automatic-v1 · MISSING_HISTORY.</small></section>
    <details className="panel daily-exclusions"><summary>Descartados ({discarded.length + run.exclusions.length})</summary>{discarded.map(({ candidate, recommendation }) => <p key={recommendation.id}><strong>{candidate.fixture.homeTeam.displayName} — {candidate.fixture.awayTeam.displayName}</strong> · Descartar</p>)}{run.exclusions.map((exclusion) => <p key={exclusion.id}><strong>{exclusion.fixtureLabel}</strong> · {exclusion.reasonCode.replaceAll("_", " ")}</p>)}</details>
  </>;
}
