# Dashboard F12Radio - TV: investigación de mercados cualitativa (UNAB)

Plantilla del dashboard del análisis cualitativo de **F12Radio - TV** ("Fútbol con la 12"), periódico virtual y canal deportivo de Bucaramanga ([f12radiotv.com](https://www.f12radiotv.com), Instagram @f12radiotv).

- `marca.json`: **datos reales** de la marca (Instagram, canales, parrilla de programación y equipo), tomados de f12radiotv.com y de Instagram el 9 de noviembre de 2026.

- `datos_ejemplo.json`: resultados del estudio.

> ⚠️ `datos_ejemplo.json` contiene **datos de ejemplo** (inventados) solo para ver la estructura.
> Reemplácelos por los resultados reales del grupo.

## Qué llenar en `datos_ejemplo.json`

| Sección | Campos | De dónde sale |
|---|---|---|
| `tecnicas` | tecnica, sesiones, participantes, duracion_min | Ficha técnica del trabajo de campo |
| `perfiles` | perfil, participantes | Filtro / perfil de los participantes |
| `categorias` | categoria, positivas, neutras, negativas | Codificación de las transcripciones (conteo de menciones por tono) |
| `asociaciones` | palabra, menciones | Pregunta de asociación libre ("¿Qué palabra le viene a la mente?") |
| `verbatims` | id, categoria, sentimiento, perfil, cita | Citas textuales representativas |
| `dofa` | tipo (Fortaleza/Debilidad/Oportunidad/Amenaza), punto | Análisis estratégico |
| `insights` | n, insight, recomendacion | Conclusiones del grupo |

También sirve pasarle a Claude las transcripciones, la matriz de codificación o un Excel y él arma este archivo.
