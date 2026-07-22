import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { STATAREA_LEGACY_CAPTURE_POLICY_VERSION, STATAREA_LEGACY_ENDPOINT_TEMPLATE, STATAREA_MODERN_ENDPOINT_TEMPLATE } from "@/domain/statarea/legacy-constants";

export async function ensureModernStatareaProfiles(prisma:PrismaClient):Promise<number>{
  const snapshots=await prisma.statareaCaptureSnapshot.findMany({where:{parserVersion:"statarea-daily-raw/1.0.0",profile:null},orderBy:{createdAt:"asc"}});let created=0;
  for(const snapshot of snapshots){const attempt=await prisma.statareaCaptureAttempt.findFirst({where:{snapshotId:snapshot.id},orderBy:{capturedAt:"asc"}});const date=snapshot.requestedDate.toISOString().slice(0,10);await prisma.statareaSnapshotProfile.create({data:{id:randomUUID(),snapshotId:snapshot.id,sourcePresentation:"MODERN",endpointTemplate:STATAREA_MODERN_ENDPOINT_TEMPLATE,requestedUrl:attempt?.requestedUrl??`https://www.statarea.com/predictions/date/${date}/competition`,finalUrl:attempt?.finalUrl??`https://www.statarea.com/predictions/date/${date}/competition`,parserVersion:snapshot.parserVersion,capturePolicyVersion:"statarea-modern-controlled/1.0.0"}});created++}
  return created;
}

export async function ensureLegacyRecoveryPolicy(prisma:PrismaClient,datasetId:string):Promise<boolean>{
  const existing=await prisma.historicalDatasetCapturePolicy.findUnique({where:{datasetId_version:{datasetId,version:STATAREA_LEGACY_CAPTURE_POLICY_VERSION}}});if(existing)return false;
  await prisma.historicalDatasetCapturePolicy.create({data:{id:randomUUID(),datasetId,version:STATAREA_LEGACY_CAPTURE_POLICY_VERSION,sourcePresentation:"LEGACY_OFFICIAL",endpointTemplate:STATAREA_LEGACY_ENDPOINT_TEMPLATE,concurrency:1,minimumPauseMs:5000,timeoutMs:20000,maxBytes:5000000,maxRedirects:2,maxTechnicalRetries:1}});return true;
}
