import {readFileSync} from "node:fs";import {describe,expect,it} from "vitest";import {parseStatareaRaw} from "@/domain/statarea/parser";
const html=readFileSync("src/tests/fixtures/statarea-small.html","utf8");const parse=(value=html)=>parseStatareaRaw(value,"2026-07-21");
describe("parser estructural Statarea",()=>{
 it("parsea local, visitante, competición, país, fecha y hora",()=>expect(parse().rows[0]).toMatchObject({homeTeamRaw:"Atletico Mineiro",awayTeamRaw:"Bahia",competitionRaw:"BRAZIL - SERIE A",countryRaw:"Brazil",rowDateRaw:"2026-07-21",kickoffRaw:"18:30",orientation:"HOST_GUEST_DOM"}));
 it.each([["TIP","1"],["1","47"],["X","27"],["2","26"],["HT1","33"],["HTX","39"],["HT2","28"],["1.5","73"],["2.5","44"],["3.5","23"],["BTS","50"],["OTS","50"]])("asocia %s con su valor raw por ordinal",(header,value)=>{const column=parse().rows[0].rawColumns.find(item=>item.headerRaw===header);expect(column?.valueRaw).toBe(value)});
 it.each(["TIP","1.5","2.5","3.5","BTS","OTS"])("mantiene %s UNVERIFIED",header=>expect(parse().rows[0].rawColumns.find(item=>item.headerRaw===header)?.semanticStatus).toBe("UNVERIFIED"));
 it("no crea señal O/U normalizada",()=>expect(JSON.stringify(parse())).not.toMatch(/predictedOu25Side|over25Probability|under25Probability|statareaOu25Signal/));
 it("ignora resultados reales y HT",()=>{const changed=html.replace(">9</a>",">0</a>").replace("HT 7:6","HT 0:0");expect(parse(changed).rows).toEqual(parse().rows)});
 it("rechaza fila sin equipo",()=>expect(parse(html.replace("Atletico Mineiro"," ")).rejections[0].reasonCode).toBe("EMPTY_TEAM"));
 it("rechaza local igual a visitante",()=>expect(parse(html.replace("Bahia</div>","Atletico Mineiro</div>")).rejections[0].reasonCode).toBe("IDENTICAL_TEAMS"));
 it("rechaza fecha indeterminable",()=>expect(parse(html.replace("2026-07-21 18:30","sin fecha")).rejections[0].reasonCode).toBe("INDETERMINATE_DATE"));
 it("sourceRowKey y orden son reproducibles",()=>{expect(parse().rows[0].sourceRowKey).toBe(parse().rows[0].sourceRowKey);expect(parse().rows[0].rawColumns.map(x=>x.ordinal)).toEqual([...Array(12).keys()])});
 it("detecta duplicado interno",()=>{const match=html.match(/<div class="match"[\s\S]*?<\/div>\s*<\/div>\s*<\/body>/);expect(match).toBeTruthy();const duplicated=html.replace("</div></div></body>",`${html.slice(html.indexOf('<div class="match"'),html.lastIndexOf('</div>\n</div></div></body>'))}</div></div></body>`);expect(parse(duplicated).duplicateRows).toBeGreaterThanOrEqual(1)});
});
