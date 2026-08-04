import type { DailyMarket } from "@/domain/market-v2/daily-analysis";

export const DAILY_MARKET_GROUPS = Object.freeze([
  Object.freeze({ label: "1X2", markets: Object.freeze(["HOME", "DRAW", "AWAY"] as const) }),
  Object.freeze({ label: "Doble oportunidad", markets: Object.freeze(["1X", "X2", "12"] as const) }),
  Object.freeze({ label: "Goles", markets: Object.freeze(["OVER_15", "UNDER_15", "OVER_25", "UNDER_25"] as const) }),
]);

type EvaluationView = Readonly<{
  market: string;
  modelProbability: unknown;
  fairOdds: unknown;
  bestMarketOdds: unknown;
  noVigProbability: unknown;
  edge: unknown;
  expectedValue: unknown;
}>;

type MarketState = "MODELO_SOLAMENTE" | "COTIZADO" | "VALOR_POSITIVO" | "DESCARTADO" | "NO_MODEL_PROBABILITY";
const stateLabel: Record<MarketState, string> = { MODELO_SOLAMENTE: "Solo modelo", COTIZADO: "Cotizado", VALOR_POSITIVO: "Valor positivo", DESCARTADO: "Descartado", NO_MODEL_PROBABILITY: "Probabilidad de modelo no disponible" };
const number = (value: unknown): number | null => value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
const percent = (value: unknown) => number(value) === null ? "No disponible" : `${(number(value)! * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %`;
const decimal = (value: unknown) => number(value) === null ? "No disponible" : number(value)!.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function marketDisplayState(evaluation: EvaluationView | null, discarded = false): MarketState {
  if (discarded) return "DESCARTADO";
  if (!evaluation || number(evaluation.modelProbability) === null) return "NO_MODEL_PROBABILITY";
  if (number(evaluation.bestMarketOdds) === null) return "MODELO_SOLAMENTE";
  if ((number(evaluation.edge) ?? 0) > 0 && (number(evaluation.expectedValue) ?? 0) > 0) return "VALOR_POSITIVO";
  return "COTIZADO";
}

export function DailyMarketAnalysis({ evaluations, discarded = false }: Readonly<{ evaluations: readonly EvaluationView[]; discarded?: boolean }>) {
  const byMarket = new Map(evaluations.map((evaluation) => [evaluation.market as DailyMarket, evaluation]));
  return <details className="daily-market-analysis">
    <summary>Análisis de mercados</summary>
    <div className="market-analysis-groups">
      {DAILY_MARKET_GROUPS.map((group) => <section key={group.label} className="market-analysis-group">
        <h3>{group.label}</h3>
        <div className="market-analysis-grid">{group.markets.map((market) => {
          const evaluation = byMarket.get(market) ?? null, state = marketDisplayState(evaluation, discarded);
          return <article className="market-analysis-item" key={market}>
            <header><strong>{market}</strong><span>{stateLabel[state]}</span></header>
            <dl><div><dt>Modelo</dt><dd>{percent(evaluation?.modelProbability)}</dd></div><div><dt>Cuota justa</dt><dd>{decimal(evaluation?.fairOdds)}</dd></div><div><dt>Cuota directa</dt><dd>{decimal(evaluation?.bestMarketOdds)}</dd></div><div><dt>No-vig</dt><dd>{percent(evaluation?.noVigProbability)}</dd></div><div><dt>Edge</dt><dd>{percent(evaluation?.edge)}</dd></div><div><dt>EV</dt><dd>{percent(evaluation?.expectedValue)}</dd></div></dl>
            <small className="audit-code">Auditoría: {state}</small>
          </article>;
        })}</div>
      </section>)}
    </div>
  </details>;
}
