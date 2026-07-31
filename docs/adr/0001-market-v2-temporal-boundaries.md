# ADR 0001: fronteras temporales de Market V2

- Estado: aceptado
- Fecha: 2026-07-31

## Problema

El sistema necesita conservar evidencia reproducible y generar decisiones prepartido sin contaminación por información futura. El esquema histórico existente y la base legacy no ofrecen una frontera segura para evolucionar Market V2 ni deben modificarse.

## Decisión

Market V2 se implementa como un dominio independiente con cuatro fronteras unidireccionales:

```text
capture ──> decision ──> outcome ──> evaluation
   │            │            │             │
evidence     no future     corrections   reads decision
snapshots      data        append-only    + outcome
```

Capture conserva artefactos, procedencia y snapshots. Decision solo puede leer fixture, snapshots Forebet, cuotas y probabilidades de mercado derivadas. Outcome se incorpora después del evento y nunca es una entrada del motor de decisión. Evaluation puede combinar una decisión ya fijada con un outcome identificable.

Market V2 usa `prisma/market-v2/schema.prisma`, un cliente generado separado y una futura base `var/market-v2/market-v2.sqlite`. No cambia el datasource ni las migraciones históricas. Todos los comandos Prisma deben indicar `--schema prisma/market-v2/schema.prisma`.

## Reglas temporales

- Los timestamps de dominio son UTC RFC 3339 normalizados con `Z`.
- Una decisión prepartido satisface `oddsCapturedAtUtc <= decidedAtUtc < kickoffAtUtc`.
- Una cuota seleccionada pertenece al mismo fixture y representa exactamente la disponibilidad utilizada al decidir.
- Los cálculos derivados identifican el conjunto exacto de `OddsSnapshot` utilizado.
- Una corrección de outcome pertenece al mismo fixture y no puede observarse antes que la versión sustituida.
- Los validadores reciben todos los tiempos; no consultan el reloj del sistema.

## Append-only

`SourceArtifact`, `ForebetSnapshot`, `OddsSnapshot`, `MarketProbabilitySnapshot`, `PreMatchDecision`, `Outcome` y `Settlement` rechazan `UPDATE` y `DELETE` mediante triggers SQLite. Una corrección o reevaluación se representa con filas nuevas y referencias explícitas. Las barreras de base complementan, pero no sustituyen, las validaciones de dominio.

## Consecuencias

- Es posible reconstruir qué evidencia y cuota existían al tomar cada decisión.
- La abstención queda conservada y puede evaluarse sin sesgo de supervivencia.
- Las correcciones aumentan el volumen y obligan a escoger explícitamente la versión de outcome.
- Algunas invariantes entre tablas requieren transacciones y validación de aplicación además de claves foráneas.
- Este lote define contratos y persistencia mínima; no captura, calcula probabilidades sofisticadas, predice, apuesta ni ofrece UI.

## Alternativas rechazadas

- Reutilizar `prisma/dev.db` o ampliar el schema legacy: mezcla ciclos de vida y permite contaminación accidental.
- Sobrescribir snapshots, decisiones u outcomes: destruye la trazabilidad temporal.
- Dar acceso a outcomes al motor de decisión: introduce fuga de información futura.
- Modelar mercados con strings aislados en cada cuota: impide versionado y evolución coherente.

## Relación con el legacy

El legacy es una referencia histórica externa y de solo lectura. No se importan datos, constantes, migraciones, runs ni identificadores. Market V2 comienza vacío y con una base propia; cualquier migración futura desde legacy deberá ser otro lote explícitamente autorizado y auditable.
