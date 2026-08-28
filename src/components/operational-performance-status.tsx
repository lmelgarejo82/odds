import { database } from "@/infrastructure/database";
import { sportsDateInAsuncion, type DailyMarket } from "@/domain/market-v2/daily-analysis";
import { evaluateOperationalResult, groupPerformance, selectCanonicalDailyRuns, summarizePerformance, type PerformanceRecord } from "@/domain/market-v2/operational-history";
import { marketLabel } from "@/components/market-labels";
import { ForebetOneXEvidence } from "@/components/forebet-one-x-evidence";
import { FOREBET_ONE_X_HISTORY } from "@/domain/market-v2/forebet-one-x-history";

const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %`;
const decimal = (value: number | null) => value === null ? "—" : value.toLocaleString("es-PY", { maximumFractionDigits: 3 });
const calibrationLabel = Object.freeze({ BOOTSTRAP: "En construcción", EARLY: "Validación temprana", VALIDATED: "Validada" });

export async function OperationalPerformanceStatus() {
  const allRuns = await database.dailyAnalysisRun.findMany({
    where: { candidates: { some: { recommendations: { some: {} } } } },
    select: { id: true, sportsDate: true, completedAtUtc: true, derivedFromRunId: true, fixturesDiscovered: true, fixturesEligible: true, fixturesDeepAnalyzed: true, recommendations: true },
  });
  const canonicalRuns = selectCanonicalDailyRuns(allRuns);
  const recommendations = canonicalRuns.length === 0 ? [] : await database.dailyRecommendation.findMany({
    where: { market: "1X", candidate: { runId: { in: canonicalRuns.map(({ id }) => id) } } },
    include: { marketEvaluation: true, candidate: { include: { run: true, fixture: { include: { dailyOutcomes: { orderBy: { observedAtUtc: "desc" }, take: 1 } } } } } },
    orderBy: { rank: "asc" },
  });
  const unique = new Map<string, (typeof recommendations)[number]>();
  for (const recommendation of recommendations) {
    const key = `${recommendation.candidate.run.sportsDate}:${recommendation.candidate.fixture.id}`;
    if (!unique.has(key)) unique.set(key, recommendation);
  }
  const records: PerformanceRecord[] = [];
  for (const recommendation of unique.values()) {
    const { run, fixture } = recommendation.candidate;
    if (sportsDateInAsuncion(fixture.kickoffAtUtc) !== run.sportsDate || run.completedAtUtc.valueOf() >= fixture.kickoffAtUtc.valueOf()) continue;
    const outcome = fixture.dailyOutcomes[0] ?? null;
    const status = evaluateOperationalResult(recommendation.market as DailyMarket, outcome ? { result1X2: outcome.result1X2 as "HOME" | "DRAW" | "AWAY", regulationHomeScore: outcome.regulationHomeScore, regulationAwayScore: outcome.regulationAwayScore } : null);
    const frozenOdds = recommendation.marketEvaluation.bestMarketOdds === null ? null : Number(recommendation.marketEvaluation.bestMarketOdds);
    records.push({ market: recommendation.market as DailyMarket, category: recommendation.automaticCategory, probability: recommendation.marketEvaluation.modelProbability === null ? null : Number(recommendation.marketEvaluation.modelProbability), frozenOdds, validPrematchOdds: frozenOdds !== null && run.completedAtUtc.valueOf() < fixture.kickoffAtUtc.valueOf(), status });
  }
  const overall = summarizePerformance(records);
  const byMarket = groupPerformance(records, "market");
  const coverage = canonicalRuns.reduce((total, run) => ({ discovered: total.discovered + run.fixturesDiscovered, eligible: total.eligible + run.fixturesEligible, deep: total.deep + run.fixturesDeepAnalyzed, selected: total.selected }), { discovered: 0, eligible: 0, deep: 0, selected: 0 });
  coverage.selected = records.length;
  const technicalRunsExcluded = allRuns.length - canonicalRuns.length;

  return <>
    <section className="product-hero"><div><span className="eyebrow">Estadística Intelligent 1X</span><h1>Rendimiento 1X</h1><p>Solo local o empate, una selección por partido y fecha.</p></div><div className="run-status"><strong>{calibrationLabel[overall.calibrationStatus]}</strong><small>{overall.resolved} resultados 1X resueltos</small></div></section>

    <section className="performance-summary">
      <article><span>Selecciones únicas</span><strong>{overall.sample}</strong><small>{overall.pending} pendientes</small></article>
      <article><span>Aciertos observados</span><strong>{overall.hits}</strong><small>{percent(overall.hitRate)} de las resueltas</small></article>
      <article><span>Error Brier</span><strong>{decimal(overall.brier)}</strong><small>Menor es mejor</small></article>
      <article><span>Con cuota válida</span><strong>{overall.pricedSample}</strong><small>{overall.pricedSample === 0 ? "ROI no disponible" : `${decimal(overall.pricedNetUnits)} unidades`}</small></article>
    </section>

    <ForebetOneXEvidence compact />

    <section className="performance-comparison" aria-label="Comparación entre histórico Forebet y operación actual"><div><span className="eyebrow">Dos muestras, sin mezclarlas</span><h2>Histórico de referencia frente a resultados propios</h2><p>El histórico Forebet sirve para justificar el ranking. La operación real mide si las predicciones publicadas por esta aplicación reproducen esa señal.</p></div><div className="comparison-values"><article><span>Forebet Top 10 histórico</span><strong>{percent(FOREBET_ONE_X_HISTORY.topTen.hitRate)}</strong><small>{FOREBET_ONE_X_HISTORY.topTen.hits}/{FOREBET_ONE_X_HISTORY.topTen.settled} resueltas</small></article><article><span>Aplicación en producción</span><strong>{percent(overall.hitRate)}</strong><small>{overall.hits}/{overall.resolved} resueltas · {overall.pending} pendientes</small></article></div></section>

    <section className="insight-panel"><div><span className="eyebrow">Lectura responsable</span><h2>{overall.resolved < 30 ? "Todavía no hay muestra suficiente para confiar en el porcentaje" : "La muestra ya permite una primera evaluación"}</h2></div><p>El intervalo de acierto al 95 % es {overall.wilsonLower95 === null ? "no disponible" : `${percent(overall.wilsonLower95)}–${percent(overall.wilsonUpper95)}`}. El hit rate describe resultados; no demuestra valor ni rentabilidad, especialmente en mercados con distinta tasa base.</p></section>

    <section className="coverage-section"><div className="section-heading"><div><span className="eyebrow">Embudo de cobertura</span><h2>Qué llega realmente a decisión</h2></div><span className="section-note">{canonicalRuns.length} fechas</span></div><div className="coverage-funnel"><article><strong>{coverage.discovered}</strong><span>Encontrados</span></article><i>→</i><article><strong>{coverage.eligible}</strong><span>Elegibles</span></article><i>→</i><article><strong>{coverage.deep}</strong><span>Analizados</span></article><i>→</i><article><strong>{coverage.selected}</strong><span>Seleccionados</span></article></div></section>

    <section className="market-performance"><div className="section-heading"><div><span className="eyebrow">Métrica única</span><h2>Resultado local o empate</h2></div></div><div className="market-performance-list">{byMarket.map(({ key, summary }) => <article key={key}><div><strong>{marketLabel(key)}</strong><small>{summary.resolved} resueltas · {summary.pending} pendientes</small></div><div><span>Acierto</span><strong>{percent(summary.hitRate)}</strong></div><div><span>Brier</span><strong>{decimal(summary.brier)}</strong></div><div><span>Cuotas</span><strong>{summary.pricedSample || "—"}</strong></div></article>)}</div>{byMarket.length === 0 && <p>Aún no hay selecciones 1X evaluables.</p>}</section>

    <details className="method-detail"><summary>Integridad de la muestra</summary><p>Se eligió la última ejecución primaria de cada fecha. Los runs derivados, replays y selecciones repetidas no se suman al rendimiento principal.</p><p>{technicalRunsExcluded} ejecuciones técnicas quedaron fuera del conteo visible. Se preservan en la base append-only para auditoría.</p><small>Calibración: menos de 30 resueltas = en construcción; 30–99 = temprana; 100 o más = validada. Sin cuota prematch no se calcula retorno.</small></details>
  </>;
}
