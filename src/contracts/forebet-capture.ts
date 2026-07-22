import { z } from "zod";

const nullableDecimal = z.string().regex(/^\d+(?:\.\d+)?$/).nullable();
export const forebetCaptureReportSchema = z.object({
  schemaVersion:z.literal("1.0"), source:z.literal("FOREBET"), sportDate:z.iso.date(),
  snapshot:z.object({status:z.enum(["SUCCEEDED","PARTIAL","REUSED"]),contentHash:z.string().regex(/^[a-f0-9]{64}$/),parserVersion:z.string().min(1),evidencePath:z.string().startsWith("var/evidence/forebet/")}).strict(),
  counts:z.object({rowsFound:z.number().int().nonnegative(),valid:z.number().int().nonnegative(),rejected:z.number().int().nonnegative(),duplicates:z.number().int().nonnegative(),warnings:z.number().int().nonnegative()}).strict(),
  observations:z.array(z.object({sourceRowKey:z.string().regex(/^[a-f0-9]{64}$/),homeTeamRaw:z.string().min(1),awayTeamRaw:z.string().min(1),suggestedSide:z.enum(["OVER","UNDER"]),probabilityUnder25:nullableDecimal,probabilityOver25:nullableDecimal,predictedHomeGoals:z.number().int().nonnegative().nullable(),predictedAwayGoals:z.number().int().nonnegative().nullable(),averageGoals:nullableDecimal,sourceOdds:nullableDecimal,warnings:z.array(z.string())}).strict()),
  rejections:z.array(z.object({rowIndex:z.number().int().nonnegative(),reasonCode:z.string().min(1)}).strict()), warnings:z.array(z.string()),
}).strict();

export type ForebetCaptureReport = z.infer<typeof forebetCaptureReportSchema>;
