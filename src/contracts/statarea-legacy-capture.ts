import { z } from "zod";
import { STATAREA_LEGACY_PARSER_VERSION, STATAREA_LEGACY_RAW_HEADERS } from "@/domain/statarea/legacy-constants";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const semantic = z.enum(["STRUCTURALLY_MAPPED","STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE","UNVERIFIED","NOT_APPLICABLE"]);
const rawColumn = z.object({key:z.string(),headerRaw:z.enum(STATAREA_LEGACY_RAW_HEADERS),valueRaw:z.string(),ordinal:z.number().int().nonnegative(),semanticStatus:semantic,semanticEvidence:z.string().nullable(),normalizedValue:z.null(),classes:z.array(z.string())}).strict();
const row = z.object({sourceRowKey:hash,rowDateRaw:z.iso.date(),kickoffRaw:z.string().regex(/^\d{2}:\d{2}$/),competitionRaw:z.string().min(1),countryRaw:z.string().min(1),categoryRaw:z.null(),homeTeamRaw:z.string().min(1),awayTeamRaw:z.string().min(1),orientation:z.literal("HOST_GUEST_DOM"),rawColumns:z.array(rawColumn).length(12),semanticStatus:z.literal("STRUCTURALLY_MAPPED"),warnings:z.array(z.string())}).strict();
export const statareaLegacyCaptureContractSchema = z.object({
  contractVersion:z.literal("1.0"),source:z.literal("STATAREA"),sourcePresentation:z.literal("LEGACY_OFFICIAL"),requestedDate:z.iso.date(),
  captureAttempt:z.object({status:z.enum(["SUCCEEDED","PARTIAL","REUSED"]),requestedUrl:z.url(),finalUrl:z.url(),hostname:z.literal("old.statarea.com"),httpStatus:z.literal(200),contentType:z.string(),capturedAt:z.iso.datetime(),byteSize:z.number().int().positive()}).strict(),
  snapshot:z.object({id:z.string(),contentHash:hash,evidencePath:z.string().startsWith("var/evidence/statarea-legacy/"),exportPath:z.string().startsWith("var/exports/statarea-legacy/")}).strict(),
  parserVersion:z.literal(STATAREA_LEGACY_PARSER_VERSION),counts:z.object({rowsFound:z.number().int().nonnegative(),valid:z.number().int().nonnegative(),rejected:z.number().int().nonnegative(),duplicates:z.number().int().nonnegative(),warnings:z.number().int().nonnegative(),unverifiedColumns:z.literal(5)}).strict(),
  rows:z.array(row),rejectedRows:z.array(z.object({rowIndex:z.number().int().nonnegative(),reasonCode:z.string()}).strict()),rawHeaders:z.array(z.enum(STATAREA_LEGACY_RAW_HEADERS)).length(16),semanticRegistry:z.array(z.object({headerRaw:z.string(),semanticStatus:semantic,evidence:z.string()}).strict()),warnings:z.array(z.string()),qualityStatus:z.enum(["CONTROLLED","PARTIAL","EMPTY_VALID"]),resultsPersisted:z.literal(false),statarea25SemanticStatus:z.literal("STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE")
}).strict().superRefine((value,context)=>{
  if (value.rows.some((entry)=>Object.keys(entry).some((key)=>/result/i.test(key)))) context.addIssue({code:"custom",path:["rows"],message:"Results are forbidden"});
  for (const [rowIndex,entry] of value.rows.entries()) for (const [columnIndex,column] of entry.rawColumns.entries()) {
    const expected = ["1.5","2.5","3.5"].includes(column.headerRaw) ? "STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE" : ["hc1","hcX","hc2"].includes(column.headerRaw) ? "UNVERIFIED" : "STRUCTURALLY_MAPPED";
    if (column.semanticStatus !== expected) context.addIssue({code:"custom",path:["rows",rowIndex,"rawColumns",columnIndex,"semanticStatus"],message:"Invalid legacy semantic status"});
  }
});
export type StatareaLegacyCaptureContract = z.infer<typeof statareaLegacyCaptureContractSchema>;
