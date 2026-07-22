# Captura raw controlada Statarea — 2026-07-21

La única URL permitida es `https://www.statarea.com/predictions/date/2026-07-21/competition`. El cliente usa HTTPS, allowlist exacta, redirecciones manuales limitadas a dos, timeout de 20 segundos y máximo de 5 MB. No envía credenciales, no conserva cookies, no descarga assets y no ejecuta JavaScript.

## Estructura demostrada

Cada `.competition` aporta país (atributo `alt` de la bandera), competición (`.header > .name`) y encabezados visibles. Cada `.match` contiene fecha/hora en `.teams > .ownheader`, local en `.hostteam .name`, visitante en `.guestteam .name`, `TIP` en `.matchrow > .tip > .value` y once valores en `.inforow > .coefrow`, asociados por ordinal a `1`, `X`, `2`, `HT1`, `HTX`, `HT2`, `1.5`, `2.5`, `3.5`, `BTS` y `OTS`.

Los nodos `.goals`, `.result` y `.htres` se ignoran. Los tests demuestran que cambiar los marcadores no altera la extracción raw.

`TIP`, `1.5`, `2.5`, `3.5`, `BTS` y `OTS` permanecen `UNVERIFIED`. No se afirma que sean probabilidades, lados, señales ni recomendaciones. Las demás columnas están únicamente `STRUCTURALLY_MAPPED`.

## Capturas reales

Todas fueron HTTP 200, `text/html; charset=UTF-8`, sin redirección y desde `www.statarea.com`:

- 2026-07-22T14:01:21.489Z: 253493 bytes, SHA-256 `0659fb638dc75ac3ead30fd3be0d3f3a0451db31c39bb5eb1b6b120702183cef`, 49 filas.
- 2026-07-22T14:01:37.723Z: 258113 bytes, SHA-256 `06044642ed96f0cde7e25911a2451e1737d6ec434a71dd34535927df4d199488`, 50 filas.
- 2026-07-22T14:01:55.168Z: 253493 bytes, SHA-256 `e5aed325cbd61b2ccd8b5a74c621709d33e5842da6546ad663c43fed0a6bff23`, 49 filas.

Statarea entregó contenido diferente en cada solicitud, por lo que se conservaron tres snapshots. La reproducción verificada del tercer cuerpo real produjo `REUSED` con el mismo snapshot, manteniendo 3 snapshots y 148 filas. Esto demuestra tanto la conservación ante HTML diferente como la idempotencia ante contenido idéntico.

Los HTML y exports están bajo `var/evidence/statarea` y `var/exports/statarea`, fuera de Git.
