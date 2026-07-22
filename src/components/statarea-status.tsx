import { database } from "@/infrastructure/database";

const formatter = new Intl.DateTimeFormat("es-PY", {
  timeZone: "America/Asuncion",
  dateStyle: "medium",
  timeStyle: "medium",
});

export async function StatareaStatus() {
  const latest = await database.statareaCaptureAttempt.findFirst({
    orderBy: { capturedAt: "desc" },
    include: { snapshot: true },
  });
  if (!latest)
    return (
      <section className="panel forebet-status">
        <span className="eyebrow">Fuente · Statarea</span>
        <h2>Sin capturas</h2>
        <p>La captura raw controlada todavía no fue ejecutada.</p>
      </section>
    );
  const snapshot = latest.snapshot;
  return (
    <section className="panel forebet-status">
      <span className="eyebrow">Fuente · Statarea</span>
      <div className="section-heading">
        <h2>{latest.status}</h2>
        <span className="date">{formatter.format(latest.capturedAt)}</span>
      </div>
      <dl>
        <div>
          <dt>Fecha solicitada</dt>
          <dd>{latest.requestedDate.toISOString().slice(0, 10)}</dd>
        </div>
        <div>
          <dt>HTTP</dt>
          <dd>{latest.httpStatus ?? "—"}</dd>
        </div>
        <div>
          <dt>Filas encontradas</dt>
          <dd>{snapshot?.rowsFound ?? 0}</dd>
        </div>
        <div>
          <dt>Válidas</dt>
          <dd>{snapshot?.validRows ?? 0}</dd>
        </div>
        <div>
          <dt>Rechazadas / duplicadas</dt>
          <dd>
            {snapshot?.rejectedRows ?? 0} / {snapshot?.duplicateRows ?? 0}
          </dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{snapshot?.warningCount ?? 0}</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>{latest.contentHash?.slice(0, 12) ?? "—"}</dd>
        </div>
        <div>
          <dt>Parser</dt>
          <dd>{latest.parserVersion}</dd>
        </div>
        <div>
          <dt>Columnas UNVERIFIED</dt>
          <dd>6</dd>
        </div>
        <div>
          <dt>Calidad</dt>
          <dd>
            {latest.status === "FAILED"
              ? "Fallo cerrado"
              : snapshot?.rejectedRows
                ? "Parcial"
                : "Raw controlada"}
          </dd>
        </div>
      </dl>
      <p>
        Los valores de 1.5, 2.5, 3.5, BTS, OTS y TIP no se interpretan como
        señales.
      </p>
    </section>
  );
}
