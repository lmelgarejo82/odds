import { FOREBET_ONE_X_HISTORY, forebetRankEvidence } from "@/domain/market-v2/forebet-one-x-history";

const percent = (value: number) => `${(value * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %`;

export function ForebetOneXEvidence({ compact = false }: Readonly<{ compact?: boolean }>) {
  const history = FOREBET_ONE_X_HISTORY;
  return <section className={`forebet-evidence ${compact ? "is-compact" : ""}`} aria-label="Evidencia histórica Forebet 1X">
    <div className="forebet-evidence-heading">
      <div><span className="eyebrow">Referencia histórica · Forebet 1X2</span><h2>{compact ? "Qué respaldo tiene el Top 10" : "La señal histórica que acompaña el análisis"}</h2></div>
      <span className="evidence-period">{history.period.from} → {history.period.to}</span>
    </div>
    <div className="evidence-metrics">
      <article><span>Partidos observados</span><strong>{history.universe.matches.toLocaleString("es-PY")}</strong><small>{history.period.dates} fechas completas</small></article>
      <article className="is-primary"><span>Top 10 resuelto</span><strong>{percent(history.topTen.hitRate)}</strong><small>{history.topTen.hits} aciertos / {history.topTen.settled}</small></article>
      <article><span>Tramo posterior</span><strong>{percent(history.verification.hitRate)}</strong><small>{history.verification.hits}/{history.verification.settled} · intervalo {percent(history.verification.wilsonLower95)}–{percent(history.verification.wilsonUpper95)}</small></article>
      <article><span>Forebet “1” sin ranking</span><strong>{percent(history.allForebetHome.hitRate)}</strong><small>El orden Top 10 aporta la diferencia</small></article>
    </div>
    {!compact && <div className="evidence-reading"><p><strong>Lectura útil:</strong> se ordena por menor riesgo Forebet de victoria visitante. Los puestos 1–3 registraron {percent(history.rankBands.topThree.verificationHitRate)} y los puestos 4–10, {percent(history.rankBands.fourToTen.verificationHitRate)} en el tramo posterior.</p><p><strong>Precio:</strong> {history.minimumConservativeReviewOdds.toLocaleString("es-PY", { minimumFractionDigits: 2 })} es la referencia matemática conservadora para revisar una cuota 1X directa; sin cuota vinculada no se afirma valor.</p></div>}
    <p className="evidence-disclaimer">Backtest retrospectivo de Forebet, no calibración automática de otra fuente ni garantía de rentabilidad. Dataset {history.datasetHash.slice(0, 12)}…</p>
  </section>;
}

export function ForebetRankContext({ rank, comparable }: Readonly<{ rank: number; comparable: boolean }>) {
  const evidence = forebetRankEvidence(rank);
  if (!evidence) return null;
  return <div className={`rank-history ${comparable ? "is-comparable" : "is-reference"}`}>
    <div><span>Histórico Forebet del rango</span><strong>{evidence.label}</strong></div>
    <div><span>Tramo posterior</span><strong>{percent(evidence.verificationHitRate)}</strong><small>{evidence.verificationHits}/{evidence.verificationSettled}</small></div>
    <p>{comparable ? "Misma fuente y criterio: referencia comparable." : "Referencia informativa: la predicción actual procede de otra fuente."}</p>
  </div>;
}
