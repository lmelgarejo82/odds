# ADR 0003 — Frontera de proveedores de captura prospectiva

- Estado: aceptado para foundation sintética.
- Alcance: Market V2 prospectivo R0.
- Fuente canónica del packet: contratos Pydantic de `analytics/src/ou25_analytics/prospective`.

## Decisión

La captura operativa vive en TypeScript y se divide en dominio, aplicación e infraestructura. Un
`CaptureProvider` declara capacidades y normaliza semántica source-neutral. Un `CaptureTransport`
obtiene bytes, pero no conoce modelos deportivos. La separación evita que un proveedor quede
acoplado a HTTP: este lote sólo contiene un transport sintético in-memory que rechaza HTTP(S),
paths, traversal, sockets, redirects y referencias no allowlisted.

Toda respuesta se publica como `RawCaptureEvidence` antes de ejecutar su normalizador. El store es
append-only, content-addressed y exclusivamente temporal: staging, hash, promoción atómica,
metadata sanitizada y rechazo de overwrite/conflicto. Ningún payload, cookie, token, cabecera de
autorización o sesión se incorpora a errores o logs.

## Idempotencia y deduplicación

La clave incluye protocolo, stage, proveedor/versión, fixture, mercado/selección opcionales,
captura real y hash. Se distinguen nueva observación, duplicado exacto, replay compatible y
conflicto. Una captura posterior conserva identidad propia; pertenecer al mismo fixture nunca basta
para eliminarla. Outcomes corregidos crean una versión que referencia la anterior.

## Retry, rate limit y reloj

Retry y rate limit son políticas inyectables. Sólo errores explícitamente reintentables reciben
backoff; el jitter requiere semilla y los tests usan `FakeSleeper`. No hay sleeps ni timers reales.
El dominio y la aplicación reciben todos los tiempos, y `CaptureClock` sustituye cualquier reloj de
pared oculto.

## Fallos parciales y etapas

El orquestador conserva el universo completo y aísla fallos por fixture. Nunca inventa un valor
ausente: emite warnings y abstenciones técnicas. `PREMATCH` no consulta closing u outcomes;
`CLOSING` no crea o modifica decisiones; `OUTCOME` no reconstruye inputs. El assembler rechaza
mezclas y referencias de evidencia rotas.

## Contrato y validación cruzada

TypeScript construye exactamente la representación del `ProspectiveCapturePacket`, ordena de forma
determinista y calcula su hash canónico. No constituye un segundo contrato relajado: cada packet de
autocontrol se escribe en temporal y la CLI Python R0 canónica lo valida sin modificarlo. Cambiar el
contrato requiere actualizar primero su definición canónica y una revisión cross-language.

## Consecuencias

Se habilitan diseño, pruebas, trazabilidad e idempotencia sin activar ninguna fuente. Conectar un
proveedor real queda fuera de este ADR: exige autorización separada, revisión legal/técnica,
credenciales custodiadas, threat model, rate limits reales, observabilidad y shadow validation.
