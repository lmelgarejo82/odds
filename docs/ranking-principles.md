# Principios de ranking

La prioridad máxima es 100 y resulta exactamente de señal (40), evidencia histórica (40) y calidad de datos (20). Cada explicación se puede hashear de forma canónica y el desempate por clave canónica hace reproducible el orden.

Over 2.5 y Under 2.5 conservan métricas separadas. Un matching ambiguo no es elegible. El ranking no es probabilidad, garantía ni apuesta, y puede devolver cero candidatos destacados.

## Intelligent V1

La ejecución operativa se realiza a las 09:00 `America/Asuncion` para la fecha deportiva local del mismo día. Solo son elegibles fixtures cuyo kickoff esté al menos 90 minutos por delante de la captura. La respuesta diaria completa se filtra antes de aplicar el límite operativo, evitando que partidos terminados o cercanos ocupen los lugares de análisis.

El producto analiza exclusivamente **1X (local o empate)**. Suma ambas probabilidades, exige al menos 75 % y una separación mínima de 15 puntos entre el escenario protegido más débil y la derrota local. La lectura contextual del ganador debe apoyar al local y cualquier contradicción bloquea la publicación. Amistosos, filiales, reservas y categorías U15–U21 quedan fuera antes del análisis profundo.

**Más de 1,5 goles** es únicamente un refuerzo visible cuando la evidencia del proveedor lo expresa junto a 1X. No se inventa una probabilidad conjunta, no se ofrece como selección independiente y no sustituye a 1X. La interfaz ordena hasta diez análisis 1X y distingue visualmente cuáles cumplen el filtro de señal; no rellena el ranking con datos inventados.

El rendimiento estadístico utiliza únicamente selecciones 1X de la ejecución primaria de cada fecha. Replays y runs derivados permanecen append-only para auditoría y pueden representar la lectura vigente del día, pero no aumentan la muestra canónica. Sin cuota prematch 1X vinculada no se calculan ni comunican retorno, edge o rentabilidad.
