import {readFileSync} from "node:fs";import {describe,expect,it} from "vitest";
import {assertAuthorizedForebetUrl,buildForebetUrl,validateSportDate} from "@/domain/forebet/constants";
import {appendAudit,snapshotDecision} from "@/domain/forebet/capture-policy";
describe("captura controlada",()=>{
 it("construye únicamente la URL autorizada de Forebet",()=>expect(buildForebetUrl("2026-07-21").toString()).toBe("https://www.forebet.com/es/predicciones-de-futbol/predicciones-bajo-mas-2-5-goles/2026-07-21"));
 it("rechaza dominio arbitrario",()=>expect(()=>assertAuthorizedForebetUrl(new URL("https://example.com/es/predicciones-de-futbol/predicciones-bajo-mas-2-5-goles/2026-07-21"))).toThrow("UNAUTHORIZED_URL"));
 it("acepta fecha válida",()=>expect(validateSportDate("2026-07-21")).toBe("2026-07-21"));
 it.each(["21-07-2026","2026-02-30","2026-07-20"])("rechaza fecha inválida o no autorizada: %s",date=>expect(()=>validateSportDate(date)).toThrow());
 it("reutiliza el mismo hash",()=>expect(snapshotDecision(["abc"],"abc")).toBe("REUSE"));
 it("crea snapshot para hash diferente",()=>expect(snapshotDecision(["abc"],"def")).toBe("CREATE"));
 it("no modifica el estado anterior",()=>{const hashes=Object.freeze(["abc"]);snapshotDecision(hashes,"def");expect(hashes).toEqual(["abc"])});
 it("mantiene auditoría append-only",()=>{const old=Object.freeze(["START"]);const next=appendAudit(old,"SUCCESS");expect(old).toEqual(["START"]);expect(next).toEqual(["START","SUCCESS"])});
 it("no contiene dominios fuera de alcance ni dependencia runtime",()=>{for(const path of ["src/application/capture-forebet.ts","src/infrastructure/forebet/http-client.ts","package.json","prisma/schema.prisma"]){const text=readFileSync(path,"utf8");expect(text).not.toMatch(/statarea\.com|apostala|x2-ht-lab/i)}});
 it("la UI mantiene ranking y seguimiento no disponibles",()=>{const text=readFileSync("src/app/page.tsx","utf8");expect(text).toMatch(/Ver mejores partidos/);expect(text).toMatch(/disabled/)});
});
