# Operación controlada de API-Football para R0

Esta guía describe condiciones para una ejecución futura autorizada. No habilita un runner, no
declara el sistema listo para producción y no constituye una recomendación de apuestas.

## A. Alcance

API-Football se limita a fixture, prediction y outcome. No se usan sus odds. Este flujo no incluye
The Odds API ni apuestas automáticas. Prediction y odds permanecen conceptos distintos.

## B. Precondiciones

- Rama y commit revisados y aprobados.
- Working tree limpio y migraciones aplicadas conscientemente.
- Base Market V2 seleccionada de forma explícita, nunca una base legacy.
- Raíz de evidencia explícita, nueva o ya autorizada, sin symlinks.
- Provider configurado sin exponer su credencial.
- `maxAttempts`, threshold diario y targets definidos antes del run.
- Un budget obligatorio y un circuit breaker compartido durante todo el run.
- Transporte falso validado localmente antes de autorizar red.

## C. Credencial externa

La credencial se entrega externamente al proceso con el nombre `API_FOOTBALL_KEY`. Nunca se
incluye en una URL, log, error, SQLite, artefacto, packet o reporte. El proceso no muestra su valor
ni registra características que permitan inferirlo. No existe fallback a otra credencial.

## D. Seguridad HTTP

- Origen HTTPS fijo del proveedor oficial.
- Método GET y endpoints allowlisted para fixtures y predictions.
- Redirects bloqueados.
- Timeout y máximo de bytes obligatorios.
- `fetch` inyectado; no existe fallback global.
- No existe una operación pública de request genérico ni se aceptan URLs arbitrarias.
- Headers, payloads y sesiones no se vuelcan en errores o logs.

## E. Presupuesto y límites

- `maxAttempts` es obligatorio y cada intento de transporte consume presupuesto.
- Los retries también consumen presupuesto y permanecen acotados.
- `dailyRemaining < 20` bloquea llamadas posteriores del run.
- `minuteRemaining = 0` bloquea inmediatamente.
- Headers inválidos bloquean; los headers ausentes no se inventan ni se infieren.
- Un 429 solo puede reintentarse con un `Retry-After` válido.
- Cada intento conserva una auditoría saneada, incluso cuando falla.
- No se reintenta después de una persistencia satisfactoria.

## F. Collector PREMATCH

1. Recibe un binding canónico explícito; no descubre `Fixture.id` por similitud.
2. Consulta y valida el fixture antes de solicitar la prediction.
3. Selecciona exactamente el `providerFixtureId` esperado.
4. Exige status `NS`, kickoff futuro y `capturedAtUtc < kickoffAtUtc`.
5. Publica evidencia raw antes de mapear.
6. Persiste identidad, snapshot y probabilidades mediante operaciones append-only.

PREMATCH no consulta outcomes, closing, decisiones ni odds.

## G. Resolver OUTCOME

El resolver se invoca por separado y no contiene polling interno. Acepta estados terminales FT,
AET y PEN. `score.fulltime` produce el 1X2 reglamentario; prórroga, penales y
`shootoutWinner` permanecen en campos separados. No vuelve a consultar prediction y no crea,
reconstruye ni modifica decisiones.

## H. Evidencia

La evidencia es content-addressed y su identidad deriva del hash de los bytes recibidos. Se
publica de forma inmutable antes del mapper y no se elimina si una fase posterior falla. SQLite
conserva referencias y hashes, nunca los bytes raw. Traversal, symlinks, overwrite y rutas fuera de
la raíz autorizada se rechazan.

## I. Idempotencia

- `CREATED`: observación nueva publicada.
- `REPLAYED`: repetición exacta compatible.
- `CONFLICT`: misma identidad lógica con contenido incompatible; bloquea.

No se usan update ni delete. Una captura posterior legítima crea un snapshot nuevo.

## J. Matching futuro

El matcher puro está implementado, pero todavía no está conectado a un segundo adapter ni se
persiste su resultado. Nunca presume IDs compartidos. Usa kickoff, equipos normalizados,
competición, orientación y tolerancia versionada. Conflicto o ambigüedad bloquean; no existe fuzzy
auto-selection.

## K. Checklist previo a la primera captura real

- Ejecutar `npm run contracts:validate`.
- Ejecutar `npm run typecheck` y `npm run lint`.
- Ejecutar los tests TypeScript relacionados con un único worker.
- Ejecutar `npx --no-install prisma validate --schema prisma/market-v2/schema.prisma`.
- Ejecutar Ruff, Mypy y Pytest dentro de `analytics`.
- Confirmar base, raíz de evidencia, targets, budget y threshold explícitos.
- Ejecutar un dry run local con transporte falso.
- Revisar que logs y errores estén saneados.
- Confirmar que no existe acceso a outcomes desde PREMATCH.

Este checklist no es un comando de captura ni sustituye una autorización de red.

## L. Estado actual

- Contratos source-neutral: implementados.
- Cliente inyectado y mappers: implementados.
- Evidencia y persistencia append-only: implementadas.
- Governance, budget, breaker y auditoría: implementados.
- Workflows PREMATCH y OUTCOME: implementados y separados.
- Matcher provider-neutral puro: implementado, no conectado ni persistido.
- Packet analítico schema v2: implementado y validado entre TypeScript y Python.
- Captura real: no habilitada.
- Runner y CLI de captura: no existen.
- Scheduler y polling: no existen.
- Adapter de The Odds API: no existe.

## M. Condiciones de autorización futura

La primera captura real requiere un lote separado que:

- revise y apruebe el commit exacto;
- seleccione conscientemente la base y la raíz de evidencia;
- entregue la credencial externamente;
- establezca presupuesto, threshold y targets explícitos;
- autorice red únicamente al dominio oficial;
- ejecute primero un transporte falso;
- produzca un reporte saneado;
- verifique limpieza e idempotencia;
- no realice staging ni commit automático.

## N. Deuda arquitectónica conocida

Algunos tipos concretos de governance y evidence atraviesan application desde infrastructure para
budget, circuit breaker y evidence store. Esta dependencia no introduce IO global ni afecta la
seguridad actual, pero debe invertirse antes de generalizar el executor a múltiples providers.

Quedan fuera de alcance el runner real, adapter de The Odds API, matching persistente, scheduler,
polling, settlement, ROI, staking y cualquier automatización de apuestas.
