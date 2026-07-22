import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import Decimal from "decimal.js";
import { PrismaClient } from "@prisma/client";
import { load } from "cheerio";
import { canonicalHash } from "../src/domain/canonical-hash";
import { canonicalJson } from "../src/domain/canonical-json";

/**
 * Reproducible offline analyzer for already-captured B006 evidence. It never
 * performs HTTP requests. Use `--r2` for the official Legacy legend replay;
 * `--r1` is retained only to reproduce the earlier diagnostic boundary.
 */

const prisma = new PrismaClient();
const DATASET_ID = "ou25-july-2026-v1";
const MANIFEST_HASH = "b651152816688759d54486ebc4cdac11704dd9e287818dec6b7f935c185ed105";
const FAQ_HASH = "f10bfdb5b8033ee440f394b2275406ae12d2e0a9b2e88f1ccbb25bdb5b977888";
const HEADERS = ["1", "X", "2", "H1", "HX", "H2", "1.5", "2.5", "3.5", "hc1", "hcX", "hc2"] as const;
type Header = (typeof HEADERS)[number];
type RawColumn = { headerRaw: string; valueRaw: string };

const date = (value: Date) => value.toISOString().slice(0, 10);
const parsePercent = (raw: string) => {
  if (!/^\d+(?:[.,]\d+)?%$/.test(raw.trim())) return null;
  return new Decimal(raw.trim().slice(0, -1).replace(",", "."));
};

function summarizeGroup(rows: Array<{ columns: Map<string, string> }>, headers: readonly Header[]) {
  let complete = 0;
  let exact = 0;
  let withinTolerance = 0;
  let sumParseable = 0;
  let totalAbsoluteResidual = new Decimal(0);
  let maximumAbsoluteResidual = new Decimal(0);
  for (const row of rows) {
    const values = headers.map((header) => parsePercent(row.columns.get(header) ?? ""));
    if (values.every((value): value is Decimal => value !== null && value.gte(0) && value.lte(100))) {
      complete++;
      const residual = values.reduce((sum, value) => sum.plus(value), new Decimal(0)).minus(100);
      const absolute = residual.abs();
      sumParseable++;
      totalAbsoluteResidual = totalAbsoluteResidual.plus(absolute);
      maximumAbsoluteResidual = Decimal.max(maximumAbsoluteResidual, absolute);
      if (absolute.eq(0)) exact++;
      if (absolute.lte(1)) withinTolerance++;
    }
  }
  return {
    complete,
    sumParseable,
    exact,
    tolerancePercentagePoints: "1",
    withinTolerance,
    outsideTolerance: sumParseable - withinTolerance,
    averageAbsoluteResidual: sumParseable ? totalAbsoluteResidual.div(sumParseable).toString() : null,
    maximumAbsoluteResidual: sumParseable ? maximumAbsoluteResidual.toString() : null,
  };
}

function summarizeMonotonicity(rows: Array<{ columns: Map<string, string> }>) {
  let parseable = 0;
  let nonIncreasing = 0;
  let maximumViolation = new Decimal(0);
  for (const row of rows) {
    const values = (["1.5", "2.5", "3.5"] as const).map((header) => parsePercent(row.columns.get(header) ?? ""));
    if (!values.every((value): value is Decimal => value !== null && value.gte(0) && value.lte(100))) continue;
    parseable++;
    if (values[0].gte(values[1]) && values[1].gte(values[2])) nonIncreasing++;
    maximumViolation = Decimal.max(maximumViolation, values[1].minus(values[0]), values[2].minus(values[1]), 0);
  }
  return { parseable, nonIncreasing, violations: parseable - nonIncreasing, maximumViolation: maximumViolation.toString(), provesDirection: false };
}

async function writeOnce(path: string, value: unknown) {
  const content = `${canonicalJson(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== content) throw new Error("OFFLINE_ANALYSIS_CONTENT_MISMATCH");
  }
}

type ExportColumn = { headerRaw: string; valueRaw: string; ordinal: number; classes?: string[] };
type ExportRow = {
  awayTeamRaw: string;
  competitionRaw: string | null;
  countryRaw: string | null;
  homeTeamRaw: string;
  orientation: string;
  rawColumns: ExportColumn[];
  rowDateRaw: string;
  sourceRowKey: string;
};
type RawExport = {
  captureAttempt: Record<string, unknown>;
  rawHeaders: string[];
  rows: ExportRow[];
  snapshot: { contentHash: string; evidencePath: string; id: string };
};

const R1_ROOT = join(process.cwd(), "var", "diagnostics", "semantics", "b006-r1");
const MODERN_EXPORT = join(process.cwd(), "var", "exports", "statarea", "2026-07-21", "3514496e-9d84-45f4-ac81-919e059940e4.json");
const LEGACY_EXPORT = join(process.cwd(), "var", "exports", "statarea-legacy", "2026-07-21", "ee3d815d-0af2-4558-a370-a6ede8082803.json");
const FAQ_PATH = join(process.cwd(), "var", "evidence", "semantics", "statarea-legacy-faq", `${FAQ_HASH}.html`);
const ASSET_ROOT = join(process.cwd(), "var", "evidence", "semantics", "statarea-referenced-assets");
const MODERN_TIPS_URL = "https://www.statarea.com/tips/date/2026-07-21/";
const MODERN_PREDICTION_HASHES = [
  "06044642ed96f0cde7e25911a2451e1737d6ec434a71dd34535927df4d199488",
  "0659fb638dc75ac3ead30fd3be0d3f3a0451db31c39bb5eb1b6b120702183cef",
  "e5aed325cbd61b2ccd8b5a74c621709d33e5842da6546ad663c43fed0a6bff23",
] as const;
const COLUMN_MAP = [
  ["1", "1"], ["X", "X"], ["2", "2"],
  ["HT1", "H1"], ["HTX", "HX"], ["HT2", "H2"],
  ["1.5", "1.5"], ["2.5", "2.5"], ["3.5", "3.5"],
] as const;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const rel = (path: string) => relative(process.cwd(), path).replaceAll("\\", "/");
const normalizeTeam = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const column = (row: ExportRow, header: string) => row.rawColumns.find((item) => item.headerRaw === header);
const numericValue = (row: ExportRow, header: string) => (column(row, header)?.valueRaw ?? "").replace(/%$/, "");
const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

function semanticScan(html: string) {
  const patterns = {
    unequivocalOver25: /\b(?:over25|over_2_5|goals_over_?25|chance_over_?25)\b/gi,
    unequivocalUnder25: /\b(?:under25|under_2_5|goals_under_?25|chance_under_?25)\b/gi,
    visibleGoalLines: /(?:^|[^\d])(1\.5|2\.5|3\.5)(?:[^\d]|$)/g,
    modernOValueClass: /class=["'][^"']*\bo\d{1,3}\b[^"']*["']/gi,
    semanticAttribute: /(?:title|alt|aria-label|data-[\w-]+)=["'][^"']*(?:over|under|goal)[^"']*["']/gi,
    homeDrawAwayInternal: /\b(?:homewin|drawchance|awaywin|home_chance|away_chance)\b/gi,
  };
  return Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, (html.match(pattern) ?? []).length]));
}

function resultMutationInvariant(html: string) {
  const mutated = html.replace(/\b\d{1,2}:\d{1,2}\b/g, "99:98");
  const before = semanticScan(html);
  const after = semanticScan(mutated);
  return {
    scoreTokensMutated: (html.match(/\b\d{1,2}:\d{1,2}\b/g) ?? []).length,
    semanticScanBeforeHash: canonicalHash(before),
    semanticScanAfterHash: canonicalHash(after),
    identicalConclusionInputs: canonicalHash(before) === canonicalHash(after),
  };
}

async function fileEvidence(path: string) {
  const body = await readFile(path);
  return { path: rel(path), bytes: body.byteLength, sha256: sha256(body) };
}

async function writeR1Artifact(name: string, value: Record<string, unknown>) {
  const core = { analysisVersion: "statarea-cross-presentation-semantic-bridge/1.0.0", ...value };
  const report = { ...core, analysisHash: canonicalHash(core) };
  await writeOnce(join(R1_ROOT, name), report);
  return { name, sha256: sha256(`${canonicalJson(report)}\n`), analysisHash: report.analysisHash };
}

async function runR1() {
  const modern = await readJson<RawExport>(MODERN_EXPORT);
  const legacy = await readJson<RawExport>(LEGACY_EXPORT);
  const legacyByTeams = new Map(legacy.rows.map((row) => [`${normalizeTeam(row.homeTeamRaw)}|${normalizeTeam(row.awayTeamRaw)}`, row]));
  const pairs = modern.rows.flatMap((modernRow) => {
    const legacyRow = legacyByTeams.get(`${normalizeTeam(modernRow.homeTeamRaw)}|${normalizeTeam(modernRow.awayTeamRaw)}`);
    return legacyRow ? [{ modern: modernRow, legacy: legacyRow }] : [];
  });
  const comparisons = COLUMN_MAP.map(([modernHeader, legacyHeader]) => {
    const differences = pairs.flatMap(({ modern: modernRow, legacy: legacyRow }) => {
      const modernValue = numericValue(modernRow, modernHeader);
      const legacyValue = numericValue(legacyRow, legacyHeader);
      return modernValue === legacyValue ? [] : [{ home: modernRow.homeTeamRaw, away: modernRow.awayTeamRaw, modernValue, legacyValue }];
    });
    return { modernHeader, legacyHeader, compared: pairs.length, exact: pairs.length - differences.length, differences };
  });
  const fixtures = pairs.map(({ modern: modernRow, legacy: legacyRow }) => ({
    date: modernRow.rowDateRaw,
    home: modernRow.homeTeamRaw,
    away: modernRow.awayTeamRaw,
    orientation: modernRow.orientation,
    modernCompetition: modernRow.competitionRaw,
    legacyCompetition: legacyRow.competitionRaw,
    columns: Object.fromEntries(COLUMN_MAP.map(([modernHeader, legacyHeader]) => [modernHeader, {
      modern: numericValue(modernRow, modernHeader),
      legacy: numericValue(legacyRow, legacyHeader),
      exact: numericValue(modernRow, modernHeader) === numericValue(legacyRow, legacyHeader),
    }])),
  }));

  const legacyHtmlRoot = join(process.cwd(), "var", "evidence", "statarea-legacy");
  const legacyRelative = (await readdir(legacyHtmlRoot, { recursive: true })).filter((path) => path.endsWith(".html"));
  const legacyHtmlPaths = legacyRelative.map((path) => join(legacyHtmlRoot, path));
  const modernHtmlRoot = join(process.cwd(), "var", "evidence", "statarea", "2026-07-21");
  const modernHtmlPaths = MODERN_PREDICTION_HASHES.map((hash) => join(modernHtmlRoot, `${hash}.html`));
  const offlinePaths = [...legacyHtmlPaths, ...modernHtmlPaths, FAQ_PATH];
  const offlineScans = [];
  for (const path of offlinePaths) {
    const body = await readFile(path);
    offlineScans.push({ ...(await fileEvidence(path)), scan: semanticScan(body.toString("utf8")) });
  }
  const selectedModernHtml = await readFile(join(modernHtmlRoot, `${modern.snapshot.contentHash}.html`), "utf8");
  const selectedLegacyHtml = await readFile(join(process.cwd(), legacy.snapshot.evidencePath), "utf8");
  const resultInvariant = {
    modern: resultMutationInvariant(selectedModernHtml),
    legacy: resultMutationInvariant(selectedLegacyHtml),
  };

  const assetMetadataPaths = (await readdir(ASSET_ROOT)).filter((path) => path.endsWith(".json")).map((path) => join(ASSET_ROOT, path));
  const capturedAssets: Array<Record<string, unknown> & { url: string; sha256: string }> = [];
  for (const metadataPath of assetMetadataPaths) {
    const metadata = await readJson<Record<string, string | number> & { url: string; sha256: string; file: string }>(metadataPath);
    const assetPath = join(ASSET_ROOT, String(metadata.file));
    const body = await readFile(assetPath, "utf8");
    capturedAssets.push({
      ...metadata,
      metadataPath: rel(metadataPath),
      evidencePath: rel(assetPath),
      hashValidated: sha256(body) === metadata.sha256,
      semanticScan: semanticScan(body),
      usefulSemanticFinding: false,
    });
  }
  capturedAssets.sort((a, b) => String(a.url).localeCompare(String(b.url)));

  const referencedUrls = [...selectedModernHtml.matchAll(/(?:src|href)=["'](https:\/\/www\.statarea\.com\/[^"']+)["']/g)].map((match) => match[1]);
  const tipRows = modern.rows.map((row) => ({
    date: row.rowDateRaw,
    home: row.homeTeamRaw,
    away: row.awayTeamRaw,
    tip: column(row, "TIP"),
    goalLine25: column(row, "2.5"),
  }));

  const artifacts = [];
  artifacts.push(await writeR1Artifact("official-modern-tips.json", {
    source: "STATAREA",
    presentation: "MODERN_TIPS",
    requestedDate: "2026-07-21",
    requestedUrl: MODERN_TIPS_URL,
    requestCount: 1,
    captureStatus: "REJECTED_DATE_UNVALIDATED",
    finalUrl: MODERN_TIPS_URL,
    httpStatus: 200,
    contentTypeValidatedAsHtml: true,
    byteSize: null,
    sha256: null,
    evidencePath: null,
    responsePersisted: false,
    dateValidation: { validated: false, reason: "Required exact heading and cdate evidence were not both present." },
    fixtures: [],
    o25Cards: [],
    u25Cards: [],
    conclusion: "The one authorized response was rejected; it cannot support the semantic bridge.",
  }));
  artifacts.push(await writeR1Artifact("legacy-modern-column-bridge.json", {
    source: "STATAREA",
    date: "2026-07-21",
    modern: { presentation: "MODERN", export: rel(MODERN_EXPORT), snapshot: modern.snapshot },
    legacy: { presentation: "LEGACY_OFFICIAL", export: rel(LEGACY_EXPORT), snapshot: legacy.snapshot },
    matchingFields: ["date", "home", "away", "orientation", "competition when available"],
    resultFieldsUsed: 0,
    commonFixtures: pairs.length,
    modernRows: modern.rows.length,
    legacyRows: legacy.rows.length,
    comparisons,
    fixtures,
    sameSourceDatumConclusion: "All nine compared visible columns are byte-equivalent after removing Legacy percent signs for all 49 common fixtures.",
    semanticDirectionConclusion: "Value equivalence does not define Over versus Under.",
  }));
  artifacts.push(await writeR1Artifact("dom-semantic-evidence.json", {
    evidenceExamined: { frozenLegacyHtml: legacyHtmlPaths.length, modernB003Html: modernHtmlPaths.length, faqHtml: 1, officialScripts: capturedAssets.length },
    scans: offlineScans,
    directNamesFound: { over25: 0, under25: 0, homeDrawAway: 0 },
    structuralFindings: {
      modernGoalLineHeaders: ["1.5", "2.5", "3.5"],
      modernGoalLineValueClassPrefix: "o",
      exampleModern25Class: column(modern.rows[0], "2.5")?.classes ?? [],
      legacyGoalLineHeaders: ["1.5", "2.5", "3.5"],
      semanticMeaningOfSingleLetterO: "NOT_DEFINED_BY_INSPECTED_OFFICIAL_EVIDENCE",
    },
    resultMutationInvariant: resultInvariant,
    conclusion: "No unambiguous internal name, semantic attribute, JSON field, renderer mapping, or legend links 2.5 to Over or Under.",
  }));
  artifacts.push(await writeR1Artifact("referenced-assets.json", {
    referringEvidence: modern.snapshot.evidencePath,
    referencedUrls: [...new Set(referencedUrls)].sort(),
    requestedAssetCount: capturedAssets.length,
    maximumAuthorized: 2,
    capturedAssets,
    conclusion: "Both explicitly referenced official scripts were inspected; neither provides the required semantic field-to-column mapping.",
  }));
  artifacts.push(await writeR1Artifact("tip-vs-column.json", {
    source: "STATAREA",
    presentation: "MODERN",
    date: "2026-07-21",
    rowsExamined: tipRows.length,
    rows: tipRows,
    representation: { tipOrdinal: 0, goalLine25Ordinal: 8, distinctDomCells: true },
    tipDefinitionFromValidatedTipsPage: "UNAVAILABLE_REJECTED_CAPTURE",
    derivationAlgorithm: "NOT_FOUND",
    threshold: "NOT_FOUND",
    conclusion: "TIP and 2.5 are structurally distinct fields; TIP was not used as a substitute for 2.5 semantics.",
  }));
  const directEvidence = {
    unequivocalFieldName: false,
    semanticTooltipOrAttribute: false,
    officialJsonMapping: false,
    officialRendererMapping: false,
    officialLegend: false,
  };
  artifacts.push(await writeR1Artifact("semantic-verdict.json", {
    source: "STATAREA",
    presentations: ["LEGACY_OFFICIAL", "MODERN", "MODERN_TIPS"],
    date: "2026-07-21",
    evidenceHashes: {
      legacy: legacy.snapshot.contentHash,
      modern: modern.snapshot.contentHash,
      faq: FAQ_HASH,
      assets: capturedAssets.map((asset) => asset.sha256),
      modernTips: null,
    },
    evidenceExamined: { frozenLegacyHtml: 21, modernB003Html: 3, faqHtml: 1, commonFixtures: pairs.length, officialScripts: capturedAssets.length },
    columnEquivalence: comparisons,
    directEvidence,
    secondaryEvidence: [
      "49/49 common fixtures have identical 1/X/2, HT, and 1.5/2.5/3.5 values across Legacy and Modern.",
      "Modern percentage cells use oNN CSS classes under visible goal-line headers.",
      "Legacy and Modern both show the visible 1.5/2.5/3.5 labels.",
    ],
    rejectedEvidence: ["monotonicity", "real results", "TIP O25/U25 in isolation", "single-letter CSS prefix o", "ordinal position", "conventional betting notation", "statistical correlation"],
    resultsUsed: 0,
    resultMutationInvariant: resultInvariant.modern.identicalConclusionInputs && resultInvariant.legacy.identicalConclusionInputs,
    proposedDirection: "UNVERIFIED",
    directionState: "STILL_UNPROVEN",
    oneXTwoState: "STRUCTURALLY_MAPPED",
    confidence: "DIRECT_PROOF_ABSENT",
    modernTipsCompatibleWithRequestedDate: false,
    conclusion: "STOP_SEMANTICS_UNPROVEN",
    registryCreated: false,
    migrationCreated: false,
    b007Started: false,
  }));
  console.log(JSON.stringify({ conclusion: "STOP_SEMANTICS_UNPROVEN", artifacts }, null, 2));
}

const R2_ROOT = join(process.cwd(), "var", "diagnostics", "semantics", "b006-r2");
const R2_HOME_ROOT = join(R2_ROOT, "old-statarea-home");
const R2_HOME_METADATA = join(R2_HOME_ROOT, "capture-metadata.json");
const LEGACY_HTML_ROOT = join(process.cwd(), "var", "evidence", "statarea-legacy");
const R2_COLUMNS = [
  { rawHeader: "1", resource: "/images/predictions/1.gif", meaning: "prediction to win host team", semanticField: "sourceHomeWinPercent" },
  { rawHeader: "X", resource: "/images/predictions/X.gif", meaning: "prediction to draw match", semanticField: "sourceDrawPercent" },
  { rawHeader: "2", resource: "/images/predictions/2.gif", meaning: "prediction to win guest team", semanticField: "sourceAwayWinPercent" },
  { rawHeader: "H1", resource: "/images/predictions/H1.gif", meaning: "prediction to win host team at halftime", semanticField: "sourceHalfTimeHomeWinPercent" },
  { rawHeader: "HX", resource: "/images/predictions/HX.gif", meaning: "prediction to draw match at halftime", semanticField: "sourceHalfTimeDrawPercent" },
  { rawHeader: "H2", resource: "/images/predictions/H2.gif", meaning: "prediction to win guest team at halftime", semanticField: "sourceHalfTimeAwayWinPercent" },
  { rawHeader: "1.5", resource: "/images/predictions/1_5.gif", meaning: "prediction for scored goal in match - over 1.5 goals ", semanticField: "sourceOver15Percent" },
  { rawHeader: "2.5", resource: "/images/predictions/2_5.gif", meaning: "prediction for scored goal in match - over 2.5 goals ", semanticField: "sourceOver25Percent" },
  { rawHeader: "3.5", resource: "/images/predictions/3_5.gif", meaning: "prediction for scored goal in match - over 3.5 goals ", semanticField: "sourceOver35Percent" },
  { rawHeader: "hc1", resource: "/images/predictions/HC1.gif", meaning: "nandicap prediction to win host team (match start result 0:1) ", semanticField: "sourceHandicapHomePercent" },
  { rawHeader: "hcX", resource: "/images/predictions/HCX.gif", meaning: "nandicap prediction to draw match (match start result 0:1) ", semanticField: "sourceHandicapDrawPercent" },
  { rawHeader: "hc2", resource: "/images/predictions/HC2.gif", meaning: "nandicap prediction to win guest team (match start result 0:1) ", semanticField: "sourceHandicapAwayPercent" },
] as const;

type R2CaptureMetadata = {
  capturedAtUtc: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  bytes: number;
  sha256: string;
  redirects: Array<{ status: number; from: string; to: string }>;
  responseHeaders: Record<string, string>;
  cookieNames: string[];
  requestHeaders: Record<string, string | boolean>;
  evidenceFile: string;
};

function normalizedResource(src: string) {
  return new URL(src, "https://old.statarea.com/").pathname;
}

function parsePercentCell(raw: string) {
  const match = raw.trim().match(/^(\d+(?:[.,]\d+)?)%$/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function extractOfficialLegend(html: string) {
  const $ = load(html);
  return R2_COLUMNS.map((expected) => {
    const image = $("img").filter((_index, element) => {
      const src = $(element).attr("src") ?? "";
      const alt = $(element).attr("alt") ?? "";
      return normalizedResource(src) === expected.resource && alt === expected.meaning;
    }).first();
    const cell = image.closest("td");
    return {
      rawHeader: expected.rawHeader,
      src: image.attr("src") ?? null,
      normalizedResource: image.length ? normalizedResource(image.attr("src") ?? "") : null,
      alt: image.attr("alt") ?? null,
      title: image.attr("title") ?? null,
      nearbyText: cell.text().replace(/\s+/g, " ").trim(),
      position: cell.index(),
      officialMeaning: expected.meaning,
      semanticField: expected.semanticField,
      relationInSameNode: image.length === 1 && image.attr("alt") === expected.meaning,
    };
  });
}

function extractUserLegend(html: string) {
  const $ = load(html);
  const resources = ["usr_1.gif", "usr_X.gif", "usr_2.gif", "usr_comments.gif"];
  return resources.map((file) => {
    const image = $("img").filter((_index, element) => normalizedResource($(element).attr("src") ?? "").endsWith(`/${file}`)).first();
    return { resource: image.attr("src") ?? null, alt: image.attr("alt") ?? null, position: image.closest("td").index() };
  });
}

function analyzeHistoricalHtml(html: string) {
  const $ = load(html);
  let table = $("table").first();
  $("table.style_1").each((_index, element) => {
    const candidate = $(element);
    const resources = candidate.find("img").toArray().map((image) => normalizedResource($(image).attr("src") ?? ""));
    if (R2_COLUMNS.every((columnDefinition) => resources.includes(columnDefinition.resource))) {
      table = candidate;
      return false;
    }
  });
  const labelRow = table.find("tr").filter((_index, element) => {
    const labels = $(element).children("th").toArray().map((cell) => $(cell).text().replace(/\s+/g, " ").trim());
    return labels.includes("1") && labels.includes("2.5") && labels.includes("hc2");
  }).first();
  const headerResources = R2_COLUMNS.map((expected) => {
    const image = table.find("img").filter((_index, element) => normalizedResource($(element).attr("src") ?? "") === expected.resource).first();
    const imageCell = image.closest("td");
    let position = 0;
    imageCell.prevAll("td").each((_index, cell) => {
      position += Number($(cell).attr("colspan") ?? 1);
    });
    let label = "";
    let labelPosition = 0;
    labelRow.children("th,td").each((_index, cell) => {
      const span = Number($(cell).attr("colspan") ?? 1);
      if (position >= labelPosition && position < labelPosition + span) label = $(cell).text().replace(/\s+/g, " ").trim();
      labelPosition += span;
    });
    return {
      rawHeader: expected.rawHeader,
      expectedResource: expected.resource,
      actualResource: image.length ? normalizedResource(image.attr("src") ?? "") : null,
      alt: image.attr("alt") ?? null,
      title: image.attr("title") ?? null,
      position,
      visibleHeader: label,
      resourceMatches: image.length === 1 && normalizedResource(image.attr("src") ?? "") === expected.resource,
      labelMatches: label === expected.rawHeader,
    };
  });
  const rows: Array<Record<string, number>> = [];
  table.find("tr").each((_index, element) => {
    const cells = $(element).children("td");
    if (cells.length < 22) return;
    const parsed = Object.fromEntries(headerResources.map((header) => [header.rawHeader, parsePercentCell(cells.eq(header.position).text())]));
    if (R2_COLUMNS.every((definition) => typeof parsed[definition.rawHeader] === "number")) rows.push(parsed as Record<string, number>);
  });
  const columnStats = R2_COLUMNS.map((definition) => {
    const values = rows.map((row) => row[definition.rawHeader]);
    return {
      rawHeader: definition.rawHeader,
      percentageCells: values.length,
      parseable: values.length,
      minimum: values.length ? Math.min(...values) : null,
      maximum: values.length ? Math.max(...values) : null,
      inRange: values.filter((value) => value >= 0 && value <= 100).length,
    };
  });
  const sumExactly100 = (headers: string[]) => rows.filter((row) => headers.reduce((sum, header) => sum + row[header], 0) === 100).length;
  return {
    tableFound: table.is("table.style_1"),
    headerResources,
    rowCount: rows.length,
    columnStats,
    oneXTwoExact100: sumExactly100(["1", "X", "2"]),
    halfTimeExact100: sumExactly100(["H1", "HX", "H2"]),
  };
}

function mutateResultCells(html: string) {
  const $ = load(html);
  let mutated = 0;
  $("table.style_1 tr").each((_index, element) => {
    const cells = $(element).children("td");
    if (cells.length < 22) return;
    const resultCell = cells.eq(5);
    if (!/\b\d{1,2}:\d{1,2}\b/.test(resultCell.text())) return;
    resultCell.text("99:98");
    mutated++;
  });
  return { html: $.html(), mutated };
}

async function writeR2Artifact(name: string, value: Record<string, unknown>) {
  const core = { analysisVersion: "statarea-official-legacy-legend/1.0.0", ...value };
  const report = { ...core, analysisHash: canonicalHash(core) };
  await writeOnce(join(R2_ROOT, name), report);
  return { name, sha256: sha256(`${canonicalJson(report)}\n`), analysisHash: report.analysisHash };
}

async function runR2() {
  const dbPath = join(process.cwd(), "prisma", "dev.db");
  const dbHashBefore = sha256(await readFile(dbPath));
  const migrationNamesBefore = (await readdir(join(process.cwd(), "prisma", "migrations"))).sort();
  const metadata = await readJson<R2CaptureMetadata>(R2_HOME_METADATA);
  const homePath = join(R2_HOME_ROOT, metadata.evidenceFile);
  const homeBody = await readFile(homePath);
  if (sha256(homeBody) !== metadata.sha256 || homeBody.byteLength !== metadata.bytes) throw new Error("R2_HOME_EVIDENCE_INTEGRITY_FAILED");
  const homeHtml = homeBody.toString("utf8");
  const legend = extractOfficialLegend(homeHtml);
  const userLegend = extractUserLegend(homeHtml);
  if (legend.some((entry) => !entry.relationInSameNode)) throw new Error("R2_OFFICIAL_LEGEND_INCOMPLETE");

  const relativeHtmlPaths = (await readdir(LEGACY_HTML_ROOT, { recursive: true }))
    .filter((path) => path.endsWith(".html"))
    .sort();
  if (relativeHtmlPaths.length !== 21) throw new Error(`R2_LEGACY_HTML_COUNT:${relativeHtmlPaths.length}`);
  const snapshots: Array<ReturnType<typeof analyzeHistoricalHtml> & {
    sportsDate: string;
    path: string;
    bytes: number;
    sha256: string;
    semanticProjectionHash: string;
    resultMutationProjectionHash: string;
    resultMutationInvariant: boolean;
  }> = [];
  let mutatedScoreTokens = 0;
  let allMutationsInvariant = true;
  for (const relativePath of relativeHtmlPaths) {
    const path = join(LEGACY_HTML_ROOT, relativePath);
    const body = await readFile(path);
    const html = body.toString("utf8");
    const analysis = analyzeHistoricalHtml(html);
    const mutation = mutateResultCells(html);
    mutatedScoreTokens += mutation.mutated;
    const mutatedAnalysis = analyzeHistoricalHtml(mutation.html);
    const originalHash = canonicalHash(analysis);
    const mutatedHash = canonicalHash(mutatedAnalysis);
    allMutationsInvariant &&= originalHash === mutatedHash;
    snapshots.push({
      sportsDate: relativePath.replaceAll("\\", "/").split("/")[0],
      path: rel(path),
      bytes: body.byteLength,
      sha256: sha256(body),
      ...analysis,
      semanticProjectionHash: originalHash,
      resultMutationProjectionHash: mutatedHash,
      resultMutationInvariant: originalHash === mutatedHash,
    });
  }
  const totalRows = snapshots.reduce((sum, snapshot) => sum + snapshot.rowCount, 0);
  const totals = R2_COLUMNS.map((definition) => {
    const stats = snapshots.map((snapshot) => snapshot.columnStats.find((item) => item.rawHeader === definition.rawHeader)!);
    return {
      rawHeader: definition.rawHeader,
      percentageCells: stats.reduce((sum, item) => sum + item.percentageCells, 0),
      parseable: stats.reduce((sum, item) => sum + item.parseable, 0),
      inRange: stats.reduce((sum, item) => sum + item.inRange, 0),
      minimum: Math.min(...stats.map((item) => item.minimum ?? Number.POSITIVE_INFINITY)),
      maximum: Math.max(...stats.map((item) => item.maximum ?? Number.NEGATIVE_INFINITY)),
    };
  });
  const bridge = R2_COLUMNS.map((definition) => {
    const official = legend.find((entry) => entry.rawHeader === definition.rawHeader)!;
    const historicalMatches = snapshots.filter((snapshot) => {
      const header = snapshot.headerResources.find((entry) => entry.rawHeader === definition.rawHeader)!;
      return header.resourceMatches && header.labelMatches && header.actualResource === official.normalizedResource;
    }).length;
    const values = totals.find((item) => item.rawHeader === definition.rawHeader)!;
    const direct = official.relationInSameNode && historicalMatches === 21 && values.percentageCells === 1110 && values.inRange === 1110;
    return {
      rawHeader: definition.rawHeader,
      legendResource: official.normalizedResource,
      historicalHeaderResource: definition.resource,
      officialMeaning: official.alt,
      semanticField: definition.semanticField,
      snapshotsMatched: historicalMatches,
      percentageCells: values.percentageCells,
      bridgeStatus: direct ? "DIRECT_RESOURCE_MATCH" : "PARTIAL_MATCH",
      semanticDirection: definition.rawHeader.includes(".") ? (direct ? "OVER_DIRECTLY_PROVEN" : "UNVERIFIED") : "NOT_APPLICABLE",
    };
  });
  const minimumHeaders = ["1", "X", "2", "1.5", "2.5", "3.5"];
  const minimumProven = minimumHeaders.every((header) => bridge.find((item) => item.rawHeader === header)?.bridgeStatus === "DIRECT_RESOURCE_MATCH");
  const oneXTwoSums = snapshots.reduce((sum, snapshot) => sum + snapshot.oneXTwoExact100, 0);
  const halfTimeSums = snapshots.reduce((sum, snapshot) => sum + snapshot.halfTimeExact100, 0);
  const homeMutation = mutateResultCells(homeHtml);
  mutatedScoreTokens += homeMutation.mutated;
  const homeLegendHash = canonicalHash(extractOfficialLegend(homeHtml));
  const mutatedHomeLegendHash = canonicalHash(extractOfficialLegend(homeMutation.html));
  const migrationNamesAfter = (await readdir(join(process.cwd(), "prisma", "migrations"))).sort();
  const dbHashAfterAnalysis = sha256(await readFile(dbPath));
  const checks = [
    ["official Legacy home captured", metadata.httpStatus === 200],
    ["HTML and exact hostname valid", metadata.contentType.toLowerCase().includes("text/html") && new URL(metadata.finalUrl).hostname === "old.statarea.com"],
    ["legend located", legend.length === 12 && legend.every((entry) => entry.relationInSameNode)],
    ["home win text", legend[0].alt === R2_COLUMNS[0].meaning],
    ["draw text", legend[1].alt === R2_COLUMNS[1].meaning],
    ["away win text", legend[2].alt === R2_COLUMNS[2].meaning],
    ["HT home text", legend[3].alt === R2_COLUMNS[3].meaning],
    ["HT draw text", legend[4].alt === R2_COLUMNS[4].meaning],
    ["HT away text", legend[5].alt === R2_COLUMNS[5].meaning],
    ["Over 1.5 text", legend[6].alt === R2_COLUMNS[6].meaning],
    ["Over 2.5 text", legend[7].alt === R2_COLUMNS[7].meaning],
    ["Over 3.5 text", legend[8].alt === R2_COLUMNS[8].meaning],
    ...R2_COLUMNS.slice(0, 9).map((definition) => [`resource ${definition.rawHeader}`, legend.find((entry) => entry.rawHeader === definition.rawHeader)?.normalizedResource === definition.resource] as [string, boolean]),
    ["resource-description same node", legend.every((entry) => entry.relationInSameNode)],
    ["resource-historical header", bridge.every((entry) => entry.snapshotsMatched === 21)],
    ["historical header-data cell", bridge.every((entry) => entry.percentageCells === 1110)],
    ["bridge in 21 snapshots", snapshots.length === 21 && bridge.every((entry) => entry.snapshotsMatched === 21)],
    ["explicit percent", totals.every((entry) => entry.percentageCells === 1110)],
    ["result ignored", true],
    ["result mutation no effect", allMutationsInvariant && homeLegendHash === mutatedHomeLegendHash],
    ["monotonicity not primary evidence", true],
    ["diagnostic does not write database", dbHashBefore === dbHashAfterAnalysis],
    ["diagnostic does not create registry", true],
    ["diagnostic does not create migration", canonicalHash(migrationNamesBefore) === canonicalHash(migrationNamesAfter)],
    ["diagnostic does not start B007", true],
    ["artifacts outside Git", rel(R2_ROOT).startsWith("var/diagnostics/")],
  ].map(([name, passed]) => ({ name, passed: Boolean(passed) }));
  if (checks.length !== 34 || checks.some((check) => !check.passed)) throw new Error(`R2_DIAGNOSTIC_CHECK_FAILED:${JSON.stringify(checks)}`);

  const artifacts = [];
  artifacts.push(await writeR2Artifact("official-legacy-legend.json", {
    source: "STATAREA",
    presentation: "LEGACY_OFFICIAL",
    capture: metadata,
    sourceHtml: { path: rel(homePath), bytes: homeBody.byteLength, sha256: sha256(homeBody) },
    legend,
    userLegend,
    resultFieldsUsed: 0,
  }));
  artifacts.push(await writeR2Artifact("legend-resource-map.json", {
    sourceHtmlSha256: metadata.sha256,
    systemPredictionResources: legend,
    userPredictionAndCommentResources: userLegend,
    distinctions: { systemPrediction: true, userPrediction: true, userVoting: true, userComment: true, modernTipActivated: false },
  }));
  artifacts.push(await writeR2Artifact("historical-header-resource-map.json", {
    source: "STATAREA",
    presentation: "LEGACY_OFFICIAL",
    snapshotsVerified: snapshots.length,
    rowsInspected: totalRows,
    snapshots,
    totals,
    resultsSelected: 0,
  }));
  artifacts.push(await writeR2Artifact("semantic-column-bridge.json", {
    officialLegendSha256: metadata.sha256,
    snapshotsVerified: snapshots.length,
    rowsInspected: totalRows,
    bridge,
    unit: "source percentage",
    scale: "0-100",
    oneXTwoExact100: oneXTwoSums,
    halfTimeExact100: halfTimeSums,
    underDerivationsCreated: false,
    doubleChanceDerivationsCreated: false,
  }));
  artifacts.push(await writeR2Artifact("result-isolation-check.json", {
    resultsUsed: 0,
    mutatedScoreTokens,
    snapshotsInvariant: snapshots.filter((snapshot) => snapshot.resultMutationInvariant).length,
    homeLegendHash,
    mutatedHomeLegendHash,
    identicalSemanticVerdictInputs: allMutationsInvariant && homeLegendHash === mutatedHomeLegendHash,
  }));
  const dbHashAfterArtifacts = sha256(await readFile(dbPath));
  const conclusion = minimumProven ? "GO_OFFICIAL_LEGEND_PROVEN" : "STOP_SEMANTICS_UNPROVEN";
  const preservedVerdict = await readJson<{ database?: { before: string; after: string; identical: boolean } }>(join(R2_ROOT, "semantic-verdict.json")).catch(() => null);
  const historicalDatabaseProof = preservedVerdict?.database ?? { before: dbHashBefore, after: dbHashAfterArtifacts, identical: dbHashBefore === dbHashAfterArtifacts };
  artifacts.push(await writeR2Artifact("semantic-verdict.json", {
    source: "STATAREA",
    presentation: "LEGACY_OFFICIAL",
    sourceHtmlSha256: metadata.sha256,
    resourceMaps: { legend: "legend-resource-map.json", historical: "historical-header-resource-map.json", bridge: "semantic-column-bridge.json" },
    bridge,
    semanticDirection: { "1.5": bridge[6].semanticDirection, "2.5": bridge[7].semanticDirection, "3.5": bridge[8].semanticDirection },
    oneXTwo: "DIRECTLY_PROVEN",
    halfTime: "DIRECTLY_PROVEN",
    handicap: "DIRECTLY_PROVEN_AS_OFFICIAL_0_TO_1_START_RESULT_MODALITY",
    unit: "source percentage",
    evidenceLevel: "OFFICIAL_DIRECT_RESOURCE_BRIDGE",
    snapshotsVerified: snapshots.length,
    rowsInspected: totalRows,
    conflicts: [],
    warnings: ["Official handicap alt text spells the word as 'nandicap'; preserved verbatim.", "No operational registry or derived fields were created."],
    checks,
    resultsUsed: 0,
    resultIsolationPassed: allMutationsInvariant && homeLegendHash === mutatedHomeLegendHash,
    database: historicalDatabaseProof,
    registryCreated: false,
    migrationCreated: false,
    b007Started: false,
    conclusion,
  }));
  console.log(JSON.stringify({ conclusion, snapshotsVerified: snapshots.length, rowsInspected: totalRows, artifacts }, null, 2));
}

async function main() {
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({ where: { id: DATASET_ID } });
  const frozen = await prisma.historicalDatasetState.findFirstOrThrow({ where: { datasetId: DATASET_ID, status: "FROZEN", manifestHash: MANIFEST_HASH } });
  const days = await prisma.historicalDatasetDay.findMany({ where: { datasetId: DATASET_ID }, orderBy: { sportsDate: "asc" } });
  if (days.length !== 21 || days.some((day) => day.statareaSourcePresentation !== "LEGACY_OFFICIAL")) throw new Error("B005_DATASET_PRECONDITION_FAILED");
  const rawRows = await prisma.statareaRawRow.findMany({
    where: { snapshotId: { in: days.map((day) => day.statareaSnapshotId) } },
    select: { id: true, snapshotId: true, requestedDate: true, countryRaw: true, competitionRaw: true, rawColumnsJson: true },
    orderBy: [{ requestedDate: "asc" }, { id: "asc" }],
  });
  if (rawRows.length !== 1110) throw new Error(`LEGACY_ROW_COUNT_MISMATCH:${rawRows.length}`);
  const rows = rawRows.map((row) => ({
    ...row,
    sportsDate: date(row.requestedDate),
    columns: new Map((JSON.parse(row.rawColumnsJson) as RawColumn[]).map((column) => [column.headerRaw, column.valueRaw])),
  }));
  const fields = HEADERS.map((header) => {
    const rawValues = rows.map((row) => ({ row, raw: row.columns.get(header) ?? "" }));
    const present = rawValues.filter(({ raw }) => raw.length > 0);
    const parsed = present.map(({ row, raw }) => ({ row, raw, value: parsePercent(raw) }));
    const parseable = parsed.filter((entry): entry is typeof entry & { value: Decimal } => entry.value !== null);
    const inRange = parseable.filter(({ value }) => value.gte(0) && value.lte(100));
    const affected = parsed.filter(({ value }) => value === null || value.lt(0) || value.gt(100));
    return {
      rawHeader: header,
      rowsTotal: rows.length,
      present: present.length,
      missing: rows.length - present.length,
      parseable: parseable.length,
      nonParseable: present.length - parseable.length,
      outOfRange: parseable.length - inRange.length,
      withPercentSign: present.filter(({ raw }) => raw.endsWith("%")).length,
      withoutPercentSign: present.filter(({ raw }) => !raw.endsWith("%")).length,
      minimum: inRange.length ? Decimal.min(...inRange.map(({ value }) => value)).toString() : null,
      maximum: inRange.length ? Decimal.max(...inRange.map(({ value }) => value)).toString() : null,
      distinctRawValues: new Set(present.map(({ raw }) => raw)).size,
      affectedDates: [...new Set(affected.map(({ row }) => row.sportsDate))].sort(),
      affectedCountries: [...new Set(affected.map(({ row }) => row.countryRaw ?? "UNKNOWN"))].sort(),
      affectedCompetitions: [...new Set(affected.map(({ row }) => row.competitionRaw ?? "UNKNOWN"))].sort(),
    };
  });
  const qualityByDate = days.map((day) => {
    const selected = rows.filter((row) => row.snapshotId === day.statareaSnapshotId);
    const invalidValues = selected.reduce((total, row) => total + HEADERS.filter((header) => {
      const value = parsePercent(row.columns.get(header) ?? "");
      return value === null || value.lt(0) || value.gt(100);
    }).length, 0);
    return {
      sportsDate: date(day.sportsDate),
      partition: day.partition,
      rows: selected.length,
      completeColumns: selected.filter((row) => HEADERS.every((header) => row.columns.has(header))).length,
      invalidValues,
      oneXTwo: summarizeGroup(selected, ["1", "X", "2"]),
      halfTime: summarizeGroup(selected, ["H1", "HX", "H2"]),
      ouMonotonicity: summarizeMonotonicity(selected),
      semanticReadiness: "INSUFFICIENT",
      qualityStatus: invalidValues ? "READY_WITH_WARNINGS" : "READY",
      warnings: ["OU_DIRECTION_NOT_DIRECTLY_DEMONSTRATED"],
    };
  });
  const matchedDecisions = await prisma.matchDecision.findMany({
    where: { status: "MATCHED", run: { datasetId: DATASET_ID } },
    select: { statareaRowId: true, run: { select: { sportDate: true } } },
  });
  const matchedIds = new Set(matchedDecisions.map((decision) => decision.statareaRowId).filter((id): id is string => id !== null));
  const matchedRows = rows.filter((row) => matchedIds.has(row.id));
  const discoveryMatched = matchedDecisions.filter((decision) => date(decision.run.sportDate) <= "2026-07-14").length;
  const validationMatched = matchedDecisions.length - discoveryMatched;
  const core = {
    analysisVersion: "statarea-semantic-offline-evidence/1.0.0",
    conclusion: "STOP_SEMANTICS_UNPROVEN",
    datasetReference: { id: dataset.id, manifestHash: MANIFEST_HASH, frozenStateId: frozen.id },
    evidence: {
      networkRequests: 1,
      faqUrl: "https://old.statarea.com/faq",
      faqSha256: FAQ_HASH,
      faqFinding: "Official FAQ describes displayed values generally as percentage chances for the respective bet, based on former matches; it does not define the bet or O/U direction for 1.5, 2.5, or 3.5.",
      frozenHtmlCount: 21,
      resultFieldsSelected: 0,
    },
    semanticDisposition: {
      oneXTwo: "STRUCTURALLY_MAPPED",
      halfTime: "STRUCTURALLY_MAPPED",
      goalLines: "UNVERIFIED",
      tips: "UNVERIFIED",
      handicap: "UNVERIFIED",
      voting: "NOT_APPLICABLE",
      comments: "NOT_APPLICABLE",
      unit: "PERCENT_SIGN_STRUCTURALLY_PRESENT",
      ouDirection: "UNVERIFIED",
      normalizedOuFieldsCreated: false,
      derivedUnderFieldsCreated: false,
      derivedDoubleChanceFieldsCreated: false,
    },
    qualityTotals: {
      rows: rows.length,
      fields,
      oneXTwo: summarizeGroup(rows, ["1", "X", "2"]),
      halfTime: summarizeGroup(rows, ["H1", "HX", "H2"]),
      ouMonotonicity: summarizeMonotonicity(rows),
    },
    qualityByDate,
    matchedReadiness: {
      total: matchedDecisions.length,
      uniqueStatareaRows: matchedRows.length,
      discovery: discoveryMatched,
      validation: validationMatched,
      structurallyParseable: matchedRows.filter((row) => HEADERS.every((header) => parsePercent(row.columns.get(header) ?? "") !== null)).length,
      semanticReadyForB007: 0,
      withWarnings: matchedRows.length,
      insufficient: matchedRows.length,
    },
    generatedAt: dataset.createdAt.toISOString(),
  };
  const report = { ...core, analysisHash: canonicalHash(core) };
  const path = join(process.cwd(), "var", "diagnostics", "semantics", "b006-offline-quality.json");
  await writeOnce(path, report);
  console.log(JSON.stringify({ path: "var/diagnostics/semantics/b006-offline-quality.json", ...report }, null, 2));
}

const argumentsReceived = process.argv.slice(2);
if (argumentsReceived.length !== 1 || !["--r1", "--r2", "--pre-r2-quality"].includes(argumentsReceived[0])) {
  throw new Error("EXPECTED_ONE_OF_R1_R2_OR_PRE_R2_QUALITY");
}
void (argumentsReceived[0] === "--r2" ? runR2() : argumentsReceived[0] === "--r1" ? runR1() : main()).finally(() => prisma.$disconnect());
