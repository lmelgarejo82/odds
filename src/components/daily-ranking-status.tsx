import Link from "next/link";
import { database } from "@/infrastructure/database";
import { DAILY_LOCALE, DAILY_TIME_ZONE, sportsDateInAsuncion, type DailyMarket } from "@/domain/market-v2/daily-analysis";
import { AUTOMATIC_DAILY_RANKING_POLICY, calculateProspectiveCalibration, type AutomaticCategory, type CalibrationObservation } from "@/domain/market-v2/automatic-review-v1";
import { selectCanonicalDailyRuns } from "@/domain/market-v2/operational-history";
import { assessIntelligentOneX } from "@/domain/market-v2/intelligent-one-x";
import { marketLabel } from "@/components/market-labels";

const dateTime = new Intl.DateTimeFormat(DAILY_LOCALE, { timeZone: DAILY_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const timeOnly = new Intl.DateTimeFormat(DAILY_LOCALE, { timeZone: DAILY_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const percent = (value: unknown) => value === null || value === undefined ? "—" : `${(Number(value) * 100).toLocaleString(DAILY_LOCALE, { maximumFractionDigits: 1 })} %`;
const decimal = (value: unknown) => value === null || value === undefined ? "—" : Number(value).toLocaleString(DAILY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const list = (value: string): string[] => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };
const prediction = (value: string | null): { home: number; draw: number; away: number; winner?: string | null; advice?: string | null } | null => { try { if (!value) return null; const parsed = JSON.parse(value) as Record<string, unknown>; return [parsed.home, parsed.draw, parsed.away].every((item) => typeof item === "number") ? parsed as { home: number; draw: number; away: number; winner?: string | null; advice?: string | null } : null; } catch { return null; } };
const validCategory = (value: string): AutomaticCategory => value === "VALUE_DETECTED" || value === "MODEL_REVIEW" || value === "WATCH" ? value : "PASS";
const categoryLabel: Readonly<Record<AutomaticCategory, string>> = Object.freeze({ VALUE_DETECTED: "Señal con valor", MODEL_REVIEW: "Señal media", WATCH: "En observación", PASS: "Sin señal clara" });
const readableAudit: Readonly<Record<string, string>> = Object.freeze({
  TIED_TOP: "El modelo no separa dos resultados",
  SMALL_MODEL_MARGIN: "La diferencia entre escenarios es pequeña",
  CONTRADICTORY_SIGNALS: "Las señales del proveedor se contradicen",
  SIN_COTIZACION_DIRECTA: "No hay cuota directa verificada",
  CALIBRATION_BOOTSTRAP: "La calibración propia sigue en construcción",
  MODEL_REVIEW: "La lectura del modelo supera el mínimo provisional",
  VALUE_DETECTED: "Existe precio y valor provisional",
  WATCH: "La señal requiere cautela",
  PASS: "No alcanza la calidad mínima",
  ONE_X_ONLY: "El análisis está limitado a local o empate",
  AWAY_CLEARLY_EXCLUDED: "La derrota local queda claramente por debajo",
  WINNER_SUPPORTS_HOME: "La lectura principal favorece al equipo local",
  ADVICE_SUPPORTS_ONE_X: "El proveedor menciona local o empate de forma explícita",
  OVER_15_CONTEXT: "Más de 1,5 goles acompaña la lectura, no sustituye al 1X",
  AWAY_NOT_CLEARLY_EXCLUDED: "La derrota local todavía tiene demasiado peso",
  WINNER_DOES_NOT_SUPPORT_HOME: "La lectura principal no favorece al equipo local",
  ONE_X_NOT_EXPLICIT_IN_ADVICE: "El proveedor no confirma 1X de forma explícita",
});
const readable = (value: string) => readableAudit[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("es-PY");

function marketHit(market: string, outcome: Readonly<{ result1X2: string; regulationHomeScore: number; regulationAwayScore: number }>): boolean | null {
  if (market === "HOME" || market === "DRAW" || market === "AWAY") return outcome.result1X2 === market;
  if (market === "1X") return outcome.result1X2 !== "AWAY";
  if (market === "X2") return outcome.result1X2 !== "HOME";
  if (market === "12") return outcome.result1X2 !== "DRAW";
  const total = outcome.regulationHomeScore + outcome.regulationAwayScore;
  if (market === "OVER_15") return total >= 2;
  if (market === "UNDER_15") return total <= 1;
  if (market === "OVER_25") return total >= 3;
  if (market === "UNDER_25") return total <= 2;
  return null;
}

export async function DailyRankingStatus() {
  const runIdentities = await database.dailyAnalysisRun.findMany({
    where: { candidates: { some: { recommendations: { some: {} } } } },
    select: { id: true, sportsDate: true, completedAtUtc: true, derivedFromRunId: true, scoringPolicyVersion: true },
  });
  const canonicalRuns = selectCanonicalDailyRuns(runIdentities);
  const currentIdentity = [...runIdentities]
    .filter((identity) => identity.scoringPolicyVersion === AUTOMATIC_DAILY_RANKING_POLICY.version)
    .sort((left, right) => right.sportsDate.localeCompare(left.sportsDate) || right.completedAtUtc.valueOf() - left.completedAtUtc.valueOf())[0] ?? canonicalRuns[0];
  if (!currentIdentity) return <section className="empty-product"><span className="eyebrow">Análisis diario</span><h1>Todavía no hay una agenda analizada</h1><p>La primera ejecución se publicará automáticamente a las 10:30, hora de Asunción.</p></section>;

  const [run, prospective, capability] = await Promise.all([
    database.dailyAnalysisRun.findUnique({ where: { id: currentIdentity.id }, include: { requestAudits: true, evidence: true, exclusions: { orderBy: { createdAtUtc: "asc" } }, candidates: { include: { fixture: { include: { homeTeam: true, awayTeam: true } }, evaluations: true, recommendations: { include: { marketEvaluation: true }, orderBy: { rank: "asc" } } } } } }),
    database.dailyRecommendation.findMany({ where: { candidate: { runId: { in: canonicalRuns.map(({ id }) => id) } } }, include: { marketEvaluation: true, candidate: { include: { run: true, fixture: { include: { dailyOutcomes: { orderBy: { observedAtUtc: "desc" }, take: 1 } } } } } } }),
    database.oddsSportCapability.findFirst({ where: { provider: "the-odds-api" }, orderBy: [{ lastValidatedAt: "desc" }, { id: "desc" }] }),
  ]);
  if (!run) throw new Error("DAILY_CANONICAL_RUN_NOT_FOUND");

  const observations: CalibrationObservation[] = [];
  for (const recommendation of prospective) {
    const outcome = recommendation.candidate.fixture.dailyOutcomes[0];
    const hit = outcome ? marketHit(recommendation.market, outcome) : null;
    const probability = recommendation.marketEvaluation.modelProbability;
    if (sportsDateInAsuncion(recommendation.candidate.fixture.kickoffAtUtc) === recommendation.candidate.run.sportsDate && outcome && hit !== null && probability !== null) observations.push({ market: recommendation.market as DailyMarket, probability: Number(probability), hit, predictionCapturedAtUtc: recommendation.candidate.run.completedAtUtc.toISOString(), kickoffAtUtc: recommendation.candidate.fixture.kickoffAtUtc.toISOString(), outcomeObservedAtUtc: outcome.observedAtUtc.toISOString() });
  }
  const calibration = calculateProspectiveCalibration(observations);
  const localCandidates = run.candidates.filter((candidate) => sportsDateInAsuncion(candidate.fixture.kickoffAtUtc) === run.sportsDate);
  const entries = localCandidates.flatMap((candidate) => candidate.recommendations.map((recommendation) => ({ candidate, recommendation, category: validCategory(recommendation.automaticCategory) })));
  const priority: Record<AutomaticCategory, number> = { VALUE_DETECTED: 0, MODEL_REVIEW: 1, WATCH: 2, PASS: 3 };
  const ordered = [...entries].sort((a, b) => priority[a.category] - priority[b.category] || Number(b.recommendation.scoreTotal) - Number(a.recommendation.scoreTotal) || a.candidate.fixture.kickoffAtUtc.valueOf() - b.candidate.fixture.kickoffAtUtc.valueOf());
  const primary = ordered.filter(({ category }) => category !== "PASS").slice(0, 3);
  const primaryIds = new Set(primary.map(({ recommendation }) => recommendation.id));
  const remaining = ordered.filter(({ recommendation }) => !primaryIds.has(recommendation.id));
  const providerValidationError = [...run.requestAudits].reverse().find((audit) => audit.providerId === "provider-the-odds-api" && audit.sanitizedErrorCode);

  return <>
    <section className="product-hero">
      <div><span className="eyebrow">Intelligent 1X · {DAILY_TIME_ZONE}</span><h1>Local o empate</h1><p>{run.sportsDate} · Análisis actualizado a las {timeOnly.format(run.completedAtUtc)}</p></div>
      <div className="run-status"><span className="status-dot" />Automático · 10:30<small>Próximo análisis diario</small></div>
    </section>

    <section className="today-summary" aria-label="Resumen del análisis">
      <article><span>Partidos encontrados</span><strong>{run.fixturesDiscovered}</strong></article>
      <article><span>Análisis profundo</span><strong>{run.fixturesDeepAnalyzed}</strong></article>
      <article><span>Señales 1X claras</span><strong>{primary.length}</strong></article>
      <article><span>Con cuota verificada</span><strong>{run.usableOddsCount}</strong></article>
    </section>

    <section className={`signal-banner ${run.usableOddsAvailable ? "has-price" : "model-only"}`}>
      <div><span className="eyebrow">Solo 1X</span><h2>{run.usableOddsAvailable ? "Local o empate con precio verificable" : "Lectura inteligente de local o empate"}</h2></div>
      <p>{run.usableOddsAvailable ? "El valor y el EV aparecen únicamente con una cuota 1X vinculada al mismo partido." : "Combinamos la probabilidad de local y empate, exigimos que la derrota quede claramente atrás y contrastamos la lectura textual. +1,5 solo aparece como refuerzo contextual explícito."}</p>
    </section>

    {primary.length === 0 ? <section className="empty-product compact"><span className="eyebrow">Resultado de hoy</span><h2>Sin un 1X suficientemente claro</h2><p>El sistema analizó {run.fixturesDeepAnalyzed} partidos, pero en ninguno pudo excluir claramente la derrota local con señales coherentes. Es una abstención útil, no un error.</p></section> : <section className="featured-section"><div className="section-heading"><div><span className="eyebrow">Prioridad 1X</span><h2>{primary.length === 1 ? "La señal más clara" : `Las ${primary.length} señales más claras`}</h2></div><span className="section-note">Máximo tres</span></div><div className="signal-list">{primary.map(({ candidate, recommendation, category }, index) => {
      const evaluation = recommendation.marketEvaluation;
      const pricedEvaluation = recommendation.bestPricedMarket ? candidate.evaluations.find((item) => item.market === recommendation.bestPricedMarket) : evaluation.bestMarketOdds !== null ? evaluation : null;
      const directQuote = pricedEvaluation?.bestMarketOdds !== null && pricedEvaluation?.bestMarketOdds !== undefined;
      const reasons = list(recommendation.explanationJson).map(readable).filter((value) => !/revisión automática explicable/iu.test(value));
      const risks = list(recommendation.risksJson).map(readable);
      const storedPrediction = prediction(candidate.predictionJson);
      const signal = storedPrediction ? assessIntelligentOneX({ homeProbability: storedPrediction.home, drawProbability: storedPrediction.draw, awayProbability: storedPrediction.away, homeName: candidate.fixture.homeTeam.displayName, winnerName: storedPrediction.winner ?? null, advice: storedPrediction.advice ?? null }) : null;
      return <article className="signal-card" key={recommendation.id}>
        <div className="signal-rank">{String(index + 1).padStart(2, "0")}</div>
        <div className="match-context"><span>{candidate.fixture.country} · {candidate.fixture.competitionName}</span><h3>{candidate.fixture.homeTeam.displayName}<i>vs</i>{candidate.fixture.awayTeam.displayName}</h3><time dateTime={candidate.fixture.kickoffAtUtc.toISOString()}>{dateTime.format(candidate.fixture.kickoffAtUtc)}</time></div>
        <div className="decision-block"><span className={`quality-pill quality-${category.toLowerCase()}`}>{categoryLabel[category]}</span><small>Lectura sugerida</small><strong>{marketLabel("1X")}</strong>{signal?.over15Context && <span className="context-pill">+ Más de 1,5 goles</span>}</div>
        <div className="signal-facts"><div><span>Modelo</span><strong>{percent(evaluation.modelProbability)}</strong></div><div><span>Cuota real</span><strong>{directQuote ? decimal(pricedEvaluation?.bestMarketOdds) : "No disponible"}</strong></div><div><span>Valor esperado</span><strong>{directQuote ? percent(pricedEvaluation?.expectedValue) : "No calculable"}</strong></div></div>
        <div className="plain-explanation"><p><b>Por qué:</b> {reasons[0] ?? "Señal provisional consistente"}</p><p><b>Atención:</b> {risks[0] ?? "Muestra propia todavía limitada"}</p></div>
        <details className="technical-detail"><summary>Ver análisis y riesgos</summary><p>Probabilidad 1X: {percent(signal?.probability ?? evaluation.modelProbability)} · separación frente a derrota: {percent(signal?.protectionGap ?? null)}.</p><p>Razones: {reasons.length ? reasons.join(" · ") : "Señal provisional consistente"}</p><p>Riesgos: {risks.length ? risks.join(" · ") : "Muestra propia todavía limitada"}</p></details>
      </article>;
    })}</div></section>}

    {remaining.length > 0 && <details className="secondary-analysis"><summary>Otros {remaining.length} partidos descartados</summary><div className="compact-match-list">{remaining.map(({ candidate, recommendation, category }) => <article key={recommendation.id}><div><strong>{candidate.fixture.homeTeam.displayName} — {candidate.fixture.awayTeam.displayName}</strong><small>{candidate.fixture.competitionName} · {dateTime.format(candidate.fixture.kickoffAtUtc)}</small></div><div><span>{marketLabel("1X")}</span><strong>{categoryLabel[category]}</strong></div></article>)}</div></details>}

    <section className="product-links"><Link href={`/historial?date=${run.sportsDate}`}><span>Revisar resultados</span><strong>Historial →</strong></Link><Link href="/rendimiento"><span>Ver si el modelo mejora</span><strong>Rendimiento →</strong></Link></section>

    <details className="method-detail"><summary>Cómo funciona Intelligent 1X</summary><p>Suma local + empate, exige al menos 75 %, comprueba que ambos escenarios superen claramente a la derrota y rechaza contradicciones. Los amistosos y equipos de desarrollo no participan.</p><p>+1,5 goles nunca se calcula como una combinada ni se recomienda por sí solo: solo se muestra cuando la evidencia textual lo acompaña explícitamente. La muestra canónica contiene {calibration.sample} selecciones resueltas; Brier {decimal(calibration.brier)}.</p><p>No hay apuestas automáticas ni garantías de resultado. Edge y EV solo aparecen con cuota 1X real vinculada.</p><small>Políticas {run.scoringPolicyVersion} · {run.selectionPolicyVersion} · error de cuotas {capability?.lastProviderErrorCode ?? providerValidationError?.sanitizedErrorCode ?? "ninguno"}.</small></details>
  </>;
}
