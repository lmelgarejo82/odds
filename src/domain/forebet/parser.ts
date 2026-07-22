import { load, type CheerioAPI } from "cheerio";
import Decimal from "decimal.js";
import { canonicalHash } from "@/domain/canonical-hash";
import { FOREBET_PARSER_VERSION, validateSportDate } from "./constants";

export type ParsedObservation = Readonly<{
  sourceRowKey: string; sportDate: string; homeTeamRaw: string; awayTeamRaw: string;
  competitionRaw: string | null; countryRaw: string | null; categoryRaw: string | null;
  kickoffRaw: string | null; suggestedSide: "OVER" | "UNDER";
  probabilityUnder25: string | null; probabilityOver25: string | null;
  predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  averageGoals: string | null; sourceOdds: string | null;
  parseStatus: "VALID" | "WARNING"; warnings: string[];
}>;
export type ParsedRejection = Readonly<{ rowIndex: number; sourceRowKey: string | null; reasonCode: string; details: string[] }>;
export type ForebetParseResult = Readonly<{ rowsFound: number; observations: ParsedObservation[]; rejections: ParsedRejection[]; duplicateRows: number; warnings: string[] }>;

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeTeam = (value: string) => clean(value).normalize("NFKC").toLocaleLowerCase("es");
const decimal = (value: string): string | null => {
  const normalized = clean(value).replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return new Decimal(normalized).toFixed();
};

function contextFromOnclick(value: string): { country: string | null; competition: string | null } {
  const match = value.match(/getstag\(this,\d+,'([^']*)','([^']*)'/);
  return { country: match?.[1] ? clean(match[1]) : null, competition: match?.[2] ? clean(match[2]) : null };
}

function confirmSemantics($: CheerioAPI): void {
  const header = clean($(".heading_0, .schema > div:first-child").first().text());
  const pageTitle = clean($("title").text());
  if (!pageTitle.includes("Menos/Más 2.5") && !header.includes("Menos/Más")) throw new Error("OU25_SEMANTICS_NOT_DEMONSTRATED");
  const allText = clean($("body").text());
  for (const label of ["Pred.", "Marcador Pred.", "Promedio de goles", "Cuota"]) if (!allText.includes(label)) throw new Error(`MISSING_SEMANTIC_LABEL:${label}`);
}

export function parseForebetOu25(html: string, requestedDate: string): ForebetParseResult {
  validateSportDate(requestedDate);
  const $ = load(html);
  confirmSemantics($);
  const observations: ParsedObservation[] = [];
  const rejections: ParsedRejection[] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  const rows = $(".rcnt").toArray();

  rows.forEach((element, rowIndex) => {
    const row = $(element); const warnings: string[] = [];
    const homeTeamRaw = clean(row.find(".homeTeam").first().text());
    const awayTeamRaw = clean(row.find(".awayTeam").first().text());
    const dateTime = clean(row.find(".date_bah").first().text());
    const dateMatch = dateTime.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?$/);
    const sportDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : "";
    const kickoffRaw = dateMatch?.[4] ?? null;
    const sideText = clean(row.find(".forepr").first().text());
    const suggestedSide = sideText === "Más" ? "OVER" : sideText === "Menos" ? "UNDER" : null;
    const percentages = row.find(".fprc > span").toArray().map((node) => decimal($(node).text()));
    const probabilityUnder25 = percentages[0] ?? null;
    const probabilityOver25 = percentages[1] ?? null;
    const predictedScore = clean(row.children(".ex_sc.tabonly").first().text());
    const score = predictedScore.match(/^(\d+)\s*-\s*(\d+)$/);
    const averageGoals = decimal(row.children(".avg_sc.tabonly").first().text());
    const sourceOdds = decimal(row.children(".prmod").children(".lscrsp").first().text());
    const context = contextFromOnclick(row.find(".flsc").attr("onclick") ?? "");
    const categoryRaw = clean(row.find(".shortTag").first().text()) || null;
    const stableBasis = { requestedDate, homeTeamRaw, awayTeamRaw, kickoffRaw, sideText, predictedScore, averageGoals };
    const sourceRowKey = canonicalHash(stableBasis);
    const reasons: string[] = [];
    if (!homeTeamRaw || !awayTeamRaw) reasons.push("EMPTY_TEAM");
    if (homeTeamRaw && normalizeTeam(homeTeamRaw) === normalizeTeam(awayTeamRaw)) reasons.push("IDENTICAL_TEAMS");
    if (sportDate !== requestedDate) reasons.push("DATE_MISMATCH");
    if (!suggestedSide) reasons.push("INVALID_SIDE");
    if (predictedScore && !score) reasons.push("INVALID_PREDICTED_SCORE");
    for (const [name, value] of [["UNDER", probabilityUnder25], ["OVER", probabilityOver25]] as const) {
      if (value === null) warnings.push(`MISSING_${name}_PERCENTAGE`);
      else if (new Decimal(value).lt(0) || new Decimal(value).gt(100)) reasons.push(`${name}_PERCENTAGE_OUT_OF_RANGE`);
    }
    if (probabilityUnder25 !== null && probabilityOver25 !== null) {
      const total = new Decimal(probabilityUnder25).plus(probabilityOver25);
      if (total.minus(100).abs().gt(1)) warnings.push("PERCENTAGES_DO_NOT_APPROXIMATE_100");
    }
    if (averageGoals !== null && new Decimal(averageGoals).isNegative()) reasons.push("NEGATIVE_AVERAGE_GOALS");
    if (reasons.length) { rejections.push({ rowIndex, sourceRowKey, reasonCode: reasons[0], details: reasons }); return; }
    if (seen.has(sourceRowKey)) { duplicateRows += 1; return; }
    seen.add(sourceRowKey);
    observations.push(Object.freeze({ sourceRowKey, sportDate, homeTeamRaw, awayTeamRaw, competitionRaw: context.competition, countryRaw: context.country, categoryRaw, kickoffRaw, suggestedSide: suggestedSide!, probabilityUnder25, probabilityOver25, predictedHomeGoals: score ? Number(score[1]) : null, predictedAwayGoals: score ? Number(score[2]) : null, averageGoals, sourceOdds, parseStatus: warnings.length ? "WARNING" : "VALID", warnings }));
  });
  return Object.freeze({ rowsFound: rows.length, observations, rejections, duplicateRows, warnings: [] });
}

export { FOREBET_PARSER_VERSION };
