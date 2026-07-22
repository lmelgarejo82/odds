import { ForebetStatus } from "@/components/forebet-status";
import { StatareaStatus } from "@/components/statarea-status";
import { ReconciliationStatus } from "@/components/reconciliation-status";
import { database } from "@/infrastructure/database";
export const dynamic = "force-dynamic";
const actions = ["Actualizar datos", "Ver mejores partidos", "Seguimiento"];
export default async function Home() {
  const [forebetArtifacts, forebetRows, statareaRows, matched, ambiguous] = await Promise.all([
    database.sourceArtifact.count({ where: { source: "FOREBET" } }),
    database.forebetObservation.count(),
    database.statareaRawRow.count(),
    database.matchDecision.count({ where: { status: "MATCHED" } }),
    database.matchDecision.count({ where: { status: "AMBIGUOUS" } }),
  ]);
  const metrics = [
    ["Artefactos Forebet", forebetArtifacts],
    ["Observaciones Forebet", forebetRows],
    ["Filas raw Statarea", statareaRows],
    ["Emparejados", matched],
    ["Ambiguos", ambiguous],
    ["Reportes históricos", 0],
    ["Rankings diarios", 0],
    ["Seguimientos", 0],
  ] as const;
  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">Investigación independiente · B002</span>
          <h1>Laboratorio Consenso 2.5</h1>
          <p className="subtitle">Análisis experimental Forebet + Statarea</p>
        </div>
        <div className="status">
          <span /> Investigación en borrador
        </div>
      </section>
      <section className="actions" aria-label="Acciones principales">
        {actions.map((action) => (
          <button
            key={action}
            disabled
            title={
              action === "Actualizar datos"
                ? "Use el comando controlado capture:forebet"
                : "Disponible en próximos bloques"
            }
          >
            <strong>{action}</strong>
            <small>
              {action === "Actualizar datos"
                ? "Captura controlada por CLI"
                : "Sin datos disponibles"}
            </small>
          </button>
        ))}
      </section>
      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Estado del laboratorio</span>
            <h2>Resumen operativo</h2>
          </div>
          <span className="date">Zona horaria · America/Asuncion</span>
        </div>
        <div className="metric-grid">
          {metrics.map(([label, value]) => (
            <article className="metric" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </section>
      <ForebetStatus />
      <StatareaStatus />
      <ReconciliationStatus />
      <section className="research-grid">
        <article className="panel">
          <span className="eyebrow">Investigación</span>
          <h2>OU25-CROSS-SOURCE-CONSENSUS</h2>
          <dl>
            <div>
              <dt>Versión</dt>
              <dd>0.1.0</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>DRAFT</dd>
            </div>
            <div>
              <dt>Mercado</dt>
              <dd>Total de goles 2.5</dd>
            </div>
            <div>
              <dt>Fuentes</dt>
              <dd>Forebet + Statarea</dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <span className="eyebrow">Alcance B002</span>
          <h2>Solo captura Forebet</h2>
          <p>
            No hay consenso, ranking, seguimiento ni evaluación de resultados.
            Over y Under se conservan como lados separados.
          </p>
        </article>
      </section>
    </>
  );
}
