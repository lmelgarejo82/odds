# ADR 0002: exportación analítica SQLite de solo lectura

## Contexto

Market V2 necesita transformar evidencia operacional append-only en contratos Parquet reproducibles sin permitir que Python escriba en la base ni que outcomes contaminen decisiones históricas. Una base SQLite viva puede cambiar durante la lectura y puede tener estado confirmado únicamente en WAL; hashear solo el archivo principal no resuelve ese riesgo.

## Decisión

La extracción acepta exclusivamente una fuente previamente congelada y situada bajo una raíz allowlisted. Rechaza rutas relativas, symlinks, directorios y sidecars WAL/SHM/journal. El archivo se abre con URI SQLite `mode=ro&immutable=1`, `uri=True`, `PRAGMA query_only=ON` y una única transacción de lectura.

La defensa es acumulativa: el authorizer deniega escritura, DDL, ATTACH/DETACH, PRAGMAs mutables y carga de extensiones. Las consultas y nombres de tabla son mappings fijos versionados; no existe una API de SQL arbitrario. Se registran hash, tamaño, mtime y `data_version` antes y después, y cualquier diferencia invalida la exportación.

## Perfiles y cutoff

`prematch` consulta únicamente Fixture, ForebetSnapshot, OddsSnapshot, MarketProbabilitySnapshot, PreMatchDecision y las relaciones necesarias. No importa el mapping de Outcome ni produce artefactos derivados de resultados. `evaluation` añade Outcome mediante un módulo separado.

El cutoff es UTC normalizado con sufijo `Z` y se aplica por timestamp de disponibilidad. Una fila exactamente en cutoff es elegible; una fila posterior no. Kickoff no se utiliza como sustituto de disponibilidad. Un fixture se incorpora cuando una fila visible al profile y elegible lo referencia, incluso si el kickoff es futuro.

## Schema, calidad y trazabilidad

El inspector acepta únicamente tablas Market V2 conocidas y exige las columnas declaradas por cada mapping. El fingerprint determinista incluye tabla, columnas, tipos, nullability, PK, FK y SQL normalizado visible al profile. El manifiesto conserva metadata SQLite, versiones de semántica/mapping y conteos cerrados de filas fuente, elegibles, exportadas y excluidas. El writer y reader existentes validan contratos, quality report y hashes.

## Alternativas rechazadas

- Abrir la base operacional directamente: permite concurrencia y amplía el radio de daño.
- Usar `immutable=1` sobre una base viva: SQLite podría ignorar cambios externos.
- Copiar o hacer checkpoint automático del WAL: altera el procedimiento de evidencia y oculta quién congeló la fuente.
- Confiar solo en `mode=ro`: no aporta defensa independiente contra ATTACH, PRAGMAs o cambios futuros de implementación.
- Filtrar outcomes después de consultar: no constituye aislamiento estructural.
- Usar `SELECT *` o mappings inferidos: hace silenciosa la deriva de schema.

## Limitaciones

Este lote solo ejecuta fuentes sintéticas temporales. No autoriza ninguna base real, legacy, externa o bajo `/srv`. No resuelve todavía el procedimiento organizativo de congelación ni la custodia de una fuente real.

## Procedimiento futuro para autorizar una fuente real

Un lote explícito deberá identificar propietario y origen, congelar la base fuera del proceso exportador, demostrar cierre consistente y ausencia de sidecars, registrar hashes y permisos, aprobar la raíz de lectura y el schema fingerprint, ejecutar primero un dry-run con conteos auditados y conservar aprobación del cutoff/profile. El exportador nunca apuntará directamente a la ruta operacional.
