import { describe, expect, it } from "vitest";
import { reconcileIdentities, type IdentityRow } from "@/domain/reconciliation/matcher";

const row = (id: string, home: string, away: string, extra: Partial<IdentityRow> = {}): IdentityRow => ({ id, homeTeamRaw: home, awayTeamRaw: away, competitionRaw: "League", countryRaw: null, categoryRaw: null, ...extra });
const status = (f: IdentityRow[], s: IdentityRow[]) => reconcileIdentities(f, s).decisions.find((decision) => decision.forebetId === f[0]?.id)?.status;

describe("matcher conservador", () => {
  it("acepta exact match directo", () => expect(status([row("f", "Alpha", "Beta")], [row("s", "Alpha", "Beta")])).toBe("MATCHED"));
  it("acepta equivalencia institucional conservadora", () => { const result = reconcileIdentities([row("f", "FK Buxoro", "Bunyodkor FC")], [row("s", "Buxoro FK", "FC Bunyodkor")]); expect(result.decisions.find((d) => d.forebetId === "f")?.status).toBe("MATCHED"); expect(result.candidates[0].stage).toBe("CONSERVATIVE"); });
  it("fuzzy genera candidato sin forzar aceptación", () => { const result = reconcileIdentities([row("f", "Sogdiana Jizzakh", "Neftchi Fergana")], [row("s", "Sogdiana Jizzakh", "Neftchi Fargona")]); expect(result.candidates[0].stage).toBe("APPROXIMATE"); expect(result.decisions.find((decision) => decision.forebetId === "f")?.status).toBe("AMBIGUOUS"); });
  it("fuzzy insuficiente no empareja", () => expect(status([row("f", "Alpha", "Beta")], [row("s", "Alfa", "Completely Else")])).toBe("ONLY_FOREBET"));
  it("margen insuficiente produce ambiguo", () => expect(status([row("f", "Alpha", "Beta")], [row("s1", "Alpha", "Beta"), row("s2", "Alpha", "Beta")])).toBe("AMBIGUOUS"));
  it("orientación invertida produce conflicto", () => expect(status([row("f", "Alpha", "Beta")], [row("s", "Beta", "Alpha")])).toBe("CONFLICT"));
  it.each([["Alpha Women", "Alpha"], ["Alpha U21", "Alpha"], ["Alpha Reserves", "Alpha"], ["Alpha B", "Alpha"]])("protege categoría %s", (forebetHome, statareaHome) => expect(status([row("f", forebetHome, "Beta")], [row("s", statareaHome, "Beta")])).toBe("CONFLICT"));
  it("fecha diferente se excluye antes del matcher por snapshot fijado", () => expect(status([row("f", "Alpha", "Beta")], [])).toBe("ONLY_FOREBET"));
  it("país incompatible produce conflicto", () => expect(status([row("f", "Alpha", "Beta", { countryRaw: "China" })], [row("s", "Alpha", "Beta", { countryRaw: "Australia" })])).toBe("CONFLICT"));
  it("competición ausente no bloquea", () => expect(status([row("f", "Alpha", "Beta", { competitionRaw: null })], [row("s", "Alpha", "Beta")])).toBe("MATCHED"));
  it("produce ONLY_STATAREA", () => expect(reconcileIdentities([], [row("s", "Alpha", "Beta")]).decisions[0].status).toBe("ONLY_STATAREA"));
  it("no asigna una fila Statarea dos veces", () => { const result = reconcileIdentities([row("f1", "Alpha", "Beta"), row("f2", "Alpha", "Beta")], [row("s", "Alpha", "Beta")]); expect(result.decisions.filter((d) => d.status === "MATCHED")).toHaveLength(0); });
  it("sourceRowKey externo no forma parte de la entrada", () => expect(Object.keys(row("f", "A", "B"))).not.toContain("sourceRowKey"));
  it.each(["suggestedSide", "probabilityOver25", "probabilityUnder25", "predictedScore", "averageGoals", "TIP", "2.5", "result"])("no acepta campo predictivo %s", (field) => expect(Object.keys(row("f", "A", "B"))).not.toContain(field));
  it("cambiar datos fuera de identidad conserva la decisión", () => { const f = row("f", "Alpha", "Beta"); const s = row("s", "Alpha", "Beta"); expect(reconcileIdentities([f], [s]).decisions.map((d) => d.status)).toEqual(reconcileIdentities([{ ...f }], [{ ...s }]).decisions.map((d) => d.status)); });
  it("todos los MATCHED son directos", () => { const result = reconcileIdentities([row("f", "Alpha", "Beta")], [row("s", "Alpha", "Beta")]); const matched = result.decisions.find((d) => d.status === "MATCHED")!; expect(result.candidates.find((c) => c.key === matched.candidateKey)?.orientation).toBe("DIRECT"); });
});
