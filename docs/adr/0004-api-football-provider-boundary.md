# ADR 0004 — API-Football como proveedor de fixtures, predicciones y resultados

- Estado: aceptado.
- Alcance: Market V2 prospectivo R0.
- Resultado previo: `API_FOOTBALL_PILOT_FEASIBLE`.

## Contexto

La validación prospectiva concluyó que API-Football puede aportar fixtures, predicciones y
resultados al piloto R0 bajo una frontera gobernada. El proveedor no ofrece un timestamp interno
fiable para cada prediction, por lo que Market V2 registra su propio `capturedAtUtc` al publicar
la evidencia. Esa captura no puede seleccionarse retrospectivamente ni utilizar información
posterior al kickoff.

API-Football no es la fuente de cuotas de esta arquitectura. Un adapter futuro y separado de The
Odds API podrá aportar cuotas de múltiples bookmakers y su `market.last_update`. Ese adapter no
existe en este lote y nunca se presumirán identificadores compartidos entre proveedores.

La evidencia raw se conserva antes de ejecutar cualquier mapper. El lote no habilita captura real,
runner, apuestas automáticas ni afirmaciones de rentabilidad.

## Decisión

API-Football queda limitado a:

- identidad externa de fixture, kickoff UTC, competición y status;
- resultados observados y sus estados terminales;
- predicciones source-neutral `HOME`, `DRAW` y `AWAY`;
- evidencia raw inmutable y content-addressed previa al mapper;
- snapshots y auditorías append-only;
- presupuesto obligatorio, circuit breaker compartido por run y auditoría por intento.

`PREMATCH` y `OUTCOME` son workflows separados. PREMATCH obtiene el fixture antes de la
prediction, exige binding canónico explícito y conserva `capturedAtUtc < kickoffAtUtc`. OUTCOME
resuelve resultados en una invocación posterior sin leer predicciones ni decisiones.

El matching permanece provider-neutral. Compara kickoff UTC, home y away normalizados,
competición, orientación y una tolerancia versionada. Un conflicto de orientación o competición y
cualquier ambigüedad bloquean; ningún ID externo se convierte por suposición en `Fixture.id`.

## Fronteras

- PREMATCH no usa outcomes, closing ni datos posteriores.
- OUTCOME no usa predicciones ni decisiones y no modifica decisiones existentes.
- `PredictionSnapshot` no es `OddsSnapshot`; tampoco reutiliza
  `MarketProbabilitySnapshot`.
- `winner.comment` y `advice` son metadata y no generan Double Chance.
- `underOverRaw` se conserva como metadata y no se convierte en mercado.
- `score.fulltime` determina el 1X2 reglamentario; `shootoutWinner` permanece separado.
- La evidencia raw se publica antes del mapper y sus bytes no se almacenan en SQLite.
- Replay, creación y conflicto son resultados distintos; no existen overwrite, update o delete.
- El cliente usa host HTTPS fijo, GET, redirects bloqueados y `fetch` inyectado.
- El matcher no realiza fuzzy auto-selection, nearest-event selection ni ranking implícito.
- Un timestamp interno del proveedor no sustituye `capturedAtUtc` para la cronología.

## Consecuencias

Positivas:

- evidencia, intentos y decisiones futuras quedan trazables;
- la cronología puede verificarse sin confiar en timestamps internos ausentes;
- replays y conflictos son reproducibles;
- los límites de transporte y presupuesto reducen el radio de daño;
- la separación de workflows impide leakage postmatch.

Negativas:

- aumenta el número de componentes y puertos;
- toda prediction requiere un `capturedAtUtc` propio;
- el matching end-to-end y su persistencia siguen diferidos;
- el runner real permanece diferido;
- algunos tipos operativos concretos de budget, circuit breaker y evidence store todavía
  atraviesan application desde infrastructure.

La última limitación es deuda arquitectónica para una futura inversión de dependencias. No añade
IO global, no cambia el comportamiento validado y no forma parte de esta remediación.

## Alternativas rechazadas

- Presumir IDs compartidos entre proveedores.
- Elegir automáticamente mediante fuzzy matching o el evento más cercano.
- Sobrescribir snapshots, evidencia, auditorías o resultados.
- Consultar outcomes durante PREMATCH.
- Almacenar body raw en SQLite.
- Usar odds de API-Football.
- Reutilizar `MarketProbabilitySnapshot` para predictions.
- Interpretar `advice` como un mercado.
- Sobrescribir el empate reglamentario con el ganador de penales.

## Seguimiento

- abstraer puertos de governance y evidence para invertir las dependencias pendientes;
- implementar y autorizar por separado el adapter de The Odds API;
- evaluar una persistencia explícita del matching provider-neutral;
- diseñar un runner real únicamente en un lote autorizado;
- ejecutar una primera captura real controlada con presupuesto y targets explícitos;
- completar la evaluación prospectiva R0 sin selección retrospectiva.
