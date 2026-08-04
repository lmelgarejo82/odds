import { database } from "@/infrastructure/database";
import { sportsDateInAsuncion, type DailyMarket } from "@/domain/market-v2/daily-analysis";
import { evaluateOperationalResult, groupPerformance, summarizePerformance, type PerformanceRecord, type PerformanceSummary } from "@/domain/market-v2/operational-history";

const percent = (value: number | null) => value === null ? "No disponible" : `${(value * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %`;
const decimal = (value: number | null) => value === null ? "No disponible" : value.toLocaleString("es-PY", { maximumFractionDigits: 3 });

function SummaryCells({ summary }: Readonly<{ summary: PerformanceSummary }>) {
  return <><td>{summary.sample}</td><td>{summary.pending}</td><td>{summary.resolved}</td><td>{summary.hits}</td><td>{summary.misses}</td><td>{summary.void}</td><td>{percent(summary.hitRate)}</td><td>{decimal(summary.brier)}</td><td>{summary.wilsonLower95 === null ? "No disponible" : `${percent(summary.wilsonLower95)}–${percent(summary.wilsonUpper95)}`}</td><td>{summary.pricedSample}</td><td>{decimal(summary.pricedNetUnits)}</td></>;
}

export async function OperationalPerformanceStatus() {
  const recommendations = await database.dailyRecommendation.findMany({ include: { marketEvaluation: true, candidate: { include: { run: true, fixture: { include: { dailyOutcomes: { orderBy: { observedAtUtc: "desc" }, take: 1 } } } } } } });
  const records: PerformanceRecord[] = [];
  for (const recommendation of recommendations) {
    const { run, fixture } = recommendation.candidate;
    if (sportsDateInAsuncion(fixture.kickoffAtUtc) !== run.sportsDate || run.completedAtUtc.valueOf() >= fixture.kickoffAtUtc.valueOf()) continue;
    const outcome = fixture.dailyOutcomes[0] ?? null;
    const status = evaluateOperationalResult(recommendation.market as DailyMarket, outcome ? { result1X2: outcome.result1X2 as "HOME" | "DRAW" | "AWAY", regulationHomeScore: outcome.regulationHomeScore, regulationAwayScore: outcome.regulationAwayScore } : null);
    const frozenOdds = recommendation.marketEvaluation.bestMarketOdds === null ? null : Number(recommendation.marketEvaluation.bestMarketOdds);
    records.push({ market: recommendation.market as DailyMarket, category: recommendation.automaticCategory, probability: recommendation.marketEvaluation.modelProbability === null ? null : Number(recommendation.marketEvaluation.modelProbability), frozenOdds, validPrematchOdds: frozenOdds !== null && run.completedAtUtc.valueOf() < fixture.kickoffAtUtc.valueOf(), status });
  }
  const overall = summarizePerformance(records), byMarket = groupPerformance(records, "market"), byCategory = groupPerformance(records, "category");
  const table = (groups: typeof byMarket) => <div className="history-table-wrap"><table className="operation-table performance-table"><thead><tr><th>Grupo</th><th>Muestra</th><th>Pendientes</th><th>Resueltas</th><th>Aciertos</th><th>Fallos</th><th>Void</th><th>Hit rate</th><th>Brier</th><th>Wilson 95 %</th><th>Con cuota</th><th>Resultado unidades</th></tr></thead><tbody>{groups.map((group) => <tr key={group.key}><th>{group.key.replaceAll("_", " ")}</th><SummaryCells summary={group.summary} /></tr>)}</tbody></table></div>;
  return <>
    <section className="daily-hero"><div><span className="eyebrow">Resultados prospectivos propios</span><h1>Rendimiento</h1><p className="subtitle">Solo predicciones congeladas antes del kickoff y outcomes terminales posteriores.</p></div><div className="daily-mode"><strong>{overall.calibrationStatus}</strong><small>estado de calibración</small></div></section>
    <section className="metric-grid daily-metrics">{[["Muestra", overall.sample], ["Pendientes", overall.pending], ["Resueltas", overall.resolved], ["Aciertos", overall.hits], ["Fallos", overall.misses]].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="panel daily-warning"><h2>Resumen general</h2><p>Hit rate {percent(overall.hitRate)} · Brier {decimal(overall.brier)} · Wilson 95 % {overall.wilsonLower95 === null ? "No disponible" : `${percent(overall.wilsonLower95)}–${percent(overall.wilsonUpper95)}`} · muestra con cuota prematch válida {overall.pricedSample} · resultado {decimal(overall.pricedNetUnits)} unidades.</p></section>
    <section><div className="section-heading"><div><span className="eyebrow">Desglose</span><h2>Por mercado</h2></div></div>{table(byMarket)}</section>
    <section><div className="section-heading"><div><span className="eyebrow">Desglose</span><h2>Por categoría V1</h2></div></div>{table(byCategory)}</section>
    <section className="panel"><span className="eyebrow">Interpretación</span><h2>{overall.calibrationStatus}</h2><p>BOOTSTRAP: menos de 30 resueltas. EARLY: 30–99. VALIDATED: 100 o más. Este panel describe observaciones; no automatiza apuestas ni afirma rentabilidad.</p></section>
  </>;
}
