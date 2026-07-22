import type { ProspectiveFixtureAssessment } from "@/contracts/prospective";
import { database } from "@/infrastructure/database";

type CandidatePayload = {
  id: string;
  family: string;
  marketCode: string;
  signalScore: number;
  historicalEvidenceScore: number;
  dataQualityScore: number;
  finalPriorityScore: number;
  priorityClass: string;
  warnings: string[];
};

const familyLabel: Record<string, string> = { DOUBLE_CHANCE: "Doble oportunidad", OU25: "Más/Menos 2.5", SAME_MATCH_COMBINATION: "Combinación del mismo partido" };

export async function ProspectiveShadowStatus() {
  const run = await database.prospectiveShadowRun.findFirst({ orderBy: { createdAt: "desc" } });
  if (!run) return <section className="panel empty-state"><span className="eyebrow">B009 · modo sombra</span><h2>Ejecución prospectiva pendiente</h2><p>Ejecute el comando controlado para fijar 2026-07-23 antes del comienzo de los partidos.</p></section>;
  const [matchRun, storedCandidates, storedAssessments, quoteRequests] = await Promise.all([
    database.matchRun.findUniqueOrThrow({ where: { id: run.matchRunId } }),
    database.prospectiveCandidateSnapshot.findMany({ where: { prospectiveRunId: run.id } }),
    database.prospectiveFixtureAssessment.findMany({ where: { prospectiveRunId: run.id }, orderBy: { matchDecisionId: "asc" } }),
    database.quoteRequestPlan.findMany({ where: { prospectiveRunId: run.id } }),
  ]);
  const candidates = storedCandidates.map((candidate) => JSON.parse(candidate.payloadJson) as CandidatePayload);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const assessments = storedAssessments.map((assessment) => JSON.parse(assessment.contractJson) as ProspectiveFixtureAssessment);
  const quotesByAssessment = Map.groupBy(quoteRequests, (quote) => quote.fixtureAssessmentId);
  const counts = JSON.parse(run.countsJson) as { selections: Record<string, number> };
  return <section className="panel priority-panel prospective-panel">
    <span className="eyebrow">B009 · sombra · append-only</span>
    <div className="section-heading"><div><h1>Ejecución prospectiva</h1><p>{run.sportsDate.toISOString().slice(0, 10)} · {run.mode} · {run.status}</p></div><span className="date">Congelado {run.frozenAt.toISOString()}</span></div>
    <dl className="semantic-metadata priority-metadata">
      <div><dt>Forebet snapshot</dt><dd><code>{run.forebetSnapshotId}</code></dd></div>
      <div><dt>Statarea Legacy snapshot</dt><dd><code>{run.statareaSnapshotId}</code></dd></div>
      <div><dt>Matcher</dt><dd>{run.matcherVersion}</dd></div>
      <div><dt>Configuración</dt><dd><code>{run.matcherConfigurationHash.slice(0, 16)}…</code></dd></div>
      <div><dt>Registry</dt><dd><code>{run.registryHash.slice(0, 16)}…</code></dd></div>
      <div><dt>Policy</dt><dd><code>{run.priorityPolicyHash.slice(0, 16)}…</code></dd></div>
      <div><dt>Evaluación de resultados</dt><dd>DESHABILITADA</dd></div>
      <div><dt>Evaluación de precio</dt><dd>NO CAPTURADA</dd></div>
    </dl>
    <div className="metric-grid priority-summary">
      <article className="metric"><span>MATCHED</span><strong>{matchRun.matchedCount}</strong></article>
      <article className="metric"><span>AMBIGUOUS</span><strong>{matchRun.ambiguousCount}</strong></article>
      <article className="metric"><span>CONFLICT</span><strong>{matchRun.conflictCount}</strong></article>
      <article className="metric"><span>PREFERRED</span><strong>{counts.selections.PREFERRED ?? 0}</strong></article>
      <article className="metric"><span>PROVISIONAL</span><strong>{counts.selections.PROVISIONAL ?? 0}</strong></article>
      <article className="metric"><span>NONE</span><strong>{counts.selections.NONE ?? 0}</strong></article>
    </div>
    <aside className="analysis-disclaimer priority-disclaimer"><p>Esta decisión fue congelada antes del resultado.</p><p>Es una preferencia previa al precio y puede cambiar al incorporar la cuota.</p><p>Cuota: pendiente · Valor de mercado: desconocido</p></aside>
    <div className="priority-fixtures">
      {assessments.map((assessment) => {
        const ids = [assessment.dcCandidateId, assessment.ouCandidateId, assessment.combinationCandidateId].filter((candidateId): candidateId is string => candidateId !== null);
        const familyCandidates = ids.flatMap((candidateId) => candidateById.get(candidateId) ? [candidateById.get(candidateId)!] : []);
        const quotes = quotesByAssessment.get(assessment.id) ?? [];
        return <article className="priority-fixture" key={assessment.id}>
          <div className="priority-fixture-heading"><div><span>{assessment.fixtureIdentity.countryRaw ?? "País sin normalizar"} · {assessment.fixtureIdentity.competitionRaw ?? "Competición raw"} · {assessment.fixtureIdentity.scheduledKickoffRaw ?? "Hora raw no disponible"}</span><h2>{assessment.fixtureIdentity.homeTeamRaw} <em>vs</em> {assessment.fixtureIdentity.awayTeamRaw}</h2></div><strong className={`priority-status status-${assessment.prePriceSelectionStatus.toLowerCase()}`}>{assessment.prePriceSelectionStatus}</strong></div>
          <div className="priority-family-grid">
            {familyCandidates.slice(0, 3).map((candidate) => <section className="priority-family-card" key={candidate.id}><span>{familyLabel[candidate.family]}</span><h3>{candidate.marketCode}</h3><div className="priority-score"><strong>{candidate.finalPriorityScore.toFixed(2)}</strong><small>{candidate.priorityClass}</small></div><dl><div><dt>Signal</dt><dd>{candidate.signalScore.toFixed(2)}/40</dd></div><div><dt>Histórico agregado</dt><dd>{candidate.historicalEvidenceScore.toFixed(2)}/40</dd></div><div><dt>Calidad</dt><dd>{candidate.dataQualityScore.toFixed(2)}/20</dd></div></dl><p>Solicitud de cuota: {quotes.some((quote) => quote.internalMarketCode === candidate.marketCode) ? "pendiente" : "no requerida"}</p></section>)}
          </div>
          <section className="priority-final">
            <span className="eyebrow">Preferencia previa al precio</span><h3>{assessment.prePricePreference?.marketCode ?? "Sin preferencia sobre el umbral"}</h3>
            <div className="priority-final-grid"><p><b>Estado</b>{assessment.prePriceSelectionStatus}</p><p><b>Score</b>{assessment.prePricePreference?.score.toFixed(2) ?? "—"}</p><p><b>Margen</b>{assessment.prePriceScoreMargin?.toFixed(2) ?? "—"}</p><p><b>Segunda alternativa</b>{assessment.prePriceSecondAlternative?.marketCode ?? "—"}</p></div>
            <p><b>Warnings:</b> {assessment.warnings.join(", ")}</p><p><b>Solicitudes pendientes:</b> {quotes.map((quote) => `${familyLabel[quote.family]} · ${quote.internalMarketCode}`).join(" | ") || "ninguna"}</p>
            <p className="priority-price">Cuota: pendiente · Valor de mercado: desconocido</p>
          </section>
        </article>;
      })}
    </div>
  </section>;
}
