import { database } from "@/infrastructure/database";

const number = (value: { toNumber(): number } | null) => value === null ? null : value.toNumber();
const list = (value: string) => JSON.parse(value) as string[];
const label: Record<string, string> = { DOUBLE_CHANCE: "Doble oportunidad", OU25: "Más/Menos 2.5", SAME_MATCH_COMBINATION: "Combinación interna" };

export async function MarketPriorityStatus() {
  const policy = await database.marketPriorityPolicy.findUnique({ where: { code_version: { code: "OU25-MARKET-PRIORITY-POLICY", version: "1.0.0" } } });
  if (!policy) return <section className="panel empty-state"><span className="eyebrow">Sistema de prioridad</span><h2>Política pendiente</h2><p>Ejecute el assessment offline para congelar la política explicable.</p></section>;
  const run = await database.marketPriorityAssessmentRun.findFirst({ where: { policyId: policy.id }, orderBy: { createdAt: "desc" } });
  if (!run) return <section className="panel empty-state"><span className="eyebrow">Sistema de prioridad</span><h2>{policy.status}</h2><p>Política {policy.version} congelada; assessment todavía no ejecutado.</p><code>{policy.priorityPolicyHash}</code></section>;
  const [candidates, familyDecisions, finalDecisions] = await Promise.all([
    database.fixtureMarketCandidate.findMany({ where: { assessmentRunId: run.id }, orderBy: [{ sportsDate: "asc" }, { matchDecisionId: "asc" }, { family: "asc" }] }),
    database.fixtureFamilyDecision.findMany({ where: { assessmentRunId: run.id } }),
    database.fixturePreferredLineDecision.findMany({ where: { assessmentRunId: run.id }, orderBy: { matchDecisionId: "asc" } }),
  ]);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const candidatesByMatch = Map.groupBy(candidates, (candidate) => candidate.matchDecisionId);
  const familiesByMatch = Map.groupBy(familyDecisions, (decision) => decision.matchDecisionId);
  const counts = JSON.parse(run.countsJson) as { selections: Record<string, number>; classes: Record<string, number> };
  return <section className="panel priority-panel">
    <span className="eyebrow">Preferencia explicable · capa append-only</span>
    <div className="section-heading"><div><h1>Sistema de prioridad</h1><p>{policy.code} · {policy.version} · {policy.status}</p></div><span className="date">{policy.priorityPolicyHash.slice(0, 16)}…</span></div>
    <dl className="semantic-metadata priority-metadata">
      <div><dt>Policy hash</dt><dd><code>{policy.priorityPolicyHash}</code></dd></div>
      <div><dt>Dataset</dt><dd>{policy.datasetId}</dd></div>
      <div><dt>Manifest</dt><dd><code>{policy.manifestHash}</code></dd></div>
      <div><dt>Registro semántico</dt><dd><code>{policy.semanticRegistryHash}</code></dd></div>
      <div><dt>Análisis histórico</dt><dd><code>{policy.historicalAnalysisSpecHash}</code></dd></div>
      <div><dt>Modo</dt><dd>{run.assessmentMode}</dd></div>
      <div><dt>Validación independiente</dt><dd>{policy.independentValidationStatus}</dd></div>
      <div><dt>Validación prospectiva</dt><dd>REQUERIDA</dd></div>
    </dl>
    <div className="metric-grid priority-summary">
      <article className="metric"><span>Fixtures</span><strong>{run.fixtureCount}</strong></article>
      <article className="metric"><span>PREFERRED</span><strong>{counts.selections.PREFERRED ?? 0}</strong></article>
      <article className="metric"><span>PROVISIONAL</span><strong>{counts.selections.PROVISIONAL ?? 0}</strong></article>
      <article className="metric"><span>NONE</span><strong>{counts.selections.NONE ?? 0}</strong></article>
      {Object.entries(counts.classes).map(([code, count]) => <article className="metric" key={code}><span>{code}</span><strong>{count}</strong></article>)}
    </div>
    <aside className="analysis-disclaimer priority-disclaimer"><p>La línea seleccionada es una preferencia por evidencia.</p><p>No confirma valor de mercado porque la cuota todavía no fue evaluada.</p><p>La política se diseñó retrospectivamente con métricas agregadas; requiere validación prospectiva.</p></aside>
    <div className="priority-fixtures">
      {finalDecisions.map((finalDecision) => {
        const fixtureCandidates = candidatesByMatch.get(finalDecision.matchDecisionId) ?? [];
        const fixture = fixtureCandidates[0];
        const familyWinners = (familiesByMatch.get(finalDecision.matchDecisionId) ?? []).flatMap((family) => family.chosenCandidateId ? [candidateById.get(family.chosenCandidateId)] : []).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
        const selected = finalDecision.selectedCandidateId ? candidateById.get(finalDecision.selectedCandidateId) : null;
        const second = finalDecision.secondCandidateId ? candidateById.get(finalDecision.secondCandidateId) : null;
        return <article className="priority-fixture" key={finalDecision.id}>
          <div className="priority-fixture-heading"><div><span>{fixture?.sportsDate.toISOString().slice(0, 10)}</span><h2>{fixture?.homeTeam} <em>vs</em> {fixture?.awayTeam}</h2></div><strong className={`priority-status status-${finalDecision.selectionStatus.toLowerCase()}`}>{finalDecision.selectionStatus}</strong></div>
          <div className="priority-family-grid">
            {familyWinners.slice(0, 3).map((candidate) => <section className="priority-family-card" key={candidate.id}>
              <span>{label[candidate.family]}</span><h3>{candidate.marketCode}</h3>
              <div className="priority-score"><strong>{candidate.finalPriorityScore.toNumber().toFixed(2)}</strong><small>{candidate.priorityClass}</small></div>
              <dl><div><dt>Signal</dt><dd>{candidate.signalScore.toNumber().toFixed(2)}/40</dd></div><div><dt>Histórico</dt><dd>{candidate.historicalEvidenceScore.toNumber().toFixed(2)}/40</dd></div><div><dt>Calidad</dt><dd>{candidate.dataQualityScore.toNumber().toFixed(2)}/20</dd></div></dl>
              <p>Caps: {list(candidate.capsJson).length ? list(candidate.capsJson).map((cap) => typeof cap === "string" ? cap : JSON.stringify(cap)).join(", ") : "ninguno"}</p>
            </section>)}
          </div>
          <section className="priority-final">
            <span className="eyebrow">Opción preferida del partido</span><h3>{selected?.marketCode ?? "Sin línea seleccionada"}</h3>
            <div className="priority-final-grid"><p><b>Estado</b>{finalDecision.selectionStatus}</p><p><b>Score</b>{number(selected?.finalPriorityScore ?? null)?.toFixed(2) ?? "—"}</p><p><b>Margen</b>{number(finalDecision.marginToSecond)?.toFixed(2) ?? "—"}</p><p><b>Segunda alternativa</b>{second?.marketCode ?? "—"}</p></div>
            <p><b>Razones:</b> {list(finalDecision.reasonsJson).join(", ")}</p><p><b>Caps:</b> {list(finalDecision.capsJson).map((cap) => typeof cap === "string" ? cap : JSON.stringify(cap)).join(", ") || "ninguno"}</p><p><b>Warnings:</b> {list(finalDecision.warningsJson).join(", ")}</p><p className="priority-price">Precio: NOT_EVALUATED · Cuota: no disponible · Valor de mercado: UNKNOWN</p>
          </section>
        </article>;
      })}
    </div>
  </section>;
}
