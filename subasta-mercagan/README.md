# ¿Quién da más? · Subasta en vivo de Mercagán

Juego en tiempo real para la exposición del plan de comunicaciones de **Mercagán Parrilla**. El público escanea un QR con el celular, entra con el nombre de su equipo y puja con dinero imaginario por 5 premios físicos. Quien gana la puja debe responder en voz alta una pregunta sobre el plan; si acierta, se le cobra y se lleva el lote. Si falla, la subasta se repite.

**Corre en tu computador, no en internet.** Tu portátil hace de servidor y los celulares se conectan a él por la **misma red WiFi**. No hay que publicar nada, no hay cuentas ni pagos.

| Pantalla | Dirección | Quién la usa |
|---|---|---|
| Proyector | `http://localhost:3000/proyector` | El video beam (en tu portátil) |
| Panel del presentador | `http://localhost:3000/panel` | Ustedes (en el portátil, otra pestaña o una tablet) |
| Jugador | `http://<IP-de-tu-portátil>:3000/jugar` | Los celulares (el QR ya lleva esta dirección) |

---

## 1. Qué necesitas

- Un computador con **Node.js 20 o más nuevo** (descárgalo en <https://nodejs.org>, versión LTS, siguiente-siguiente-finalizar).
- Una red WiFi a la que se conecten **el portátil y los celulares** (ver la sección 7: el hotspot del celular es el plan más seguro).

## 2. Cómo arrancarlo

**Opción fácil (doble clic):**
- Windows: doble clic en `INICIAR-SUBASTA.bat`.
- Mac: doble clic en `iniciar-subasta.command` (la primera vez: clic derecho → Abrir).

La primera vez instala lo necesario (requiere internet un minuto). Después funciona **sin internet**: las tipografías, el QR y los sonidos van incluidos.

**Opción con terminal:**
```bash
cd subasta-mercagan
npm install      # solo la primera vez
npm start
```

La consola muestra algo así:
```
  Proyector (en este computador):  http://localhost:3000/proyector
  Panel del presentador:           http://localhost:3000/panel
  Celulares (misma red WiFi):      http://192.168.1.23:3000/jugar
```
Abre el proyector y el panel en el navegador. El QR del proyector ya apunta a la dirección de los celulares.

> **Windows:** la primera vez saldrá un aviso del Firewall preguntando si Node.js puede usar la red. Marca **"Redes privadas"** (y también "públicas" si la red de la U aparece así) y pulsa **Permitir**. Si lo negaste por error: Panel de control → Firewall de Windows → Permitir una aplicación → Node.js.

Para apagarlo: `Ctrl + C` en la ventana negra (o ciérrala).

## 3. Configurar premios y PIN (`data/config.json`)

Abre `data/config.json` con el Bloc de notas o VS Code:

- `"hostPin"`: el PIN del panel. **Cámbialo** (viene en `1234`).
- `"prizes"`: cambia `"PREMIO 1 (cámbialo)"` etc. por los nombres reales. Si quieres foto, pon la imagen en `public/assets/` y escribe `"imageUrl": "/assets/premio1.jpg"`.
- Otros valores: saldo inicial, precio base, incrementos, segundos de subasta y de pregunta, máximo de equipos, si se ven los saldos en el proyector.

Reinicia el servidor después de editar. Cuida las comas y comillas: si el archivo queda mal escrito, el servidor no arranca y te dice la línea del error.

## 4. Editar preguntas (`data/questions.json`)

Son 24 preguntas abiertas: 12 `"facil"` (rondas 1–3) y 12 `"alta"` (rondas 4–5). Cada una tiene `question` (lo que ve el público), `expectedAnswer` y `criteria` (solo los ve el panel). Puedes editar el texto o agregar más con un `id` nuevo. En una partida no se repite ninguna; si un nivel se agota, se reutiliza la menos reciente.

## 5. Reglas en corto

- 5 lotes. Cada equipo arranca con **$2.000.000** y el saldo se acumula: lo que gastes no vuelve.
- Subasta de **60 s**. Primera oferta mínima $100.000; cada oferta supera la mayor en al menos $50.000. Botones +50.000 / +100.000 / +200.000 o monto propio (múltiplos de $10.000). Nadie puede ofertar más de su saldo ni superarse a sí mismo.
- Al cerrar, el que más ofreció responde una pregunta en voz alta (60 s). **El dinero solo se descuenta si ustedes marcan "Correcta".**
- Si es incorrecta: nadie pierde plata y se repite la subasta del mismo lote con otra pregunta (puede volver a ofertar el que falló).
- Al final: podio con los 5 lotes y ranking por premios (empate: más saldo).

## 6. Manual del presentador

El panel muestra **un botón grande con el siguiente paso**. Atajos: `Espacio` = botón principal, `C` = correcta, `I` = incorrecta.

1. **Iniciar juego** cuando estén todos los equipos (esto cierra el ingreso; puedes reabrirlo con "Permitir ingresos").
2. **Abrir subasta** → corren 60 s (puedes **Cerrar ahora** si hace falta).
3. **Mostrar pregunta** → la ven el proyector y el celular del ganador. Tú ves además la **respuesta esperada y los criterios**.
4. **✔ Correcta** (martillazo, ¡VENDIDO! y confeti) o **✘ Incorrecta** (subasta anulada).
5. **Siguiente ronda** / **Repetir subasta** / **Ver podio** (después del lote 5).

Controles extra: **Deshacer veredicto** (si te equivocaste de botón, antes de avanzar), **Reabrir subasta** (si nadie ofertó), **Saldo** (sumar o restar a un equipo), **Expulsar**, **Reiniciar juego** (escribe REINICIAR; vuelve al lobby con los mismos equipos y $2.000.000). La **bitácora** registra cada oferta y decisión.

En el proyector: pulsa **Activar sonido** al abrirlo, `F` para pantalla completa y `M` para silenciar.

Si se cae algo:
- Un celular se cerró o recargó → vuelve solo a su equipo (queda guardado en el navegador).
- El servidor se cerró → vuelve a abrirlo: la partida se recupera desde `data/state.json`, incluso a mitad de subasta. Para empezar de cero borra ese archivo (o usa "Reiniciar juego").

## 7. Lista de verificación del día de la exposición

- [ ] Cambiaste los **premios** y el **PIN** en `data/config.json`.
- [ ] Llega 15 minutos antes, arranca el servidor y abre `/proyector` en el video beam y `/panel` en otra pestaña o tablet.
- [ ] **Red:** muchas redes de universidad bloquean que los celulares se vean entre sí ("aislamiento de clientes"). El plan más seguro es **compartir internet desde un celular (hotspot)** y conectar a él el portátil y al público. Alternativa: un router portátil. Comparte en voz alta o en una diapositiva el nombre y la clave de la red.
- [ ] Prueba con **3–4 celulares** reales que el QR abra el juego y que puedan ofertar.
- [ ] Si el QR muestra una dirección rara (por ejemplo de una VPN o máquina virtual), mira la consola: lista todas las redes detectadas. Puedes forzar la correcta con `PUBLIC_URL=http://192.168.x.x:3000 npm start` (en Windows PowerShell: `$env:PUBLIC_URL="http://192.168.x.x:3000"; npm start`).
- [ ] Prueba el **sonido** del proyector (botón "Activar sonido") y el volumen del salón.
- [ ] Ten una **foto del QR** o la dirección escrita en una diapositiva de respaldo.
- [ ] Deja el portátil **conectado a la corriente** y desactiva la suspensión automática durante la exposición.
- [ ] Antes de empezar de verdad, usa **Reiniciar juego** (o borra `data/state.json`) para limpiar el ensayo.

## 8. Solución de problemas

| Problema | Solución |
|---|---|
| El celular no abre la página | ¿Está en la **misma WiFi** que el portátil? ¿Aceptaste el Firewall de Windows? ¿La red de la U aísla clientes? → usa un hotspot. |
| "Ese nombre ya lo tiene otro equipo" | Los nombres no se repiten (sin importar mayúsculas). Elijan otro. |
| "El ingreso está cerrado" | El juego ya empezó. En el panel pulsa **Permitir ingresos**. |
| Un equipo aparece desconectado | Que recargue la página: vuelve solo. Si abrió el juego en dos celulares, juega el último. |
| No suena el proyector | Haz clic en **Activar sonido** o en el botón 🔇 de la esquina. |
| El panel pide el PIN otra vez | Se guarda solo mientras la pestaña esté abierta. Escríbelo de nuevo. |
| `Error: listen EADDRINUSE` | Ya hay un servidor abierto. Ciérralo o usa otro puerto: `PORT=3001 npm start`. |
| Me equivoqué al calificar | **Deshacer veredicto** (antes de pasar a la siguiente fase). Para otros errores, **Saldo** ajusta el dinero de un equipo. |

## 9. Para el equipo técnico

- Stack: Node.js + Express + Socket.IO; frontend en HTML/CSS/JS sin compilación. Estado en memoria con respaldo en `data/state.json`.
- `npm test`: pruebas de la lógica (`test/game.test.js`).
- `npm run simulate`: 40 celulares falsos pujando al azar; verifica que gana la oferta más alta, que el servidor no se cae y que la respuesta esperada nunca llega a jugadores ni al proyector. `SIM_SECONDS=60 npm run simulate` para una subasta de 60 s.
- `GET /healthz` responde `ok`.
- El servidor es la única autoridad: valida ofertas, maneja los relojes y envía a cada pantalla solo lo que le corresponde. Los textos de los usuarios se pintan con `textContent`.

### Prueba manual guiada

1. `npm start`; abre `/proyector`, `/panel` (PIN) y dos pestañas de `/jugar` (una en ventana de incógnito) con nombres distintos.
2. Iniciar juego → Abrir subasta → oferta desde ambas pestañas → espera el cierre → Mostrar pregunta → **Incorrecta**: comprueba que no se descontó nada y aparece "Intento 2".
3. Repetir subasta → oferta → Cerrar ahora → Mostrar pregunta (es otra pregunta) → **Correcta**: martillo y ¡VENDIDO! en el proyector y en el celular ganador, saldo descontado.
4. Deshacer veredicto → el saldo vuelve. Correcta otra vez → Siguiente ronda.

### Decisiones tomadas (lo que el enunciado dejaba abierto)

- Se usa en **red local**, no en Render: no hay `render.yaml`. El QR toma la IP WiFi del portátil (o `PUBLIC_URL` si la defines).
- El PIN puede ir en `data/config.json` (`hostPin`) además de la variable `HOST_PIN`, para no tener que usar la terminal.
- Las tipografías (Alfa Slab One, Rye, Nunito, licencia OFL) están incluidas en `public/fonts` para funcionar sin internet.
- Los botones rápidos envían el incremento y el servidor calcula `max(precio base, oferta actual + X)` con la oferta vigente en ese instante, así no fallan por un dato viejo.
- Cada equipo recibe una **paleta numerada** (#1, #2…) en el orden de llegada.
- Los intentos rechazados también cuentan para el límite de 5 ofertas por segundo.
- No se puede expulsar al equipo que ganó la puja mientras responde.
- El presentador puede calificar antes de que acabe el tiempo de la pregunta.
