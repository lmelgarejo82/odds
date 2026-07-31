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
```

## Estructura y fronteras

- `contracts`: schemas PyArrow y manifiesto versionado.
- `snapshot`: publicación atómica, verificación y vistas DuckDB in-memory.
- `quality`: reglas estructuradas de integridad y temporalidad.
- `market`, `features`, `splitting`, `backtesting`: lógica científica testeada.
- `synthetic`: datos ficticios deterministas con semilla explícita.
- `notebooks`: exploración solamente; nunca fuente de verdad.

Las features prepartido solo aceptan fixtures y snapshots disponibles antes de kickoff. Outcomes se registran únicamente en vistas de evaluación.

## Contrato de snapshot

Cada directorio publicado contiene un Parquet Zstandard por tabla, `quality-report.json` y `manifest.json`. El manifiesto fija cutoff UTC, versiones, commits, lockfile, conteos, rangos y SHA-256. El writer usa staging temporal, rechaza overwrite y promueve únicamente tras validar. El reader recalcula hashes y contratos antes de cargar.

La reproducción exige el manifest, el commit indicado y `uv.lock`. Los outputs de pruebas y self-check viven en directorios temporales eliminables; `var/analytics/` está reservado e ignorado para futuros exports autorizados.

## Limitaciones

Este lote usa exclusivamente datos sintéticos. No exporta SQLite, no entrena modelos reales, no implementa scraping, staking o Kelly y no permite conclusiones sobre rentabilidad o rendimiento deportivo real.
