import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/application/reconcile-fixtures.ts", "utf8");
const migration = readFileSync("prisma/migrations/20260722143651_add_fixture_reconciliation/migration.sql", "utf8");
const ui = readFileSync("src/components/reconciliation-status.tsx", "utf8");
describe("seguridad y persistencia de conciliación", () => {
  it("no usa red", () => expect(service).not.toMatch(/fetch\(|https?:\/\/|axios|http-client/i));
  it("no recaptura fuentes", () => expect(service).not.toMatch(/captureForebet|captureStatarea/));
  it.each(["suggestedSide", "probabilityOver25", "probabilityUnder25", "predictedHomeGoals", "averageGoals", "rawColumnsJson", "TIP", "2.5", "matchResult"])("no lee %s", (field) => expect(service).not.toContain(field));
  it("no usa Apostala ni x2", () => expect(service).not.toMatch(/apostala|x2-ht-lab/i));
  it.each(["MatchRun", "MatchCandidate", "MatchDecision", "MatchAuditEvent", "MatchStabilityReport"])("protege UPDATE y DELETE de %s", (table) => { expect(migration).toContain(`${table}_no_update`); expect(migration).toContain(`${table}_no_delete`); });
  it("protege intentos en migración sucesora", () => { const attempts = readFileSync("prisma/migrations/20260722145000_enforce_match_run_attempt_append_only/migration.sql", "utf8"); expect(attempts).toContain("MatchRunAttempt_no_update"); expect(attempts).toContain("MatchRunAttempt_no_delete"); });
  it("no mezcla las 148 filas", () => expect(service).toContain("where: { snapshotId: statareaSnapshot.id }"));
  it("selecciona primario por captura exitosa más reciente", () => { expect(service).toContain('status: "SUCCEEDED"'); expect(service).toContain("const primary = snapshots.at(-1)!"); });
  it.each(["AMBIGUOUS", "CONFLICT", "ONLY_FOREBET", "ONLY_STATAREA"])("UI muestra %s", (state) => expect(ui).toContain(state));
  it.each(["predicciones", "resultados", "consenso", "ranking"])("UI declara ausente %s", (value) => expect(ui.toLowerCase()).toContain(value));
});
