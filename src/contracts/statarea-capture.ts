import { z } from "zod";
export const semanticStatusSchema = z.enum([
  "VERIFIED",
  "STRUCTURALLY_MAPPED",
  "STRUCTURALLY_MAPPED_WITH_LABEL_EVIDENCE",
  "UNVERIFIED",
  "CONFLICTING",
  "NOT_APPLICABLE",
]);
const rawColumn = z
  .object({
    key: z.string().max(50),
    headerRaw: z.string().max(20),
    valueRaw: z.string().max(100),
    ordinal: z.number().int().nonnegative(),
    semanticStatus: semanticStatusSchema,
    semanticEvidence: z.string().max(300).nullable(),
    normalizedValue: z.null(),
    classes: z.array(z.string().max(80)).max(10),
  })
  .strict();
const rawRow = z
  .object({
    sourceRowKey: z.string().regex(/^[a-f0-9]{64}$/),
    rowDateRaw: z.string().max(10).nullable(),
    kickoffRaw: z.string().max(20).nullable(),
    competitionRaw: z.string().max(300).nullable(),
    countryRaw: z.string().max(100).nullable(),
    categoryRaw: z.string().max(100).nullable(),
    homeTeamRaw: z.string().min(1).max(300),
    awayTeamRaw: z.string().min(1).max(300),
    orientation: z.literal("HOST_GUEST_DOM"),
    rawColumns: z.array(rawColumn).length(12),
    semanticStatus: z.literal("STRUCTURALLY_MAPPED"),
    warnings: z.array(z.string().max(200)),
  })
  .strict();
export const statareaCaptureContractSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    source: z.literal("STATAREA"),
    requestedDate: z.iso.date(),
    captureAttempt: z
      .object({
        status: z.enum(["SUCCEEDED", "PARTIAL", "REUSED"]),
        requestedUrl: z.url(),
        finalUrl: z.url(),
        hostname: z.literal("www.statarea.com"),
        httpStatus: z.number().int(),
        contentType: z.string().max(100),
        capturedAt: z.iso.datetime(),
        byteSize: z.number().int().positive(),
      })
      .strict(),
    snapshot: z
      .object({
        id: z.string().min(1),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        evidencePath: z.string().startsWith("var/evidence/statarea/"),
        exportPath: z.string().startsWith("var/exports/statarea/"),
      })
      .strict(),
    parserVersion: z.string().min(1),
    counts: z
      .object({
        rowsFound: z.number().int().nonnegative(),
        valid: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        duplicates: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        unverifiedColumns: z.number().int().nonnegative(),
      })
      .strict(),
    rows: z.array(rawRow),
    rejectedRows: z.array(
      z
        .object({
          rowIndex: z.number().int().nonnegative(),
          reasonCode: z.string().min(1).max(100),
        })
        .strict(),
    ),
    rawHeaders: z.array(z.string().max(20)).length(12),
    semanticRegistry: z
      .array(
        z
          .object({
            headerRaw: z.string().max(20),
            semanticStatus: semanticStatusSchema,
            evidence: z.string().max(300),
          })
          .strict(),
      )
      .length(12),
    warnings: z.array(z.string().max(300)),
    qualityStatus: z.enum(["CONTROLLED", "PARTIAL"]),
  })
  .strict()
  .superRefine((value, context) => {
    const deferred = new Set(["TIP", "1.5", "2.5", "3.5", "BTS", "OTS"]);
    for (const [rowIndex, row] of value.rows.entries()) {
      for (const [columnIndex, column] of row.rawColumns.entries()) {
        if (deferred.has(column.headerRaw) && column.semanticStatus !== "UNVERIFIED") {
          context.addIssue({
            code: "custom",
            path: ["rows", rowIndex, "rawColumns", columnIndex, "semanticStatus"],
            message: `${column.headerRaw} debe permanecer UNVERIFIED en B003`,
          });
        }
      }
    }
    for (const [index, entry] of value.semanticRegistry.entries()) {
      if (deferred.has(entry.headerRaw) && entry.semanticStatus !== "UNVERIFIED") {
        context.addIssue({
          code: "custom",
          path: ["semanticRegistry", index, "semanticStatus"],
          message: `${entry.headerRaw} debe permanecer UNVERIFIED en B003`,
        });
      }
    }
  });
export type StatareaCaptureContract = z.infer<
  typeof statareaCaptureContractSchema
>;
