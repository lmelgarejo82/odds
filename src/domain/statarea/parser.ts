import { load } from "cheerio";
import { canonicalHash } from "@/domain/canonical-hash";
import {
  STATAREA_PARSER_VERSION,
  STATAREA_RAW_HEADERS,
  STATAREA_UNVERIFIED_HEADERS,
  validateStatareaDate,
} from "./constants";
export type SemanticStatus =
  | "VERIFIED"
  | "STRUCTURALLY_MAPPED"
  | "UNVERIFIED"
  | "CONFLICTING"
  | "NOT_APPLICABLE";
export type RawColumn = Readonly<{
  key: string;
  headerRaw: string;
  valueRaw: string;
  ordinal: number;
  semanticStatus: SemanticStatus;
  semanticEvidence: string | null;
  normalizedValue: null;
  classes: string[];
}>;
export type StatareaParsedRow = Readonly<{
  sourceRowKey: string;
  requestedDate: string;
  rowDateRaw: string | null;
  kickoffRaw: string | null;
  competitionRaw: string | null;
  countryRaw: string | null;
  categoryRaw: string | null;
  homeTeamRaw: string;
  awayTeamRaw: string;
  orientation: "HOST_GUEST_DOM";
  rowTextRaw: string | null;
  rawColumns: RawColumn[];
  structuralAttributes: Record<string, string>;
  parseStatus: "VALID" | "WARNING";
  semanticStatus: "STRUCTURALLY_MAPPED";
  warnings: string[];
}>;
export type StatareaParseResult = Readonly<{
  rowsFound: number;
  rows: StatareaParsedRow[];
  rejections: Array<{
    rowIndex: number;
    sourceRowKey: string | null;
    reasonCode: string;
    details: string[];
  }>;
  duplicateRows: number;
  rawHeaders: string[];
  semanticRegistry: Array<{
    headerRaw: string;
    semanticStatus: SemanticStatus;
    evidence: string;
  }>;
  warnings: string[];
}>;
const sanitize = (value: string, max = 300) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const norm = (v: string) =>
  sanitize(v).normalize("NFKC").toLocaleLowerCase("en");
const statusFor = (header: string): SemanticStatus =>
  STATAREA_UNVERIFIED_HEADERS.includes(header as never)
    ? "UNVERIFIED"
    : "STRUCTURALLY_MAPPED";
export function parseStatareaRaw(
  html: string,
  requestedDate: string,
): StatareaParseResult {
  validateStatareaDate(requestedDate);
  const $ = load(html);
  const rows: StatareaParsedRow[] = [];
  const rejections: StatareaParseResult["rejections"] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  const matches = $(".competition .match").toArray();
  matches.forEach((element, rowIndex) => {
    const row = $(element);
    const competition = row.closest(".competition");
    const competitionRaw =
      sanitize(
        competition.children(".header").children(".name").first().text(),
      ) || null;
    const alt = sanitize(
      competition.find(".header .logo img").attr("alt") ?? "",
    );
    const countryRaw = alt.replace(/\s+country flag$/i, "") || null;
    const homeTeamRaw = sanitize(row.find(".hostteam .name").first().text());
    const awayTeamRaw = sanitize(row.find(".guestteam .name").first().text());
    const dateHeader = sanitize(row.find(".teams > .ownheader").first().text());
    const dateMatch = dateHeader.match(
      /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?$/,
    );
    const rowDateRaw = dateMatch?.[1] ?? null;
    const kickoffRaw =
      (dateMatch?.[2] ?? sanitize(row.children(".date").first().text())) ||
      null;
    const tip = sanitize(
      row.find(".matchrow > .tip > .value").first().text(),
      100,
    );
    const values = row
      .find(".inforow > .coefrow > .coefbox")
      .toArray()
      .map((node) => ({
        value: sanitize($(node).find(".value").first().text(), 100),
        classes: ($(node).find(".value").first().attr("class") ?? "")
          .split(/\s+/)
          .filter(Boolean),
      }));
    const rawValues = [
      {
        value: tip,
        classes: (
          row.find(".matchrow > .tip > .value").first().attr("class") ?? ""
        )
          .split(/\s+/)
          .filter(Boolean),
      },
      ...values,
    ];
    const rawColumns = STATAREA_RAW_HEADERS.map((headerRaw, ordinal) =>
      Object.freeze({
        key: `column-${ordinal}`,
        headerRaw,
        valueRaw: rawValues[ordinal]?.value ?? "",
        ordinal,
        semanticStatus: statusFor(headerRaw),
        semanticEvidence:
          statusFor(headerRaw) === "STRUCTURALLY_MAPPED"
            ? `Celda asociada por ordinal ${ordinal} al encabezado visible ${headerRaw}`
            : null,
        normalizedValue: null,
        classes: rawValues[ordinal]?.classes ?? [],
      }),
    );
    const sourceRowKey = canonicalHash({
      requestedDate,
      homeTeamRaw,
      awayTeamRaw,
      kickoffRaw,
      competitionRaw,
      rawColumns: rawColumns.map((c) => [c.headerRaw, c.valueRaw]),
    });
    const reasons: string[] = [];
    const warnings: string[] = [];
    if (!homeTeamRaw || !awayTeamRaw) reasons.push("EMPTY_TEAM");
    if (homeTeamRaw && norm(homeTeamRaw) === norm(awayTeamRaw))
      reasons.push("IDENTICAL_TEAMS");
    if (!dateMatch) reasons.push("INDETERMINATE_DATE");
    else if (rowDateRaw !== requestedDate) reasons.push("DATE_MISMATCH");
    if (rawColumns.every((c) => !c.valueRaw)) reasons.push("NOT_A_SPORTS_ROW");
    if (!competitionRaw) warnings.push("MISSING_COMPETITION");
    if (!kickoffRaw) warnings.push("MISSING_KICKOFF");
    if (reasons.length) {
      rejections.push({
        rowIndex,
        sourceRowKey,
        reasonCode: reasons[0],
        details: reasons,
      });
      return;
    }
    if (seen.has(sourceRowKey)) {
      duplicateRows++;
      return;
    }
    seen.add(sourceRowKey);
    rows.push(
      Object.freeze({
        sourceRowKey,
        requestedDate,
        rowDateRaw,
        kickoffRaw,
        competitionRaw,
        countryRaw,
        categoryRaw: null,
        homeTeamRaw,
        awayTeamRaw,
        orientation: "HOST_GUEST_DOM",
        rowTextRaw: sanitize(`${homeTeamRaw} - ${awayTeamRaw}`, 500),
        rawColumns,
        structuralAttributes: {
          matchId: row.attr("id") ?? "",
          rowClass: row.attr("class") ?? "",
        },
        parseStatus: warnings.length ? "WARNING" : "VALID",
        semanticStatus: "STRUCTURALLY_MAPPED",
        warnings,
      }),
    );
  });
  const semanticRegistry = STATAREA_RAW_HEADERS.map((headerRaw) => ({
    headerRaw,
    semanticStatus: statusFor(headerRaw),
    evidence:
      statusFor(headerRaw) === "UNVERIFIED"
        ? "Solo existencia, encabezado y asociación ordinal demostrados; significado operativo diferido a B006"
        : "Asociación estructural encabezado-celda demostrada",
  }));
  return Object.freeze({
    rowsFound: matches.length,
    rows,
    rejections,
    duplicateRows,
    rawHeaders: [...STATAREA_RAW_HEADERS],
    semanticRegistry,
    warnings: [],
  });
}
export { STATAREA_PARSER_VERSION };
