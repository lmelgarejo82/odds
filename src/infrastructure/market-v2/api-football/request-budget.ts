export type RequestBudgetSnapshot = Readonly<{
  maxAttempts: number;
  reservedAttempts: number;
  startedAttempts: number;
  remainingAttempts: number;
}>;

export type RequestReservation = Readonly<{ reservationId: number }>;

export type RequestReservationResult =
  | Readonly<{ disposition: "RESERVED"; reservation: RequestReservation }>
  | Readonly<{ disposition: "EXHAUSTED" | "INVALID_STATE" }>;

export type RequestCommitResult =
  | Readonly<{ disposition: "RESERVED"; attemptNumber: number }>
  | Readonly<{ disposition: "INVALID_STATE" }>;

export type RequestReleaseResult = Readonly<{
  disposition: "RESERVED" | "INVALID_STATE";
}>;

export class RequestBudget {
  readonly #maxAttempts: number;
  readonly #reservations = new Map<
    RequestReservation,
    "RESERVED" | "STARTED" | "RELEASED"
  >();
  #nextReservationId = 1;
  #startedAttempts = 0;

  constructor(maxAttempts: number) {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts must be a positive safe integer");
    }
    this.#maxAttempts = maxAttempts;
  }

  inspect(): RequestBudgetSnapshot {
    const reservedAttempts = [...this.#reservations.values()].filter(
      (state) => state === "RESERVED",
    ).length;
    return Object.freeze({
      maxAttempts: this.#maxAttempts,
      reservedAttempts,
      startedAttempts: this.#startedAttempts,
      remainingAttempts: this.#maxAttempts - this.#startedAttempts - reservedAttempts,
    });
  }

  reserve(): RequestReservationResult {
    if (this.inspect().remainingAttempts <= 0) {
      return Object.freeze({ disposition: "EXHAUSTED" });
    }
    const reservation = Object.freeze({ reservationId: this.#nextReservationId });
    this.#nextReservationId += 1;
    this.#reservations.set(reservation, "RESERVED");
    return Object.freeze({ disposition: "RESERVED", reservation });
  }

  commit(reservation: RequestReservation): RequestCommitResult {
    if (this.#reservations.get(reservation) !== "RESERVED") {
      return Object.freeze({ disposition: "INVALID_STATE" });
    }
    this.#reservations.set(reservation, "STARTED");
    this.#startedAttempts += 1;
    return Object.freeze({ disposition: "RESERVED", attemptNumber: this.#startedAttempts });
  }

  release(reservation: RequestReservation): RequestReleaseResult {
    if (this.#reservations.get(reservation) !== "RESERVED") {
      return Object.freeze({ disposition: "INVALID_STATE" });
    }
    this.#reservations.set(reservation, "RELEASED");
    return Object.freeze({ disposition: "RESERVED" });
  }
}
