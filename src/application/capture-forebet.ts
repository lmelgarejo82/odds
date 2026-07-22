import { Prisma, PrismaClient } from "@prisma/client";
import { forebetCaptureReportSchema, type ForebetCaptureReport } from "@/contracts/forebet-capture";
import { canonicalHash } from "@/domain/canonical-hash";
import { FOREBET_PARSER_VERSION, FOREBET_SOURCE, validateSportDate } from "@/domain/forebet/constants";
import { parseForebetOu25 } from "@/domain/forebet/parser";
import { preserveEvidence } from "@/infrastructure/forebet/evidence-store";
import { fetchForebet, type ForebetHttpResponse } from "@/infrastructure/forebet/http-client";

type Dependencies = { prisma: PrismaClient; fetcher?: (date: string) => Promise<ForebetHttpResponse> };

const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
const details = (value: unknown) => JSON.stringify(value);

export async function captureForebetOu25(date: string, dependencies: Dependencies): Promise<ForebetCaptureReport> {
  validateSportDate(date);
  const { prisma, fetcher = fetchForebet } = dependencies;
  await prisma.forebetCaptureAuditEvent.create({ data: { eventType:"CAPTURE_STARTED", requestedDate:dateValue(date), detailsJson:details({source:FOREBET_SOURCE,date,parserVersion:FOREBET_PARSER_VERSION}) } });
  let response: ForebetHttpResponse;
  try { response = await fetcher(date); }
  catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_CAPTURE_ERROR";
    await prisma.$transaction([
      prisma.forebetCaptureAttempt.create({data:{requestedDate:dateValue(date),requestedUrl:"https://www.forebet.com/es/predicciones-de-futbol/predicciones-bajo-mas-2-5-goles/2026-07-21",capturedAt:new Date(),parserVersion:FOREBET_PARSER_VERSION,status:"FAILED",errorCode:message}}),
      prisma.forebetCaptureAuditEvent.create({data:{eventType:"CAPTURE_FAILED",requestedDate:dateValue(date),detailsJson:details({source:FOREBET_SOURCE,date,parserVersion:FOREBET_PARSER_VERSION,error:message})}}),
    ]);
    throw error;
  }
  const evidence = await preserveEvidence(date, response.body);
  const baseAttempt = { requestedDate:dateValue(date), requestedUrl:response.requestedUrl, finalUrl:response.finalUrl, capturedAt:response.capturedAt, httpStatus:response.httpStatus, contentType:response.contentType, byteSize:response.body.byteLength, contentHash:evidence.hash, parserVersion:FOREBET_PARSER_VERSION };
  const html = response.body.toString("utf8");
  const failure = response.httpStatus !== 200 ? `HTTP_${response.httpStatus}` : !response.contentType.toLowerCase().includes("text/html") ? "INVALID_CONTENT_TYPE" : response.body.length === 0 ? "EMPTY_CONTENT" : /captcha|cf-chl-|access denied/i.test(html) ? "BLOCKED_CONTENT" : null;
  if (failure) {
    await prisma.$transaction([
      prisma.forebetCaptureAttempt.create({data:{...baseAttempt,status:"FAILED",errorCode:failure}}),
      prisma.forebetCaptureAuditEvent.create({data:{eventType:"CAPTURE_FAILED",requestedDate:dateValue(date),detailsJson:details({source:FOREBET_SOURCE,date,hash:evidence.hash,httpStatus:response.httpStatus,error:failure,parserVersion:FOREBET_PARSER_VERSION})}}),
    ]);
    throw new Error(failure);
  }
  let parsed;
  try { parsed = parseForebetOu25(html, date); }
  catch (error) {
    const message = error instanceof Error ? error.message : "PARSER_FAILED";
    await prisma.$transaction([
      prisma.forebetCaptureAttempt.create({data:{...baseAttempt,status:"FAILED",errorCode:message}}),
      prisma.forebetCaptureAuditEvent.create({data:{eventType:"CAPTURE_FAILED",requestedDate:dateValue(date),detailsJson:details({source:FOREBET_SOURCE,date,hash:evidence.hash,error:message,parserVersion:FOREBET_PARSER_VERSION})}}),
    ]);
    throw error;
  }
  if (!parsed.observations.length) {
    await prisma.$transaction([
      prisma.forebetCaptureAttempt.create({data:{...baseAttempt,status:"FAILED",errorCode:"ZERO_VALID_OBSERVATIONS"}}),
      prisma.forebetCaptureAuditEvent.create({data:{eventType:"CAPTURE_FAILED",requestedDate:dateValue(date),detailsJson:details({source:FOREBET_SOURCE,date,hash:evidence.hash,error:"ZERO_VALID_OBSERVATIONS",counts:{rowsFound:parsed.rowsFound,rejected:parsed.rejections.length},parserVersion:FOREBET_PARSER_VERSION})}}),
    ]);
    throw new Error("ZERO_VALID_OBSERVATIONS");
  }
  const existing = await prisma.forebetCaptureSnapshot.findUnique({ where:{requestedDate_contentHash_parserVersion:{requestedDate:dateValue(date),contentHash:evidence.hash,parserVersion:FOREBET_PARSER_VERSION}} });
  let snapshotId: string; let status: "SUCCEEDED"|"PARTIAL"|"REUSED";
  if (existing) { snapshotId=existing.id; status="REUSED"; }
  else {
    status = parsed.rejections.length ? "PARTIAL" : "SUCCEEDED";
    const artifact = await prisma.sourceArtifact.upsert({where:{contentHash:evidence.hash},update:{},create:{source:"FOREBET",requestedDate:dateValue(date),sourceUrl:response.requestedUrl,captureMethod:"HTTP_GET_CONTROLLED",contentHash:evidence.hash,byteSize:response.body.byteLength,parserVersion:FOREBET_PARSER_VERSION,storagePath:evidence.relativePath,capturedAt:response.capturedAt,status:status === "PARTIAL" ? "PARTIAL" : "COMPLETE"}});
    const warningCount = parsed.warnings.length + parsed.observations.reduce((sum,row)=>sum+row.warnings.length,0);
    const created = await prisma.forebetCaptureSnapshot.create({data:{sourceArtifactId:artifact.id,requestedDate:dateValue(date),contentHash:evidence.hash,parserVersion:FOREBET_PARSER_VERSION,evidencePath:evidence.relativePath,rowsFound:parsed.rowsFound,validRows:parsed.observations.length,rejectedRows:parsed.rejections.length,duplicateRows:parsed.duplicateRows,warningCount,observations:{create:parsed.observations.map(row=>({source:"FOREBET",sportDate:dateValue(row.sportDate),homeTeamRaw:row.homeTeamRaw,awayTeamRaw:row.awayTeamRaw,competitionRaw:row.competitionRaw,countryRaw:row.countryRaw,categoryRaw:row.categoryRaw,kickoffRaw:row.kickoffRaw,suggestedSide:row.suggestedSide,probabilityUnder25:row.probabilityUnder25===null?null:new Prisma.Decimal(row.probabilityUnder25),probabilityOver25:row.probabilityOver25===null?null:new Prisma.Decimal(row.probabilityOver25),predictedHomeGoals:row.predictedHomeGoals,predictedAwayGoals:row.predictedAwayGoals,averageGoals:row.averageGoals===null?null:new Prisma.Decimal(row.averageGoals),sourceOdds:row.sourceOdds===null?null:new Prisma.Decimal(row.sourceOdds),sourceRowKey:row.sourceRowKey,parserVersion:FOREBET_PARSER_VERSION,parseStatus:row.parseStatus,warningsJson:details(row.warnings)}))},rejections:{create:parsed.rejections.map(row=>({rowIndex:row.rowIndex,sourceRowKey:row.sourceRowKey,reasonCode:row.reasonCode,detailsJson:details(row.details)}))}}});
    snapshotId=created.id;
    await prisma.forebetCaptureAuditEvent.create({data:{eventType:"SNAPSHOT_CREATED",requestedDate:dateValue(date),snapshotId,detailsJson:details({source:FOREBET_SOURCE,date,hash:evidence.hash,counts:{rowsFound:parsed.rowsFound,valid:parsed.observations.length,rejected:parsed.rejections.length,duplicates:parsed.duplicateRows},parserVersion:FOREBET_PARSER_VERSION})}});
    await prisma.forebetCaptureAuditEvent.create({data:{eventType:"OBSERVATIONS_PERSISTED",requestedDate:dateValue(date),snapshotId,detailsJson:details({source:FOREBET_SOURCE,date,hash:evidence.hash,count:parsed.observations.length,parserVersion:FOREBET_PARSER_VERSION})}});
  }
  await prisma.$transaction([
    prisma.forebetCaptureAttempt.create({data:{...baseAttempt,status,snapshotId,warning:parsed.warnings.join("; ")||null}}),
    prisma.forebetCaptureAuditEvent.create({data:{eventType:status === "REUSED" ? "CAPTURE_REUSED" : status === "PARTIAL" ? "CAPTURE_PARTIAL" : "CAPTURE_SUCCEEDED",requestedDate:dateValue(date),snapshotId,detailsJson:details({source:FOREBET_SOURCE,date,hash:evidence.hash,counts:{rowsFound:parsed.rowsFound,valid:parsed.observations.length,rejected:parsed.rejections.length,duplicates:parsed.duplicateRows},parserVersion:FOREBET_PARSER_VERSION})}}),
  ]);
  const observations=[...parsed.observations].sort((a,b)=>a.sourceRowKey.localeCompare(b.sourceRowKey)).map(row=>({sourceRowKey:row.sourceRowKey,homeTeamRaw:row.homeTeamRaw,awayTeamRaw:row.awayTeamRaw,suggestedSide:row.suggestedSide,probabilityUnder25:row.probabilityUnder25,probabilityOver25:row.probabilityOver25,predictedHomeGoals:row.predictedHomeGoals,predictedAwayGoals:row.predictedAwayGoals,averageGoals:row.averageGoals,sourceOdds:row.sourceOdds,warnings:row.warnings}));
  const report={schemaVersion:"1.0" as const,source:FOREBET_SOURCE,sportDate:date,snapshot:{status,contentHash:evidence.hash,parserVersion:FOREBET_PARSER_VERSION,evidencePath:evidence.relativePath},counts:{rowsFound:parsed.rowsFound,valid:parsed.observations.length,rejected:parsed.rejections.length,duplicates:parsed.duplicateRows,warnings:parsed.warnings.length+parsed.observations.reduce((sum,row)=>sum+row.warnings.length,0)},observations,rejections:parsed.rejections.map(row=>({rowIndex:row.rowIndex,reasonCode:row.reasonCode})),warnings:parsed.warnings};
  forebetCaptureReportSchema.parse(report); canonicalHash(report);
  return report;
}
