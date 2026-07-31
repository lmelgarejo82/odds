# Operaciones futuras de captura R0

Estado: procedimiento sintético de foundation. No autoriza proveedores ni datos reales.

## Flujo operativo futuro

1. Congelar protocolo, universo, provider/version, policy y commit.
2. Crear `runId`, `correlationId`, stage y reloj explícito.
3. Descubrir el universo completo allowlisted, sin elegir partidos por probabilidad o atractivo.
4. Capturar bytes y publicar evidencia original antes de normalizar.
5. Validar, deduplicar y registrar fallo o abstención técnica por fixture.
6. Ensamblar un packet de una sola etapa y resolver todas sus referencias de evidencia.
7. Escribir append-only, validar con Python y publicar sólo después de los controles.

## Ventanas y tiempo real

Las ventanas nominales son `EARLY` alrededor de T-6h, `DECISION` alrededor de T-60m y `CLOSING`
alrededor de T-5m. El target nunca reemplaza `capturedAtUtc`: siempre se guarda la hora real. Un
kickoff aplazado produce evidencia nueva y se aplica la política congelada; no se reescribe historia.
Un kickoff no fiable bloquea o excluye, según el universo preregistrado.

## Etapas

- `PREMATCH`: fixtures, Forebet, odds y decisiones/abstenciones; nunca closing u outcomes.
- `CLOSING`: fixture mínimo y closing para CLV; nunca modifica decisiones.
- `OUTCOME`: fixture mínimo y versiones de outcome; nunca reconstruye inputs.
- `SYNTHETIC_FULL`: sólo fixtures de tests y autocontrol.

Los `packetId` y hashes enlazan contenido; los `runId` identifican ejecución. Un packet no sustituye
la evidencia raw ni permite rellenar capturas fallidas.

## Fallos, retry y abstención técnica

Errores temporales allowlisted pueden reintentarse con backoff determinista. Validación, contenido
semánticamente inválido, capacidad ausente, acceso prohibido, conflicto y error permanente no se
reintentan. Rate limit devuelve una decisión explícita, sin sleeps ocultos. Un fallo parcial conserva
las fixtures restantes y genera warning, `BLOCKED` o `UNRESOLVED`; jamás un precio o probabilidad
inventados.

## Evidencia y sanitización

Cada evidencia conserva proveedor/versión, stage, referencia, captura, media type, bytes, SHA-256,
correlación, intento y metadata allowlisted. Se prohíben cookies, tokens, sesiones, credenciales,
authorization headers y payloads completos en errores o logs. Staging debe quedar vacío tras éxito o
fallo y los stores de este lote se eliminan al terminar.

## Checklist antes de activar un proveedor

- Autorización explícita de fuente, términos, acceso y alcance.
- Provider key/version y capacidades revisadas.
- Universo completo, horarios y políticas preregistrados.
- Reloj, timezone, kickoff y cutoff verificados.
- Evidencia append-only, cifrado/custodia y retención aprobados.
- Sanitización de metadata, errores y observabilidad revisada.
- Idempotencia, conflicto, retries y rate limits probados en shadow.
- Fallos parciales y abstenciones técnicas monitorizados.
- Packets separados y validación Python cross-language verde.
- Sin acceso a outcomes desde PREMATCH ni closing retrospectivo.
- Threat model, rollback operativo y aprobación final documentados.
