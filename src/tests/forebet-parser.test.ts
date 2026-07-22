import {readFileSync} from "node:fs";import {join} from "node:path";import {describe,expect,it} from "vitest";
import {parseForebetOu25} from "@/domain/forebet/parser";
const base=readFileSync(join(process.cwd(),"src/tests/fixtures/forebet-ou25-small.html"),"utf8");
const parse=(html=base)=>parseForebetOu25(html,"2026-07-21");
describe("parser Forebet O/U 2.5",()=>{
 it("parsea una fila Over con porcentajes decimales",()=>expect(parse().observations[0]).toMatchObject({suggestedSide:"OVER",probabilityUnder25:"42.5",probabilityOver25:"57.5",predictedHomeGoals:1,predictedAwayGoals:3,averageGoals:"2.92"}));
 it("parsea una fila Under",()=>expect(parse().observations[1]).toMatchObject({suggestedSide:"UNDER",probabilityUnder25:"51",probabilityOver25:"49"}));
 it("valida marcador previsto",()=>expect(parse().observations[0].predictedAwayGoals).toBe(3));
 it("rechaza marcador previsto inválido",()=>expect(parse(base.replace("1 - 3</div>","uno a tres</div>")).rejections[0].reasonCode).toBe("INVALID_PREDICTED_SCORE"));
 it("acepta averageGoals válido",()=>expect(parse().observations[0].averageGoals).toBe("2.92"));
 it("rechaza averageGoals negativo",()=>expect(parse(base.replace(">2.92</div>",">-2.92</div>")).rejections[0].reasonCode).toBe("NEGATIVE_AVERAGE_GOALS"));
 it("tolera campo opcional ausente con warning",()=>expect(parse(base.replace("<span>42.5</span>","<span></span>")).observations[0].warnings).toContain("MISSING_UNDER_PERCENTAGE"));
 it("ignora el resultado real",()=>expect(parse(base.replace("3 - 2</b>","9 - 9</b>")).observations).toEqual(parse().observations));
 it("rechaza fila sin equipos",()=>expect(parse(base.replace("Preston Lions</span>","</span>")).rejections[0].reasonCode).toBe("EMPTY_TEAM"));
 it("rechaza equipos iguales",()=>expect(parse(base.replace("Newcastle Jets</span>","Preston Lions</span>")).rejections[0].reasonCode).toBe("IDENTICAL_TEAMS"));
 it("detecta duplicado dentro del snapshot",()=>{const row=base.match(/<div class="rcnt">[\s\S]*?<\/div>\s*<div class="rcnt">/)?.[0];expect(row).toBeTruthy();const result=parse(base.replace("</div></body>",`${base.slice(base.indexOf('<div class="rcnt">'),base.indexOf('<div class="rcnt">',base.indexOf('<div class="rcnt">')+1))}</div></body>`));expect(result.duplicateRows).toBeGreaterThanOrEqual(1)});
});
