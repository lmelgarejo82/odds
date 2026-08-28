export type OneXPredictionView = Readonly<{
  home: number;
  draw: number;
  away: number;
  winner?: string | null;
  advice?: string | null;
}>;

const percent = (value: number) => `${(value * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %`;

export function OneXPredictionBreakdown({ prediction, source, compact = false }: Readonly<{ prediction: OneXPredictionView; source: string; compact?: boolean }>) {
  const values = [
    { key: "1", label: "Local", value: prediction.home, protected: true },
    { key: "X", label: "Empate", value: prediction.draw, protected: true },
    { key: "2", label: "Visitante", value: prediction.away, protected: false },
  ];
  return <section className={`prediction-breakdown ${compact ? "is-compact" : ""}`} aria-label={`Predicción 1X2 de ${source}`}>
    <header><div><span>Predicción prepartido</span><strong>Distribución 1 · X · 2</strong></div><small>Fuente: {source}</small></header>
    <div className="prediction-probabilities">{values.map((item) => <div className={item.protected ? "is-protected" : "is-risk"} key={item.key}>
      <div><b>{item.key}</b><span>{item.label}</span><strong>{percent(item.value)}</strong></div>
      <i aria-hidden><span style={{ width: `${Math.max(0, Math.min(100, item.value * 100))}%` }} /></i>
    </div>)}</div>
    {!compact && (prediction.winner || prediction.advice) && <div className="provider-reading">
      {prediction.winner && <p><span>Ganador previsto</span><strong>{prediction.winner}</strong></p>}
      {prediction.advice && <p><span>Lectura del proveedor</span><strong>{prediction.advice}</strong></p>}
    </div>}
  </section>;
}
