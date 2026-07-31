<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Market V2: reglas durables

- El repositorio legacy `/home/yvaforma/odds/ou25-consensus-lab` es estrictamente de solo lectura.
- Está prohibido abrir, copiar, consultar o reutilizar `prisma/dev.db`; Market V2 usa un schema, cliente y base SQLite aislados.
- Los timestamps de Market V2 se expresan en UTC normalizado con sufijo `Z`.
- Artefactos, snapshots, decisiones, outcomes, probabilidades derivadas y settlements son append-only; las correcciones crean nuevas filas.
- El dominio de decisión no puede leer outcomes, settlements ni evaluaciones. La evaluación sí puede leer decisiones y outcomes.
- `ABSTAINED` es un resultado de decisión válido, no un error que deba ocultarse.
- No se autorizan capturas reales ni apuestas sin autorización explícita del usuario.
- No se debe afirmar rentabilidad sin validación temporal fuera de muestra.
- Nunca se pueden usar resultados posteriores para generar decisiones históricas.

## Analytics Python: reglas durables

- Python nunca escribe directamente en la base operacional; consume snapshots analíticos exportados explícitamente.
- Toda investigación parte de un snapshot congelado con cutoff UTC, manifiesto y hashes verificables.
- Los Parquet publicados son inmutables; una revisión crea un snapshot nuevo.
- Los notebooks son exploratorios y no son fuente de verdad. La lógica importante vive en módulos y tests.
- La generación de features no puede leer outcomes. La evaluación puede leerlos mediante una frontera separada.
- La validación principal es temporal; los splits aleatorios no constituyen evidencia principal.
- Toda semilla aleatoria debe recibirse explícitamente.
- Las métricas deben informar tamaño de muestra y cobertura.
- Los resultados sintéticos no permiten afirmar rentabilidad ni promover estrategias por aciertos aislados.
- No se puede utilizar información posterior al momento de decisión.
- Toda transformación debe ser reproducible desde manifiesto, commit y `analytics/uv.lock`.
- Nunca se debe abrir una base viva con `immutable=1`; la fuente analítica debe estar congelada previamente.
- Toda fuente SQLite se rechaza si existe un sidecar WAL, SHM o journal.
- El hash de la fuente SQLite se verifica antes y después de la extracción.
- El profile `prematch` no consulta, mapea ni publica outcomes.
- `kickoffAtUtc` no es un timestamp de disponibilidad de datos.
- No se exportan bases reales sin autorización explícita y un procedimiento de congelación auditado.
- La extracción no acepta SQL arbitrario ni nombres de tabla proporcionados por usuario.
- Los mappings SQLite son allowlist fija y versionada.

## Protocolo prospectivo R0

- El legacy permanece en cuarentena y no puede alimentar packets R0, decisiones ni evaluación.
- Captura prepartido, decisión, closing line y outcome son etapas separadas y append-only.
- Solo fixtures con kickoff UTC `CONFIRMED` o `HIGH` pueden producir decisiones R0.
- `SELECTED` exige una cuota ofrecida exacta, activa, no in-play, del mismo fixture y disponible al decidir.
- Closing odds son exclusivamente evaluación de CLV y nunca input retrospectivo de una decisión.
- Toda regla, filtro, rango, método no-vig y criterio de promoción se preregistra antes del holdout.
- No se autorizan claims ni capturas reales antes de completar shadow validation y un lote de autorización separado.

## Foundation de captura prospectiva

- La evidencia raw se publica antes de normalizar; nunca se reconstruye desde la observación derivada.
- Provider y transport son puertos separados, y los tests de captura no realizan red.
- Ningún provider real se conecta sin un lote de aprobación explícito.
- La idempotencia conserva snapshots legítimos con timestamp o contenido diferente.
- Los fallos parciales producen warnings o abstención técnica; jamás datos inventados.
- Closing no crea ni modifica decisiones y outcomes no entran en PREMATCH.
- Metadata, errores y logs usan allowlists y no contienen payloads, credenciales o sesiones.
- Dominio y aplicación usan un `CaptureClock` inyectado; no consultan relojes ocultos.
