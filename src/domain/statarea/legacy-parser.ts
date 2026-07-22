import { load } from "cheerio";
import { basename } from "node:path";
import { canonicalHash } from "@/domain/canonical-hash";
import { buildLegacyStatareaUrl, STATAREA_LEGACY_PREDICTIVE_HEADERS, STATAREA_LEGACY_RAW_HEADERS } from "./legacy-constants";
import { validateStatareaDate } from "./constants";

type SemanticStatus = "STRUCTURALLY_MAPPED" | "STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE" | "UNVERIFIED";
const COLUMNS: ReadonlyArray<readonly [typeof STATAREA_LEGACY_PREDICTIVE_HEADERS[number], number, SemanticStatus]> = [
  ["1",6,"STRUCTURALLY_MAPPED"],["X",7,"STRUCTURALLY_MAPPED"],["2",8,"STRUCTURALLY_MAPPED"],
  ["H1",10,"STRUCTURALLY_MAPPED"],["HX",11,"STRUCTURALLY_MAPPED"],["H2",12,"STRUCTURALLY_MAPPED"],
  ["1.5",14,"STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE"],["2.5",15,"STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE"],["3.5",16,"STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE"],
  ["hc1",18,"UNVERIFIED"],["hcX",19,"UNVERIFIED"],["hc2",20,"UNVERIFIED"],
];
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

export function parseLegacyStatarea(html: string, requestedDate: string) {
  validateStatareaDate(requestedDate); const $ = load(html); const table = $("table.style_1").first();
  const title = clean($("h1.seo").first().text()); const titleDate = title.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
  const headerCells = table.find("tr").filter((_, row) => { const cells = $(row).children("th"); return cells.length === 24 && clean(cells.eq(0).text()) === "t"; }).first().children("th");
  const expected = new Map(COLUMNS.map(([header,index]) => [index, header]));
  const headersRecognized = [...expected].every(([index, header]) => clean(headerCells.eq(index).text()) === header);
  const blocked = /captcha|verify you are human|access denied|challenge-platform|cf-chl-/i.test(`${title} ${clean($("title").text())}`);
  const visibleText = clean($("body").clone().find("script,style,noscript").remove().end().text());
  const emptyEvidence = /no (?:matches|games|predictions)(?: were)? (?:found|available|scheduled)|there are no (?:matches|games)/i.test(visibleText);
  const quickNavigationDates = [...new Set($("a[href*='/predictions/']").map((_, anchor) => { try { return new URL($(anchor).attr("href") ?? "", buildLegacyStatareaUrl(requestedDate)).pathname.match(/\/predictions\/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null; } catch { return null; } }).get().filter(Boolean))];
  const rows: Array<Record<string, unknown>> = []; const rejections: Array<{rowIndex:number;sourceRowKey:string|null;reasonCode:string;details:string[]}> = []; let countryRaw: string | null = null; let competitionRaw: string | null = null;
  table.find("tr").each((rowIndex, rowElement) => {
    const cells = $(rowElement).children("td");
    if (cells.length === 1 && cells.eq(0).attr("colspan") === "26" && cells.eq(0).find("img[src*='/flags/country/']").length) { const label = clean(cells.eq(0).text()); const comma = label.indexOf(","); countryRaw = comma >= 0 ? label.slice(0, comma).trim() : null; competitionRaw = comma >= 0 ? label.slice(comma + 1).trim() : label; return; }
    if (cells.length !== 26 || !/^\d{2}:\d{2}$/.test(clean(cells.eq(0).text()))) return;
    const kickoffRaw = clean(cells.eq(0).text()); const homeTeamRaw = clean(cells.eq(1).find("a").first().text()); const awayTeamRaw = clean(cells.eq(2).find("a").first().text());
    const tipRaw = cells.eq(4).find("img").map((_, image) => basename(new URL($(image).attr("src") ?? "", buildLegacyStatareaUrl(requestedDate)).pathname, ".gif")).get();
    const rawColumns = COLUMNS.map(([headerRaw, ordinal, semanticStatus], index) => ({ key:`legacy-column-${index}`,headerRaw,valueRaw:clean(cells.eq(ordinal).text()),ordinal:index,semanticStatus,semanticEvidence:semanticStatus === "STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE" ? `Visible legacy header ${headerRaw}` : semanticStatus === "STRUCTURALLY_MAPPED" ? `Visible legacy header ${headerRaw}` : null,normalizedValue:null,classes:[] as string[] }));
    const sourceRowKey = canonicalHash({requestedDate,homeTeamRaw,awayTeamRaw,kickoffRaw,competitionRaw,countryRaw,tipRaw,rawColumns:rawColumns.map((column)=>[column.headerRaw,column.valueRaw])});
    const reasons: string[] = []; if (titleDate !== requestedDate) reasons.push("DATE_MISMATCH"); if (!homeTeamRaw || !awayTeamRaw) reasons.push("EMPTY_TEAM"); if (!countryRaw || !competitionRaw) reasons.push("MISSING_COMPETITION"); if (rawColumns.some((column)=>!column.valueRaw)) reasons.push("MISSING_PREDICTIVE_COLUMN");
    if (reasons.length) { rejections.push({rowIndex,sourceRowKey,reasonCode:reasons[0],details:reasons}); return; }
    rows.push({sourceRowKey,requestedDate,rowDateRaw:requestedDate,kickoffRaw,competitionRaw,countryRaw,categoryRaw:null,homeTeamRaw,awayTeamRaw,orientation:"HOST_GUEST_DOM",rowTextRaw:`${homeTeamRaw} - ${awayTeamRaw}`,rawColumns,structuralAttributes:{rowIndex,sourcePresentation:"LEGACY_OFFICIAL",tipRaw,resultColumnExcluded:true,halfTimeResultExcluded:true},parseStatus:"VALID",semanticStatus:"STRUCTURALLY_MAPPED",warnings:[] as string[]});
  });
  const failure = blocked ? "BLOCKED_CONTENT" : titleDate !== requestedDate ? "DATE_MISMATCH" : !headersRecognized ? "STRUCTURE_UNSUPPORTED" : rows.length === 0 && !emptyEvidence ? "ZERO_VALID_ROWS" : null;
  const semanticRegistry = [{headerRaw:"TIP",semanticStatus:"UNVERIFIED",evidence:"Visible tip indicators retained raw; not interpreted"},...COLUMNS.map(([headerRaw,,semanticStatus])=>({headerRaw,semanticStatus,evidence:semanticStatus === "UNVERIFIED" ? "Header retained raw; meaning deferred" : `Visible legacy header ${headerRaw}`})),{headerRaw:"Result",semanticStatus:"NOT_APPLICABLE",evidence:"Final and half-time results are structurally isolated and excluded"},{headerRaw:"vote",semanticStatus:"UNVERIFIED",evidence:"User voting is excluded"},{headerRaw:"comment",semanticStatus:"NOT_APPLICABLE",evidence:"Comments are excluded"}];
  return Object.freeze({title,titleDate,quickNavigationDates,rowsFound:rows.length+rejections.length,rows,rejections,duplicateRows:0,rawHeaders:[...STATAREA_LEGACY_RAW_HEADERS],semanticRegistry,warnings:[...(quickNavigationDates.includes(requestedDate)?[]:["QUICK_NAV_CURRENT_WINDOW_IGNORED"]),...(rows.length? ["REAL_RESULTS_STRUCTURALLY_EXCLUDED"]:[])],emptyValid:rows.length===0&&emptyEvidence,failure});
}
