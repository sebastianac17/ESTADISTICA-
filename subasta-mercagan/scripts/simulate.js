'use strict';
/**
 * Simulación de carga: 40 celulares falsos entran y ofertan al azar durante una subasta completa.
 * Comprueba que la oferta ganadora es la más alta aceptada, que el servidor sigue vivo
 * y que ningún mensaje a jugadores/proyector contiene la respuesta esperada.
 *
 *   npm run simulate                 (subasta de 20 s)
 *   SIM_SECONDS=60 npm run simulate  (subasta de 60 s, como en vivo)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const N = Number(process.env.SIM_TEAMS) || 40;
const SECONDS = Number(process.env.SIM_SECONDS) || 20;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'subasta-sim-'));
process.env.FRESH = '1';
process.env.QUIET = '1';
process.env.HOST_PIN = 'sim-pin';
process.env.AUCTION_SECONDS = String(SECONDS);

const { io: ioClient } = require('socket.io-client');
const { start, server, game } = require('../server');
const questions = require('../data/questions.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
};

function emitAck(sock, ev, payload) {
  return new Promise((resolve) => sock.timeout(5000).emit(ev, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
}

(async () => {
  await start(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  console.log(`[sim] Servidor de prueba en ${url}, ${N} equipos, subasta de ${SECONDS} s`);

  const secretStrings = questions.flatMap((q) => [q.expectedAnswer, q.criteria]);
  let leaked = 0;
  const watchLeaks = (sock) => sock.onAny((_ev, payload) => {
    const txt = JSON.stringify(payload || '');
    if (txt.includes('expectedAnswer') || txt.includes('"criteria"') || secretStrings.some((s) => txt.includes(JSON.stringify(s).slice(1, -1)))) leaked++;
  });

  // host
  const host = ioClient(url, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => host.on('connect', r));
  const denied = await emitAck(host, 'host:startGame', {});
  check(denied && denied.error === 'not_authorized', 'un socket sin PIN recibe not_authorized');
  check((await emitAck(host, 'host:auth', { pin: 'mal' })).ok === false, 'PIN incorrecto rechazado');
  check((await emitAck(host, 'host:auth', { pin: 'sim-pin' })).ok === true, 'PIN correcto aceptado');

  // proyector
  const projector = ioClient(url, { transports: ['websocket'], forceNew: true });
  watchLeaks(projector);
  await new Promise((r) => projector.on('connect', r));
  projector.emit('projector:hello');

  // jugadores
  const players = [];
  for (let i = 0; i < N; i++) {
    const sock = ioClient(url, { transports: ['websocket'], forceNew: true });
    watchLeaks(sock);
    const p = { sock, name: `Sim ${String(i + 1).padStart(2, '0')}`, state: null, accepted: [], rejected: 0 };
    sock.on('state', (s) => (p.state = s));
    sock.on('bid:accepted', (b) => p.accepted.push(b.amount));
    sock.on('bid:rejected', () => p.rejected++);
    players.push(p);
  }
  await Promise.all(players.map((p) => new Promise((r) => (p.sock.connected ? r() : p.sock.on('connect', r)))));
  const joins = await Promise.all(players.map((p) => emitAck(p.sock, 'join', { teamName: p.name })));
  check(joins.every((j) => j.ok), `${N} equipos entraron`);
  players.forEach((p, i) => (p.teamId = joins[i].teamId));

  check((await emitAck(host, 'host:startGame', {})).ok, 'iniciar juego');
  check((await emitAck(host, 'host:openAuction', {})).ok, 'abrir subasta');
  await sleep(300);

  const t0 = Date.now();
  let sent = 0;
  const stopAt = t0 + SECONDS * 1000 + 800; // sigue ofertando un poco después del cierre
  await Promise.all(players.map(async (p) => {
    while (Date.now() < stopAt) {
      await sleep(80 + Math.random() * 900);
      const s = p.state;
      if (!s || !s.auction) continue;
      const roll = Math.random();
      const payload = roll < 0.6
        ? { increment: s.quickBids[Math.floor(Math.random() * s.quickBids.length)] }
        : { amount: s.auction.minNext + 10000 * Math.floor(Math.random() * 8) };
      sent++;
      p.sock.emit('bid', payload);
    }
  }));
  await sleep(500);

  const st = game.state;
  check(st.phase === 'AUCTION_CLOSED', `la subasta cerró sola (fase ${st.phase})`);
  const allAccepted = players.flatMap((p) => p.accepted);
  const maxAccepted = Math.max(...allAccepted);
  check(st.auction.highest && st.auction.highest.amount === maxAccepted, `la oferta ganadora (${st.auction.highest && st.auction.highest.amount}) es la más alta aceptada (${maxAccepted})`);
  const sorted = st.auction.bids.every((b, i, arr) => i === 0 || b.amount >= arr[i - 1].amount + 50000);
  check(sorted, 'cada oferta superó a la anterior en al menos $50.000');
  check(st.auction.bids.every((b) => b.at < st.auction.endsAt + 1), 'ninguna oferta se aceptó después del cierre');
  console.log(`[sim] ofertas enviadas: ${sent}, aceptadas: ${allAccepted.length}, rechazadas: ${players.reduce((a, p) => a + p.rejected, 0)}`);

  const health = await fetch(`${url}/healthz`).then((r) => r.text()).catch(() => 'error');
  check(health === 'ok', 'el servidor sigue vivo (/healthz)');

  // pregunta + veredicto
  const winnerId = st.auction.highest.teamId;
  const before = st.teams[winnerId].balance;
  check((await emitAck(host, 'host:showQuestion', {})).ok, 'mostrar pregunta');
  await sleep(300);
  const winner = players.find((p) => p.teamId === winnerId);
  const other = players.find((p) => p.teamId !== winnerId);
  check(!!(winner.state.question && winner.state.question.text), 'el ganador recibe el texto de la pregunta');
  check(!(other.state.question && other.state.question.text), 'los demás no reciben la pregunta');
  check((await emitAck(host, 'host:verdict', { correct: true })).ok, 'marcar correcta');
  await sleep(200);
  check(game.state.teams[winnerId].balance === before - st.auction.highest.amount, 'se descontó el saldo al ganador');
  check(leaked === 0, `ningún mensaje a jugadores o proyector filtró la respuesta (${leaked} filtraciones)`);

  for (const p of players) p.sock.close();
  host.close();
  projector.close();
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  console.log(failures.length ? `\n[sim] FALLÓ: ${failures.length} comprobaciones` : '\n[sim] Todo bien ✔');
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
