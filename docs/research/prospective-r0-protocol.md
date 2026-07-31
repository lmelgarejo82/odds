# Protocolo prospectivo R0

Estado: diseño y validación sintética. Este protocolo no autoriza capturas reales, acceso a
fuentes externas, apuestas ni afirmaciones de rendimiento. El legacy permanece en cuarentena:
`SCHEMA_MAPPING_UNSAFE` y no puede mezclarse con R0.

## 1. Pregunta, hipótesis y baselines

La pregunta principal es si las probabilidades Forebet 1/X/2 aportan información predictiva y
económica adicional al consenso de cuotas en `MATCH_ODDS_1X2`, `DOUBLE_CHANCE` (`1X`, `X2`) y
`DRAW_NO_BET` local/visitante.

- H0: Forebet + mercado no mejora al baseline mercado solo fuera de muestra.
- H1: Forebet aporta señal incremental fuera de muestra bajo condiciones preregistradas.
- Hipótesis secundaria: una divergencia Forebet–mercado puede ser informativa únicamente cuando
  el precio ofrecido compensa la incertidumbre; la divergencia por sí sola no implica valor.
- Baselines: mercado solo, Forebet solo y Forebet + mercado.

## 2. Fases y gates

1. `PILOT`: valida operación, cobertura, matching, timestamps y abstenciones. No promociona reglas.
2. `SHADOW`: genera decisiones inmutables sin acción económica y sin leer outcomes.
3. `FROZEN_EVALUATION`: congela snapshot, cutoff, reglas, código y preregistro antes de outcomes.
4. `HOLDOUT`: evalúa una sola vez el conjunto reservado; cualquier cambio crea una nueva versión.
5. `PROSPECTIVE_VALIDATION`: solo tras superar los gates anteriores y una autorización separada.

Está prohibido seleccionar reglas después de outcomes, modificar decisiones tras kickoff, usar
closing odds como precio de decisión, mezclar mercados, interpretar accuracy como rentabilidad,
afirmar valor con muestras pequeñas o combinar R0 con legacy inseguro.

## 3. Universo configurable

`CaptureUniverse` fija una versión de protocolo, fase, allowlist de competiciones, ventana de
fechas, mercados requeridos, bookmakers permitidos, política de aplazamientos, política de kickoff
incierto y agenda nominal de snapshots. No contiene ligas reales en este lote.

La agenda inicial propone `EARLY` alrededor de T-6h, `DECISION` alrededor de T-60m y `CLOSING`
alrededor de T-5m. Son targets con tolerancia, no timestamps imputados. Cada fila conserva siempre
su captura real. Un aplazamiento produce nueva evidencia y nuevo kickoff; nunca reescribe el
anterior. Un kickoff no fiable bloquea o excluye según la política versionada.

## 4. Fixture e identidad

`Fixture` conserva identificador y nombre de fuente, competición y equipos raw, IDs normalizados
opcionales, kickoff raw, zona declarada, kickoff UTC, confianza, estado, captura, referencia de
artefacto y hash. `kickoff_at_utc` es obligatorio para cualquier decisión.

La confianza admite `CONFIRMED`, `HIGH`, `MEDIUM`, `LOW` y `UNKNOWN`. En R0 solo `CONFIRMED` o
`HIGH` puede producir una decisión. El matching usa, por orden: identificador estable de fuente,
mapping source-neutral prerevisado y combinación normalizada con revisión. Un join únicamente por
nombres nunca habilita una decisión. Orientación local/visitante, competición y kickoff deben
coincidir; conflictos producen `BLOCKED` o `UNRESOLVED`.

## 5. Observación Forebet

`ForebetSnapshot` contiene ID append-only, fixture, captura UTC, probabilidades home/draw/away,
score previsto opcional, referencias de página/evidencia, parser y hash. Las probabilidades usan
fracción `[0,1]` y suman 1 con tolerancia 0.01. La captura es estrictamente anterior al kickoff.
No se acepta solo el favorito y nunca se deriva 1/X/2 desde el score previsto.

## 6. Cuotas ofrecidas

`OddsSnapshot` conserva fixture, bookmaker, mercado, selección, captura, cuota decimal, raw y línea
opcionales, estados, señal in-play, IDs de fuente, evidencia y hash. `price_kind=OFFERED` impide
presentar un cálculo sintético como precio observado.

Mercados y selecciones iniciales:

| Mercado | Selecciones |
|---|---|
| `MATCH_ODDS_1X2` | `HOME`, `DRAW`, `AWAY` |
| `DOUBLE_CHANCE` | `HOME_OR_DRAW`, `DRAW_OR_AWAY` |
| `DRAW_NO_BET` | `HOME_DNB`, `AWAY_DNB` |

Una cuota elegible es mayor que 1, `ACTIVE`, no in-play, anterior al kickoff y pertenece al fixture,
bookmaker, mercado y selección declarados. Probabilidades no-vig, cuotas combinadas o precios
derivados viven en contratos de cálculo separados.

## 7. Decisiones y abstenciones

`PrematchDecision` conserva ID, fixture, momento, estado, razón, mercado/selección/cuota opcionales,
probabilidades y edge opcionales, política e input hash. Estados: `SELECTED`, `ABSTAINED`,
`BLOCKED`, `UNRESOLVED`.

`SELECTED` exige el snapshot de cuota exacto del mismo fixture. Esa cuota debe existir antes o en
el instante de decisión; la decisión debe ser estrictamente anterior al kickoff y su break-even,
si se guarda, debe ser `1 / decimal_odds`. Los demás estados no retienen una selección. `ABSTAINED`
es resultado válido. Una decisión persistida es append-only y no puede modificarse.

## 8. Cierre y outcomes

`ClosingLineObservation` está separado de las cuotas de decisión. Conserva captura real,
`seconds_before_kickoff`, precio, estado y hash. Solo entra en evaluación de CLV y su ID no puede
ser input de una decisión.

`Outcome` conserva ID versionado, fixture, observación UTC, fuente, score, 1X2, estado, evidencia y
hash. Se incorpora después del kickoff. Una corrección crea una fila `CORRECTED` que referencia una
versión anterior del mismo fixture, observada antes; nunca actualiza el outcome previo. El motor de
decisión no recibe outcomes.

## 9. ProspectiveCapturePacket

El packet versionado contiene `protocol_version`, `packet_id`, `generated_at_utc`, metadata de
fuente, universo, fixtures, snapshots Forebet, odds, decisiones, closing opcional, outcomes
opcionales, manifiesto de evidencia y `packet_hash`.

Los stages reales son separados:

- `PREMATCH`: fixtures, Forebet, cuotas y decisiones; sin closing ni outcomes.
- `CLOSING`: fixtures y observaciones de cierre; sin inputs o decisiones retrospectivas.
- `OUTCOME`: fixtures y outcomes; sin datos prepartido ni closing.
- `SYNTHETIC_FULL`: únicamente self-checks sintéticos de ciclo completo.

El hash es SHA-256 del JSON canónico UTF-8 con claves ordenadas, timestamps UTC en `Z` y sin el
propio `packet_hash`. Cada referencia de artefacto debe resolver a un hash idéntico en
`evidence_manifest`.

## 10. Validación y dry-run

Los modelos Pydantic son inmutables y rechazan campos extra. La validación pura cubre UTC `Z`,
confianza, probabilidades, mercados, selecciones, precios, in-play, cronología, relaciones,
duplicados, hashes, cuota exacta, separación closing/decisión, outcomes y correcciones.

`validate-prospective-packet <path>` acepta solo JSON sintético local bajo temporales o fixtures de
tests, rechaza URLs y symlinks, no modifica el archivo y no escribe SQLite. El modo
`prospective-packet-self-check` crea y elimina un packet temporal, demuestra casos sintéticos
concordante/divergente y un `1X` a 1.60 con break-even 62.5%, sin afirmar rentabilidad.

## 11. Métricas futuras

Solo después de congelar reglas se podrán calcular Brier, log loss, calibración, accuracy,
coverage, ROI/yield flat-stake, drawdown, longest losing streak y CLV, con cortes preregistrados por
competición, fecha, cuota y divergencia. Accuracy no sustituye rentabilidad; CLV no sustituye
outcome; toda métrica informa tamaño y cobertura.

## 12. Multiple testing y preregistro

Toda regla candidata, rango, subgrupo, método no-vig y criterio de promoción debe registrarse antes
de evaluación final. Explorar crea hipótesis; no confirma resultados. Una modificación posterior
crea nueva versión y nuevo holdout. El template obligatorio está en
`docs/research/preregistration-template.md`.

## 13. Criterios de salida de R0

R0 solo habilita un lote de captura real separado cuando exista autorización explícita, allowlist
real revisada, fuente legal/técnicamente autorizada, kickoff UTC fiable, writer append-only,
evidencia hasheada, observabilidad de fallos y preregistro fechado y ligado a commit. Este lote no
cumple ni intenta cumplir esa autorización.
