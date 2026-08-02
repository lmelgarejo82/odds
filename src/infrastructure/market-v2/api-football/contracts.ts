import { z } from "zod";

export const API_FOOTBALL_CONTRACT_ERROR_CODES = [
  "INVALID_ENVELOPE",
  "API_ERRORS_PRESENT",
] as const;

export type ApiFootballContractErrorCode =
  (typeof API_FOOTBALL_CONTRACT_ERROR_CODES)[number];

export class ApiFootballContractError extends Error {
  readonly code: ApiFootballContractErrorCode;

  constructor(code: ApiFootballContractErrorCode) {
    super(
      code === "API_ERRORS_PRESENT"
        ? "API-Football returned provider errors"
        : "API-Football returned an invalid envelope",
    );
    this.name = "ApiFootballContractError";
    this.code = code;
  }

  toJSON(): Readonly<{ code: ApiFootballContractErrorCode; message: string }> {
    return Object.freeze({ code: this.code, message: this.message });
  }
}

const nonEmptyRawStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "string must not be empty");
const positiveIntegerSchema = z.number().int().positive();
const nullableScoreSchema = z.number().int().nonnegative().nullable();

export const apiFootballErrorsSchema = z.union([
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const apiFootballPagingSchema = z
  .object({
    current: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict();

export const apiFootballEnvelopeBaseSchema = z.object({
  get: nonEmptyRawStringSchema,
  parameters: z.record(z.string(), z.unknown()),
  errors: apiFootballErrorsSchema,
  results: z.number().int().nonnegative(),
  paging: apiFootballPagingSchema,
  response: z.unknown(),
});

const apiFootballTeamSchema = z.object({
  id: positiveIntegerSchema,
  name: nonEmptyRawStringSchema,
});

export const apiFootballScorePairSchema = z
  .object({
    home: nullableScoreSchema,
    away: nullableScoreSchema,
  })
  .strict();

export const apiFootballFixtureSchema = z.object({
  fixture: z.object({
    id: positiveIntegerSchema,
    date: z.iso.datetime({ offset: true }),
    timestamp: z.number().int(),
    timezone: nonEmptyRawStringSchema,
    status: z.object({
      long: nonEmptyRawStringSchema,
      short: nonEmptyRawStringSchema,
    }),
  }),
  league: z.object({
    id: positiveIntegerSchema,
    name: nonEmptyRawStringSchema,
    country: nonEmptyRawStringSchema,
    season: positiveIntegerSchema,
    round: nonEmptyRawStringSchema,
  }),
  teams: z.object({
    home: apiFootballTeamSchema,
    away: apiFootballTeamSchema,
  }),
  goals: apiFootballScorePairSchema,
  score: z.object({
    halftime: apiFootballScorePairSchema,
    fulltime: apiFootballScorePairSchema,
    extratime: apiFootballScorePairSchema,
    penalty: apiFootballScorePairSchema,
  }),
});

// Whitespace outside a provider percentage is accepted but normalized away.
export const apiFootballRawPercentageSchema = z
  .string()
  .trim()
  .regex(/^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/);

export const apiFootballPredictionSchema = z.object({
  predictions: z.object({
    winner: z
      .object({
        id: positiveIntegerSchema.nullable(),
        name: z.string().nullable(),
        comment: z.string().nullable(),
      })
      .nullable(),
    advice: z.string().nullable(),
    under_over: z.string().nullable(),
    goals: z.object({
      home: z.string().nullable(),
      away: z.string().nullable(),
    }),
    percent: z
      .object({
        home: apiFootballRawPercentageSchema,
        draw: apiFootballRawPercentageSchema,
        away: apiFootballRawPercentageSchema,
      })
      .strict(),
  }),
  teams: z.object({
    home: apiFootballTeamSchema,
    away: apiFootballTeamSchema,
  }),
});

export const apiFootballFixtureEnvelopeSchema = apiFootballEnvelopeBaseSchema.extend({
  response: z.array(apiFootballFixtureSchema),
});

export const apiFootballPredictionEnvelopeSchema = apiFootballEnvelopeBaseSchema.extend({
  response: z.array(apiFootballPredictionSchema),
});

export type ApiFootballDecodeResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: ApiFootballContractError }>;

function containsApiErrors(
  errors: z.infer<typeof apiFootballErrorsSchema>,
): boolean {
  return Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0;
}

function decodeApiFootballEnvelope<TSchema extends z.ZodType>(
  input: unknown,
  schema: TSchema,
): ApiFootballDecodeResult<z.output<TSchema>> {
  const envelope = apiFootballEnvelopeBaseSchema.safeParse(input);
  if (!envelope.success) {
    return Object.freeze({
      ok: false,
      error: new ApiFootballContractError("INVALID_ENVELOPE"),
    });
  }
  if (containsApiErrors(envelope.data.errors)) {
    return Object.freeze({
      ok: false,
      error: new ApiFootballContractError("API_ERRORS_PRESENT"),
    });
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return Object.freeze({
      ok: false,
      error: new ApiFootballContractError("INVALID_ENVELOPE"),
    });
  }
  return Object.freeze({ ok: true, data: parsed.data });
}

export function decodeApiFootballFixtureEnvelope(
  input: unknown,
): ApiFootballDecodeResult<ApiFootballFixtureEnvelope> {
  return decodeApiFootballEnvelope(input, apiFootballFixtureEnvelopeSchema);
}

export function decodeApiFootballPredictionEnvelope(
  input: unknown,
): ApiFootballDecodeResult<ApiFootballPredictionEnvelope> {
  return decodeApiFootballEnvelope(input, apiFootballPredictionEnvelopeSchema);
}

export const API_FOOTBALL_R0_STATUS_CODES = [
  "NS",
  "TBD",
  "FT",
  "AET",
  "PEN",
  "PST",
  "CANC",
] as const;

export type ApiFootballR0StatusCode =
  (typeof API_FOOTBALL_R0_STATUS_CODES)[number];
export type ApiFootballCanonicalFixtureStatus =
  | "SCHEDULED"
  | "POSTPONED"
  | "CANCELLED"
  | "FINISHED"
  | "UNKNOWN";

export type ApiFootballStatusClassification = Readonly<{
  rawCode: string;
  canonicalStatus: ApiFootballCanonicalFixtureStatus;
  terminal: boolean;
  blocked: boolean;
  preregistered: boolean;
}>;

const STATUS_CLASSIFICATIONS: Readonly<
  Record<
    ApiFootballR0StatusCode,
    Omit<ApiFootballStatusClassification, "rawCode" | "preregistered">
  >
> = Object.freeze({
  NS: Object.freeze({ canonicalStatus: "SCHEDULED", terminal: false, blocked: false }),
  TBD: Object.freeze({ canonicalStatus: "UNKNOWN", terminal: false, blocked: true }),
  FT: Object.freeze({ canonicalStatus: "FINISHED", terminal: true, blocked: false }),
  AET: Object.freeze({ canonicalStatus: "FINISHED", terminal: true, blocked: false }),
  PEN: Object.freeze({ canonicalStatus: "FINISHED", terminal: true, blocked: false }),
  PST: Object.freeze({ canonicalStatus: "POSTPONED", terminal: false, blocked: true }),
  CANC: Object.freeze({ canonicalStatus: "CANCELLED", terminal: false, blocked: true }),
});

function isApiFootballR0StatusCode(value: string): value is ApiFootballR0StatusCode {
  return (API_FOOTBALL_R0_STATUS_CODES as readonly string[]).includes(value);
}

export function classifyApiFootballStatus(rawCode: string): ApiFootballStatusClassification {
  if (!isApiFootballR0StatusCode(rawCode)) {
    return Object.freeze({
      rawCode,
      canonicalStatus: "UNKNOWN",
      terminal: false,
      blocked: true,
      preregistered: false,
    });
  }
  return Object.freeze({
    rawCode,
    ...STATUS_CLASSIFICATIONS[rawCode],
    preregistered: true,
  });
}

export type ApiFootballResult1X2 = "HOME" | "DRAW" | "AWAY";
export type ApiFootballShootoutWinner = "HOME" | "AWAY";
export type ApiFootballOutcomeResolutionCode =
  | "RESOLVED"
  | "NON_TERMINAL_STATUS"
  | "FULLTIME_SCORE_INCOMPLETE";

export type ApiFootballRegulationOutcome = Readonly<{
  rawStatusCode: string;
  resolutionCode: ApiFootballOutcomeResolutionCode;
  result1X2: ApiFootballResult1X2 | null;
  shootoutWinner: ApiFootballShootoutWinner | null;
  fulltime: ApiFootballScorePair;
  extratime: ApiFootballScorePair;
  penalty: ApiFootballScorePair;
}>;

function resultFromScore(
  score: ApiFootballScorePair,
): ApiFootballResult1X2 | null {
  if (score.home === null || score.away === null) return null;
  if (score.home > score.away) return "HOME";
  if (score.away > score.home) return "AWAY";
  return "DRAW";
}

function shootoutWinnerFromScore(
  score: ApiFootballScorePair,
): ApiFootballShootoutWinner | null {
  const result = resultFromScore(score);
  return result === "HOME" || result === "AWAY" ? result : null;
}

export function deriveApiFootballRegulationOutcome(
  rawStatusCode: string,
  score: Pick<ApiFootballFixtureDto["score"], "fulltime" | "extratime" | "penalty">,
): ApiFootballRegulationOutcome {
  const classification = classifyApiFootballStatus(rawStatusCode);
  const shootoutWinner =
    rawStatusCode === "PEN" ? shootoutWinnerFromScore(score.penalty) : null;
  if (!classification.terminal) {
    return Object.freeze({
      rawStatusCode,
      resolutionCode: "NON_TERMINAL_STATUS",
      result1X2: null,
      shootoutWinner,
      ...score,
    });
  }
  const result1X2 = resultFromScore(score.fulltime);
  return Object.freeze({
    rawStatusCode,
    resolutionCode: result1X2 === null ? "FULLTIME_SCORE_INCOMPLETE" : "RESOLVED",
    result1X2,
    shootoutWinner,
    ...score,
  });
}

export type ApiFootballScorePair = z.infer<typeof apiFootballScorePairSchema>;
export type ApiFootballFixtureDto = z.infer<typeof apiFootballFixtureSchema>;
export type ApiFootballPredictionDto = z.infer<typeof apiFootballPredictionSchema>;
export type ApiFootballFixtureEnvelope = z.infer<typeof apiFootballFixtureEnvelopeSchema>;
export type ApiFootballPredictionEnvelope = z.infer<
  typeof apiFootballPredictionEnvelopeSchema
>;
