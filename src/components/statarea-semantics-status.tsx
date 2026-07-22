import { database } from "@/infrastructure/database";
import {
  derivedSemanticDefinitions,
  directSemanticDefinitions,
  excludedSemanticDefinitions,
} from "@/domain/statarea-semantics/registry";

type AssessmentSummary = {
  qualityTotals: {
    rows: number;
    ready: number;
    readyWithWarnings: number;
    insufficient: number;
    rejected: number;
  };
  matchedReadiness: {
    total: number;
    discovery: number;
    validation: number;
    ou25SemanticReady: number;
    doubleChanceSemanticReady: number;
    bothReady: number;
    withWarnings: number;
    insufficient: number;
  };
};

const abbreviated = (value: string) => `${value.slice(0, 12)}…`;
const definitionWarnings = new Map(
  [...directSemanticDefinitions, ...derivedSemanticDefinitions, ...excludedSemanticDefinitions]
    .map((definition) => [definition.canonicalField, definition.warnings] as const),
);

export async function StatareaSemanticsStatus() {
  const run = await database.semanticAssessmentRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      dataset: true,
      registry: { include: { definitions: { orderBy: { canonicalField: "asc" } } } },
    },
  });

  if (!run) {
    return (
      <section className="panel empty-state">
        <span className="eyebrow">Semántica y calidad Statarea</span>
        <h1>Registro pendiente</h1>
        <p>Ejecute el assessment offline del dataset congelado para materializar el registro semántico.</p>
      </section>
    );
  }

  const summary = JSON.parse(run.qualitySummaryJson) as AssessmentSummary;
  const { registry } = run;
  const formatter = new Intl.DateTimeFormat("es-PY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Asuncion",
  });

  return (
    <section className="panel semantic-panel">
      <span className="eyebrow">Semántica y calidad Statarea</span>
      <div className="section-heading">
        <div>
          <h1>Porcentajes fuente verificados</h1>
          <p className="semantic-disclaimer">
            Estos valores son porcentajes publicados por Statarea.<br />
            No son probabilidades reales ni calibradas.
          </p>
        </div>
        <span className="status"><span />{registry.evidenceStatus}</span>
      </div>

      <dl className="semantic-metadata">
        <div><dt>Registry</dt><dd>{registry.code} · {registry.version}</dd></div>
        <div><dt>Registry / leyenda</dt><dd>{abbreviated(registry.registryHash)} / {abbreviated(registry.legendSha256)}</dd></div>
        <div><dt>Fuente / presentación</dt><dd>{registry.source} / {registry.sourcePresentation}</dd></div>
        <div><dt>Parser</dt><dd>{registry.parserVersion}</dd></div>
        <div><dt>Dataset</dt><dd>{run.dataset.code} · {run.dataset.version}</dd></div>
        <div><dt>Manifest</dt><dd>{abbreviated(run.manifestHash)}</dd></div>
        <div><dt>Assessment</dt><dd>{run.assessmentVersion} · {run.status}</dd></div>
        <div><dt>Fecha</dt><dd>{formatter.format(run.createdAt)}</dd></div>
      </dl>

      <div className="metric-grid semantic-metrics" aria-label="Calidad total">
        {[
          ["Filas evaluadas", summary.qualityTotals.rows],
          ["Listas", summary.qualityTotals.ready],
          ["Listas con warnings", summary.qualityTotals.readyWithWarnings],
          ["Insuficientes", summary.qualityTotals.insufficient],
          ["Rechazadas", summary.qualityTotals.rejected],
        ].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>

      <h2>Definiciones preparadas para análisis posterior</h2>
      <div className="semantic-formulas">
        <div><strong>Menos 1.5</strong><span>= 100 − Más 1.5</span></div>
        <div><strong>Menos 2.5</strong><span>= 100 − Más 2.5</span></div>
        <div><strong>Menos 3.5</strong><span>= 100 − Más 3.5</span></div>
        <div><strong>1X</strong><span>= 1 + X</span></div>
        <div><strong>X2</strong><span>= X + 2</span></div>
        <div><strong>12</strong><span>= 1 + 2</span></div>
      </div>

      <div className="semantic-table-wrap">
        <table className="semantic-table">
          <caption>Registro inmutable de campos directos, derivados y excluidos</caption>
          <thead><tr><th>Raw</th><th>Campo canónico</th><th>Significado</th><th>Unidad</th><th>Dirección</th><th>Estado</th><th>Evidencia</th><th>Derivación</th><th>Análisis</th><th>Warnings</th></tr></thead>
          <tbody>{registry.definitions.map((definition) => (
            <tr key={definition.id}>
              <td>{definition.rawHeader ?? "—"}</td>
              <td><code>{definition.canonicalField}</code></td>
              <td>{definition.meaning}</td>
              <td>{definition.unit}</td>
              <td>{definition.direction ?? "—"}</td>
              <td>{definition.semanticStatus}</td>
              <td>{definition.evidenceLevel}</td>
              <td>{definition.derivationRule ?? "—"}</td>
              <td>{definition.analysisEnabled ? "Sí" : "No"}</td>
              <td>{definitionWarnings.get(definition.canonicalField)?.join(" · ") || "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h2>Readiness descriptivo</h2>
      <dl className="semantic-metadata">
        <div><dt>Total Legacy</dt><dd>{summary.qualityTotals.rows}</dd></div>
        <div><dt>Discovery / Validation</dt><dd>14 fechas / 7 fechas</dd></div>
        <div><dt>MATCHED</dt><dd>{summary.matchedReadiness.total} · {summary.matchedReadiness.discovery} / {summary.matchedReadiness.validation}</dd></div>
        <div><dt>O/U 2.5 semánticamente listo</dt><dd>{summary.matchedReadiness.ou25SemanticReady}</dd></div>
        <div><dt>Doble oportunidad lista</dt><dd>{summary.matchedReadiness.doubleChanceSemanticReady}</dd></div>
        <div><dt>Ambas capacidades listas</dt><dd>{summary.matchedReadiness.bothReady}</dd></div>
        <div><dt>Con warnings / insuficientes</dt><dd>{summary.matchedReadiness.withWarnings} / {summary.matchedReadiness.insufficient}</dd></div>
      </dl>
      <p className="semantic-note">Readiness indica disponibilidad semántica; no mide rendimiento ni activa mercados.</p>
      <div className="actions semantic-actions">
        <button disabled>Ver mejores partidos</button>
        <button disabled>Top Más 2.5</button>
        <button disabled>Top Menos 2.5</button>
        <button disabled>Seguimiento</button>
      </div>
    </section>
  );
}
