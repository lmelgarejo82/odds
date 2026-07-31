# OU25 Market V2 Analytics

Esta unidad Python analiza snapshots congelados sin escribir en la base operacional. TypeScript/Prisma conserva evidencia, decisiones y outcomes; Python comienza en el contrato Parquet, valida calidad y ejecuta análisis temporal reproducible.

## Instalación

Requiere Python 3.12 del sistema y `uv`:

```bash
cd analytics
/home/yvaforma/.local/bin/uv sync --frozen
```

Comandos de control:

```bash
/home/yvaforma/.local/bin/uv lock --check
/home/yvaforma/.local/bin/uv run ruff format --check .
/home/yvaforma/.local/bin/uv run ruff check .
/home/yvaforma/.local/bin/uv run mypy src
/home/yvaforma/.local/bin/uv run pytest
/home/yvaforma/.local/bin/uv run pytest --cov=ou25_analytics --cov-report=term-missing --cov-fail-under=85
/home/yvaforma/.local/bin/uv run python -m ou25_analytics.cli self-check
/home/yvaforma/.local/bin/uv run python -m ou25_analytics.cli export-synthetic-sqlite --profile prematch --cutoff 2026-01-15T12:00:00Z
/home/yvaforma/.local/bin/uv run python -m ou25_analytics.cli export-synthetic-sqlite --profile evaluation --cutoff 2026-01-15T12:00:00Z
/home/yvaforma/.local/bin/uv run prospective-packet-self-check
/home/yvaforma/.local/bin/uv run validate-prospective-packet /tmp/synthetic-packet.json
```

## Estructura y fronteras

- `contracts`: schemas PyArrow y manifiesto versionado.
- `snapshot`: publicación atómica, verificación y vistas DuckDB in-memory.
- `quality`: reglas estructuradas de integridad y temporalidad.
- `market`, `features`, `splitting`, `backtesting`: lógica científica testeada.
- `synthetic`: datos ficticios deterministas con semilla explícita.
- `prospective`: contratos R0 source-neutral, validación relacional y CLI sintética sin persistencia.
- `notebooks`: exploración solamente; nunca fuente de verdad.

Las features prepartido solo aceptan fixtures y snapshots disponibles antes de kickoff. Outcomes se registran únicamente en vistas de evaluación.

## R0 prospectivo

R0 sustituye cualquier intento de reutilizar el legacy inseguro. El flujo separa packet prepartido,
decisiones inmutables, observaciones de cierre para CLV y outcomes posteriores. Los kickoffs deben
ser UTC explícito; solo confianza `CONFIRMED` o `HIGH` habilita decisiones. `ABSTAINED` es válido y
`SELECTED` exige una cuota exacta del mismo fixture disponible al decidir.

La CLI prospectiva acepta únicamente JSON sintético local bajo temporales o fixtures de tests. No
abre bases, no acepta URLs, no ejecuta capturas y no modifica el packet. El self-check demuestra
contratos y cronología, no rentabilidad. Antes de cualquier evaluación real se congelan universo,
reglas, ranges, método no-vig, holdout y criterios mediante preregistro.

## Contrato de snapshot

Cada directorio publicado contiene un Parquet Zstandard por tabla, `quality-report.json` y `manifest.json`. El manifiesto fija cutoff UTC, versiones, commits, lockfile, conteos, rangos y SHA-256. El writer usa staging temporal, rechaza overwrite y promueve únicamente tras validar. El reader recalcula hashes y contratos antes de cargar.

La reproducción exige el manifest, el commit indicado y `uv.lock`. Los outputs de pruebas y self-check viven en directorios temporales eliminables; `var/analytics/` está reservado e ignorado para futuros exports autorizados.

## Fuente SQLite congelada

Una base viva no es una fuente analítica válida. Aunque se calcule el hash del archivo principal, un writer concurrente o páginas todavía presentes en WAL pueden producir una vista incompleta o temporalmente inconsistente. La fuente autorizable debe ser un archivo cerrado y congelado, sin `<database>-wal`, `<database>-shm` ni `<database>-journal`.

`FrozenSQLiteSource` exige una ruta absoluta dentro de una raíz permitida, rechaza symlinks y sidecars, calcula SHA-256 antes de leer y lo repite después de exportar. Abre exclusivamente mediante `mode=ro&immutable=1`, activa `PRAGMA query_only=ON`, instala un authorizer que deniega operaciones mutables y mantiene una sola transacción de lectura. `immutable=1` nunca debe usarse sobre una base viva porque SQLite dejaría de comprobar cambios externos.

El cutoff se aplica al timestamp de disponibilidad de cada tabla: `capturedAtUtc`, `calculatedAtUtc`, `decidedAtUtc` u `observedAtUtc`. `kickoffAtUtc` describe el evento y no demuestra cuándo una fila estuvo disponible. Los fixtures se incluyen solo cuando están referenciados por filas elegibles del profile, por lo que un partido futuro puede aparecer si ya tenía evidencia prepartido antes del cutoff.

El profile `prematch` publica fixtures, Forebet, odds, probabilidades y decisiones. Su mapping no consulta `Outcome`, no produce `outcomes.parquet` y no registra outcomes en DuckDB. El profile `evaluation` añade outcomes mediante una ruta separada y conserva `observedAtUtc <= cutoff`.

La CLI actual crea una SQLite sintética dentro de un directorio temporal, la cierra, verifica que no haya sidecars, exporta y valida el snapshot y elimina ambos artefactos. No ofrece `--database` y rechaza fuentes no marcadas como sintéticas.

## Autorización futura de una fuente real

Este lote no autoriza fuentes reales. Un lote futuro deberá definir quién congela la fuente, demostrar cierre consistente y ausencia de WAL, registrar procedencia y permisos, entregar una ruta allowlisted, comparar schema fingerprint con una versión aprobada y revisar los conteos de exclusión antes de publicar. Cualquier cambio de schema o mapping exige una versión nueva; nunca se debe apuntar el exportador directamente a una base operacional.

## Limitaciones

Este lote usa exclusivamente datos sintéticos. Lee una SQLite sintética congelada para probar la frontera, pero no abre ni exporta ninguna base real. No entrena modelos reales, no implementa scraping, staking o Kelly y no permite conclusiones sobre rentabilidad o rendimiento deportivo real.
