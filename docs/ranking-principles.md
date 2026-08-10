# Principios de ranking

La prioridad máxima es 100 y resulta exactamente de señal (40), evidencia histórica (40) y calidad de datos (20). Cada explicación se puede hashear de forma canónica y el desempate por clave canónica hace reproducible el orden.

Over 2.5 y Under 2.5 conservan métricas separadas. Un matching ambiguo no es elegible. El ranking no es probabilidad, garantía ni apuesta, y puede devolver cero candidatos destacados.

## Intelligent V1

La ejecución operativa se realiza a las 10:30 `America/Asuncion` para la fecha deportiva local del mismo día. Solo son elegibles fixtures cuyo kickoff esté al menos 90 minutos por delante de la captura.

La probabilidad se compara contra la tasa base de su familia: 1X2, doble oportunidad y totales no comparten escala. Un empate entre los dos escenarios 1X2 principales o una contradicción con el ganador contextual bloquea la publicación destacada. La interfaz publica como máximo tres señales y conserva el resto como análisis secundario.

El rendimiento principal utiliza la última ejecución primaria, no derivada, de cada fecha y una sola selección por fixture. Replays y runs derivados permanecen append-only para auditoría, pero no aumentan la muestra visible. Sin cuota prematch vinculada no se calculan ni comunican retorno, edge o rentabilidad.
