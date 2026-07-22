import { load, type CheerioAPI } from "cheerio";
import { buildSourceOutcomeEvidence, type SourceOutcomeEvidence } from "./outcomes";
import { FOREBET_RESULT_EXTRACTOR_VERSION, STATAREA_RESULT_EXTRACTOR_VERSION } from "./constants";

const clean = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

export type ResultExtractionTarget = Readonly<{
  snapshotId: string;
  sourceRecordId: string;
  sportsDate: string;
  homeTeamRaw: string;
  awayTeamRaw: string;
  kickoffRaw: string | null;
}>;

function singleOrNull<T>(values: T[]): T | null {
  return values.length === 1 ? values[0] : null;
}

function ownText($: CheerioAPI, cell: ReturnType<CheerioAPI>): string {
  return clean(cell.clone().children().remove().end().text());
}

export function extractForebetResult(html: string, target: ResultExtractionTarget): SourceOutcomeEvidence {
  const $ = load(html);
  const candidates = $(".rcnt").toArray().filter((element) => {
    const row = $(element);
    const dateTime = clean(row.find(".date_bah").first().text());
    const expectedDate = target.sportsDate.split("-").reverse().join("/");
    return clean(row.find(".homeTeam").first().text()) === clean(target.homeTeamRaw)
      && clean(row.find(".awayTeam").first().text()) === clean(target.awayTeamRaw)
      && dateTime.startsWith(expectedDate)
      && (!target.kickoffRaw || dateTime.endsWith(target.kickoffRaw));
  });
  const rowElement = singleOrNull(candidates);
  const row = rowElement ? $(rowElement) : null;
  const rawResult = row ? clean(row.find(".lscr_td .l_scr").first().text()) || clean(row.find(".lscr_td .lscrsp").first().text()) || clean(row.find(".lscr_td").first().clone().children(".ht_scr").remove().end().text()) || null : null;
  const rawHtResult = row ? clean(row.find(".ht_scr, .htresult, [data-half-time-result]").first().text()) || null : null;
  const evidence = buildSourceOutcomeEvidence({ source: "FOREBET", snapshotId: target.snapshotId, sourceRecordId: target.sourceRecordId, sportsDate: target.sportsDate, rawResult, rawHtResult, extractorVersion: FOREBET_RESULT_EXTRACTOR_VERSION });
  return candidates.length <= 1 ? evidence : buildSourceOutcomeEvidence({ source: "FOREBET", snapshotId: target.snapshotId, sourceRecordId: target.sourceRecordId, sportsDate: target.sportsDate, rawResult: "AMBIGUOUS_ROW_MATCH", rawHtResult: null, extractorVersion: FOREBET_RESULT_EXTRACTOR_VERSION });
}

export function extractStatareaLegacyResult(html: string, target: ResultExtractionTarget): SourceOutcomeEvidence {
  const $ = load(html);
  const candidates = $("table.style_1 tr").toArray().filter((element) => {
    const cells = $(element).children("td");
    if (cells.length !== 26) return false;
    return clean(cells.eq(1).find("a").first().text()) === clean(target.homeTeamRaw)
      && clean(cells.eq(2).find("a").first().text()) === clean(target.awayTeamRaw)
      && (!target.kickoffRaw || clean(cells.eq(0).text()) === target.kickoffRaw);
  });
  const rowElement = singleOrNull(candidates);
  const cells = rowElement ? $(rowElement).children("td") : null;
  const resultCell = cells?.eq(5) ?? null;
  const rawResult = resultCell ? ownText($, resultCell as ReturnType<CheerioAPI>) || clean(resultCell.find(".tool").first().clone().children().remove().end().text()) || null : null;
  const tooltip = resultCell ? clean(resultCell.find(".tip").first().text()) : "";
  const rawHtResult = tooltip.match(/half\s*time\s*results?\s*:\s*([0-9]+\s*[:\-–—]\s*[0-9]+)/i)?.[1] ?? null;
  const evidence = buildSourceOutcomeEvidence({ source: "STATAREA", snapshotId: target.snapshotId, sourceRecordId: target.sourceRecordId, sportsDate: target.sportsDate, rawResult, rawHtResult, extractorVersion: STATAREA_RESULT_EXTRACTOR_VERSION });
  return candidates.length <= 1 ? evidence : buildSourceOutcomeEvidence({ source: "STATAREA", snapshotId: target.snapshotId, sourceRecordId: target.sourceRecordId, sportsDate: target.sportsDate, rawResult: "AMBIGUOUS_ROW_MATCH", rawHtResult: null, extractorVersion: STATAREA_RESULT_EXTRACTOR_VERSION });
}
