import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  statareaCaptureContractSchema,
  type StatareaCaptureContract,
} from "@/contracts/statarea-capture";
import { canonicalHash } from "@/domain/canonical-hash";
import {
  STATAREA_PARSER_VERSION,
  STATAREA_SOURCE,
  STATAREA_UNVERIFIED_HEADERS,
  buildStatareaUrl,
  validateStatareaDate,
} from "@/domain/statarea/constants";
import { parseStatareaRaw } from "@/domain/statarea/parser";
import { preserveSourceEvidence } from "@/infrastructure/forebet/evidence-store";
import { preserveStatareaExport } from "@/infrastructure/statarea/export-store";
import {
  fetchStatarea,
  type StatareaHttpResponse,
} from "@/infrastructure/statarea/http-client";
type Deps = {
  prisma: PrismaClient;
  fetcher?: (date: string) => Promise<StatareaHttpResponse>;
};
const dv = (d: string) => new Date(`${d}T00:00:00.000Z`);
const j = (v: unknown) => JSON.stringify(v);
export async function captureStatarea(
  date: string,
  { prisma, fetcher = fetchStatarea }: Deps,
): Promise<StatareaCaptureContract> {
  validateStatareaDate(date);
  const requestedUrl = buildStatareaUrl(date).toString();
  await prisma.statareaCaptureAuditEvent.create({
    data: {
      eventType: "CAPTURE_STARTED",
      requestedDate: dv(date),
      detailsJson: j({
        source: STATAREA_SOURCE,
        date,
        url: requestedUrl,
        parserVersion: STATAREA_PARSER_VERSION,
      }),
    },
  });
  let response: StatareaHttpResponse;
  try {
    response = await fetcher(date);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CAPTURE_ERROR";
    await prisma.$transaction([
      prisma.statareaCaptureAttempt.create({
        data: {
          requestedDate: dv(date),
          requestedUrl,
          capturedAt: new Date(),
          parserVersion: STATAREA_PARSER_VERSION,
          status: "FAILED",
          errorCode: code,
        },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "CAPTURE_FAILED",
          requestedDate: dv(date),
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            url: requestedUrl,
            error: code,
            parserVersion: STATAREA_PARSER_VERSION,
          }),
        },
      }),
    ]);
    throw error;
  }
  const evidence = await preserveSourceEvidence(
    "statarea",
    date,
    response.body,
  );
  const base = {
    requestedDate: dv(date),
    requestedUrl: response.requestedUrl,
    finalUrl: response.finalUrl,
    hostname: response.hostname,
    capturedAt: response.capturedAt,
    httpStatus: response.httpStatus,
    contentType: response.contentType,
    byteSize: response.body.byteLength,
    contentHash: evidence.hash,
    parserVersion: STATAREA_PARSER_VERSION,
  };
  await prisma.statareaCaptureAuditEvent.create({
    data: {
      eventType: "RESPONSE_RECEIVED",
      requestedDate: dv(date),
      detailsJson: j({
        source: STATAREA_SOURCE,
        date,
        url: response.finalUrl,
        hostname: response.hostname,
        httpStatus: response.httpStatus,
        contentType: response.contentType,
        byteSize: response.body.byteLength,
        hash: evidence.hash,
        parserVersion: STATAREA_PARSER_VERSION,
      }),
    },
  });
  const html = response.body.toString("utf8");
  const failure =
    response.httpStatus !== 200
      ? `HTTP_${response.httpStatus}`
      : !response.contentType.toLowerCase().includes("text/html")
        ? "INVALID_CONTENT_TYPE"
        : !response.body.length
          ? "EMPTY_CONTENT"
          : /captcha|cf-chl-|access denied/i.test(html)
            ? "BLOCKED_CONTENT"
            : null;
  if (failure) {
    await prisma.$transaction([
      prisma.statareaCaptureAttempt.create({
        data: { ...base, status: "FAILED", errorCode: failure },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "CAPTURE_FAILED",
          requestedDate: dv(date),
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            hash: evidence.hash,
            error: failure,
          }),
        },
      }),
    ]);
    throw new Error(failure);
  }
  const parsed = parseStatareaRaw(html, date);
  if (!parsed.rows.length) {
    await prisma.$transaction([
      prisma.statareaCaptureAttempt.create({
        data: { ...base, status: "FAILED", errorCode: "ZERO_VALID_ROWS" },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "CAPTURE_FAILED",
          requestedDate: dv(date),
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            hash: evidence.hash,
            error: "ZERO_VALID_ROWS",
            rowsFound: parsed.rowsFound,
          }),
        },
      }),
    ]);
    throw new Error("ZERO_VALID_ROWS");
  }
  const existing = await prisma.statareaCaptureSnapshot.findUnique({
    where: {
      requestedDate_contentHash_parserVersion: {
        requestedDate: dv(date),
        contentHash: evidence.hash,
        parserVersion: STATAREA_PARSER_VERSION,
      },
    },
  });
  const snapshotId = existing?.id ?? randomUUID();
  const exportPath = `var/exports/statarea/${date}/${snapshotId}.json`;
  const status: "SUCCEEDED" | "PARTIAL" | "REUSED" = existing
    ? "REUSED"
    : parsed.rejections.length
      ? "PARTIAL"
      : "SUCCEEDED";
  const warningCount =
    parsed.warnings.length +
    parsed.rows.reduce((sum, row) => sum + row.warnings.length, 0);
  const contract = {
    contractVersion: "1.0" as const,
    source: STATAREA_SOURCE,
    requestedDate: date,
    captureAttempt: {
      status,
      requestedUrl: response.requestedUrl,
      finalUrl: response.finalUrl,
      hostname: response.hostname as "www.statarea.com",
      httpStatus: response.httpStatus,
      contentType: response.contentType,
      capturedAt: response.capturedAt.toISOString(),
      byteSize: response.body.byteLength,
    },
    snapshot: {
      id: snapshotId,
      contentHash: evidence.hash,
      evidencePath: evidence.relativePath,
      exportPath,
    },
    parserVersion: STATAREA_PARSER_VERSION,
    counts: {
      rowsFound: parsed.rowsFound,
      valid: parsed.rows.length,
      rejected: parsed.rejections.length,
      duplicates: parsed.duplicateRows,
      warnings: warningCount,
      unverifiedColumns: STATAREA_UNVERIFIED_HEADERS.length,
    },
    rows: [...parsed.rows]
      .sort((a, b) => a.sourceRowKey.localeCompare(b.sourceRowKey))
      .map((row) => ({
        sourceRowKey: row.sourceRowKey,
        rowDateRaw: row.rowDateRaw,
        kickoffRaw: row.kickoffRaw,
        competitionRaw: row.competitionRaw,
        countryRaw: row.countryRaw,
        categoryRaw: row.categoryRaw,
        homeTeamRaw: row.homeTeamRaw,
        awayTeamRaw: row.awayTeamRaw,
        orientation: row.orientation,
        rawColumns: row.rawColumns,
        semanticStatus: row.semanticStatus,
        warnings: row.warnings,
      })),
    rejectedRows: parsed.rejections.map((row) => ({
      rowIndex: row.rowIndex,
      reasonCode: row.reasonCode,
    })),
    rawHeaders: parsed.rawHeaders,
    semanticRegistry: parsed.semanticRegistry,
    warnings: parsed.warnings,
    qualityStatus: (parsed.rejections.length ? "PARTIAL" : "CONTROLLED") as
      "PARTIAL" | "CONTROLLED",
  };
  statareaCaptureContractSchema.parse(contract);
  canonicalHash(contract);
  if (!existing) {
    await preserveStatareaExport(date, snapshotId, contract);
    await prisma.statareaCaptureSnapshot.create({
      data: {
        id: snapshotId,
        requestedDate: dv(date),
        contentHash: evidence.hash,
        parserVersion: STATAREA_PARSER_VERSION,
        evidencePath: evidence.relativePath,
        exportPath,
        rawHeadersJson: j(parsed.rawHeaders),
        semanticRegistryJson: j(parsed.semanticRegistry),
        rowsFound: parsed.rowsFound,
        validRows: parsed.rows.length,
        rejectedRows: parsed.rejections.length,
        duplicateRows: parsed.duplicateRows,
        warningCount,
        rows: {
          create: parsed.rows.map((row) => ({
            source: "STATAREA",
            requestedDate: dv(date),
            rowDateRaw: row.rowDateRaw,
            kickoffRaw: row.kickoffRaw,
            competitionRaw: row.competitionRaw,
            countryRaw: row.countryRaw,
            categoryRaw: row.categoryRaw,
            homeTeamRaw: row.homeTeamRaw,
            awayTeamRaw: row.awayTeamRaw,
            orientation: row.orientation,
            rowTextRaw: row.rowTextRaw,
            rawColumnsJson: j(row.rawColumns),
            structuralAttributesJson: j(row.structuralAttributes),
            sourceRowKey: row.sourceRowKey,
            parserVersion: STATAREA_PARSER_VERSION,
            parseStatus: row.parseStatus,
            semanticStatus: row.semanticStatus,
            warningsJson: j(row.warnings),
          })),
        },
        rejections: {
          create: parsed.rejections.map((row) => ({
            rowIndex: row.rowIndex,
            sourceRowKey: row.sourceRowKey,
            reasonCode: row.reasonCode,
            detailsJson: j(row.details),
          })),
        },
      },
    });
    await prisma.$transaction([
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "SNAPSHOT_CREATED",
          requestedDate: dv(date),
          snapshotId,
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            hash: evidence.hash,
            counts: contract.counts,
          }),
        },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "ROWS_PERSISTED",
          requestedDate: dv(date),
          snapshotId,
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            count: parsed.rows.length,
          }),
        },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "ROWS_REJECTED",
          requestedDate: dv(date),
          snapshotId,
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            count: parsed.rejections.length,
          }),
        },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "EXPORT_GENERATED",
          requestedDate: dv(date),
          snapshotId,
          detailsJson: j({ source: STATAREA_SOURCE, date, exportPath }),
        },
      }),
      prisma.statareaCaptureAuditEvent.create({
        data: {
          eventType: "CONTRACT_VALIDATED",
          requestedDate: dv(date),
          snapshotId,
          detailsJson: j({
            source: STATAREA_SOURCE,
            date,
            validators: ["ZOD", "AJV"],
          }),
        },
      }),
    ]);
  }
  await prisma.$transaction([
    prisma.statareaCaptureAttempt.create({
      data: {
        ...base,
        status,
        snapshotId,
        warning: parsed.warnings.join("; ") || null,
      },
    }),
    prisma.statareaCaptureAuditEvent.create({
      data: {
        eventType: existing
          ? "SNAPSHOT_REUSED"
          : status === "PARTIAL"
            ? "CAPTURE_PARTIAL"
            : "CAPTURE_SUCCEEDED",
        requestedDate: dv(date),
        snapshotId,
        detailsJson: j({
          source: STATAREA_SOURCE,
          date,
          hash: evidence.hash,
          counts: contract.counts,
        }),
      },
    }),
  ]);
  return contract;
}
