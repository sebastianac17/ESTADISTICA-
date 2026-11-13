'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game, PHASES } = require('./src/game');
const { Store } = require('./src/store');

// ---------- configuration ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'));
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions.json'), 'utf8'));
if (process.env.AUCTION_SECONDS) config.auctionSeconds = Number(process.env.AUCTION_SECONDS);
if (process.env.QUESTION_SECONDS) config.questionSeconds = Number(process.env.QUESTION_SECONDS);
const PORT = Number(process.env.PORT) || 3000;
const HOST_PIN = String(process.env.HOST_PIN || config.hostPin || '1234');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// ---------- game + persistence ----------
const store = new Store(path.join(DATA_DIR, 'state.json'));
const game = new Game(config, questions);
const saved = store.load();
if (saved && process.env.FRESH !== '1') {
  game.loadState(saved);
  console.log(`[phase] Partida restaurada desde data/state.json (fase ${game.phase}, lote ${game.state.round})`);
}

// ---------- network helpers ----------
const VIRTUAL_IF = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|utun|^br-|^veth|vpn/i;

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      let score = 0;
      if (a.address.startsWith('192.168.')) score += 30;
      else if (a.address.startsWith('10.')) score += 20;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 10;
      if (/wi-?fi|wlan|wireless|^en0$|^wlp/i.test(name)) score += 15;
      if (VIRTUAL_IF.test(name)) score -= 50;
      out.push({ name, address: a.address, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

function isLocalHost(host) {
  return !host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(host);
}

/** Base URL that phones should use. */
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const fwdHost = req && req.headers['x-forwarded-host'];
  const host = (fwdHost || (req && req.headers.host) || '').split(',')[0].trim();
  if (!isLocalHost(host)) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    return `${proto}://${host}`;
  }
  const lan = lanAddresses()[0];
  return lan ? `http://${lan.address}:${PORT}` : `http://localhost:${PORT}`;
}

// ---------- http ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
const pub = path.join(__dirname, 'public');
app.get('/', (req, res) => res.redirect('/jugar'));
app.get(['/jugar', '/jugar/'], (req, res) => res.sendFile(path.join(pub, 'jugar.html')));
app.get(['/proyector', '/proyector/'], (req, res) => res.sendFile(path.join(pub, 'proyector.html')));
app.get(['/panel', '/panel/'], (req, res) => res.sendFile(path.join(pub, 'panel.html')));
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/api/info', (req, res) => {
  const base = baseUrl(req);
  res.json({
    joinUrl: `${base}/jugar`,
    roomCode: game.state.roomCode,
    lanUrls: lanAddresses().map((a) => `http://${a.address}:${PORT}/jugar`),
  });
});
app.get('/qr.png', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' && /^https?:\/\//.test(req.query.url) ? req.query.url : `${baseUrl(req)}/jugar`;
    const buf = await QRCode.toBuffer(url, {
      width: 900,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#2a2016', light: '#FFF8E1' },
    });
    res.set('Cache-Control', 'no-store').type('png').send(buf);
  } catch (err) {
    res.status(500).send('No se pudo generar el QR');
  }
});
app.use(express.static(pub, { maxAge: '1h', index: false }));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e4,
});

// ---------- broadcasting ----------
const teamSocket = new Map(); // teamId -> socket (last connection wins)
let broadcastTimer = null;

function broadcastNow() {
  clearTimeout(broadcastTimer);
  broadcastTimer = null;
  const serverTime = Date.now();
  io.to('projectors').emit('state', { ...game.projectorView(), serverTime });
  io.to('hosts').emit('state', { ...game.hostView(), serverTime, hostPinIsDefault: HOST_PIN === '1234' });
  for (const [teamId, sock] of teamSocket) {
    sock.emit('state', { ...game.playerView(teamId), serverTime });
  }
}

/** Coalesces bursts of bids into at most ~16 updates per second. */
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(broadcastNow, 60);
}

// ---------- server timers ----------
let auctionTimer = null;
let questionTimer = null;

function syncTimers() {
  clearTimeout(auctionTimer);
  clearTimeout(questionTimer);
  auctionTimer = questionTimer = null;
  const s = game.state;
  if (s.phase === PHASES.AUCTION && s.auction) {
    const ms = Math.max(0, s.auction.endsAt - Date.now());
    auctionTimer = setTimeout(() => {
      const r = game.closeAuction();
      if (r.ok) afterChange(true);
    }, ms);
  }
  if (s.phase === PHASES.QUESTION && s.question && !s.question.timeUp) {
    const ms = Math.max(0, s.question.endsAt - Date.now());
    questionTimer = setTimeout(() => {
      const r = game.questionTimeUp();
      if (r.ok) {
        console.log('[phase] Se acabó el tiempo de la pregunta');
        afterChange(true);
      }
    }, ms);
  }
}

let lastPhase = game.phase;
function afterChange(important) {
  if (game.phase !== lastPhase) {
    console.log(`[phase] ${lastPhase} -> ${game.phase} (lote ${game.state.round}, intento ${game.state.attempt})`);
    lastPhase = game.phase;
  }
  if (important) {
    store.saveNow(game.toJSON());
    syncTimers();
    broadcastNow();
  } else {
    store.saveSoon(() => game.toJSON());
    broadcast();
  }
}

// ---------- sockets ----------
function bindTeam(socket, team) {
  const prev = teamSocket.get(team.id);
  if (prev && prev.id !== socket.id) {
    prev.emit('toast', { text: 'Tu equipo se abrió en otro dispositivo. Esta pestaña quedó desconectada.' });
    prev.emit('session:replaced');
    prev.data.teamId = null;
    prev.leave('players');
  }
  socket.data.teamId = team.id;
  socket.join('players');
  teamSocket.set(team.id, socket);
  game.setConnected(team.id, true);
}

function safeAck(ack) {
  return typeof ack === 'function' ? ack : () => {};
}

io.on('connection', (socket) => {
  socket.data.pinFails = 0;
  socket.emit('clock', { serverTime: Date.now() });

  socket.on('clock', (_payload, ack) => safeAck(ack)({ serverTime: Date.now() }));

  // ----- player -----
  socket.on('join', (payload, ack) => {
    ack = safeAck(ack);
    const r = game.join(payload && payload.teamName);
    if (!r.ok) return ack(r);
    bindTeam(socket, r.team);
    console.log(`[join] ${r.team.name} (${game.teamList().length} equipos)`);
    ack({ ok: true, token: r.team.token, teamId: r.team.id, name: r.team.name });
    io.to('projectors').emit('team:joined', { name: r.team.name });
    afterChange(true);
  });

  socket.on('resume', (payload, ack) => {
    ack = safeAck(ack);
    const r = game.resume(payload && payload.token);
    if (!r.ok) return ack(r);
    bindTeam(socket, r.team);
    ack({ ok: true, teamId: r.team.id, name: r.team.name });
    socket.emit('state', { ...game.playerView(r.team.id), serverTime: Date.now() });
    broadcast();
  });

  socket.on('bid', (payload, ack) => {
    ack = safeAck(ack);
    const teamId = socket.data.teamId;
    if (!teamId) {
      const res = { ok: false, error: 'Tu sesión no está activa. Recarga la página.' };
      socket.emit('bid:rejected', { reason: res.error });
      return ack(res);
    }
    const input = payload && payload.increment !== undefined ? { increment: payload.increment } : { amount: payload && payload.amount };
    const r = game.bid(teamId, input);
    if (!r.ok) {
      socket.emit('bid:rejected', { reason: r.error });
      return ack(r);
    }
    console.log(`[bid] ${r.bid.teamName} $${r.bid.amount}`);
    socket.emit('bid:accepted', { amount: r.bid.amount });
    ack({ ok: true, amount: r.bid.amount });
    if (r.previousLeader && r.previousLeader !== teamId) {
      const s = teamSocket.get(r.previousLeader);
      if (s) s.emit('bid:outbid', { teamName: r.bid.teamName, amount: r.bid.amount });
    }
    io.to('projectors').emit('bid:new', { teamName: r.bid.teamName, amount: r.bid.amount });
    afterChange(false);
  });

  // ----- projector -----
  socket.on('projector:hello', (_p, ack) => {
    socket.join('projectors');
    socket.emit('state', { ...game.projectorView(), serverTime: Date.now() });
    safeAck(ack)({ ok: true });
  });

  // ----- host -----
  socket.on('host:auth', (payload, ack) => {
    ack = safeAck(ack);
    if (socket.data.pinFails >= 8) return ack({ ok: false, error: 'Demasiados intentos. Recarga la página.' });
    const pin = String((payload && payload.pin) || '');
    const a = Buffer.from(pin);
    const b = Buffer.from(HOST_PIN);
    const good = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!good) {
      socket.data.pinFails++;
      return ack({ ok: false, error: 'PIN incorrecto.' });
    }
    socket.data.isHost = true;
    socket.join('hosts');
    console.log('[host] Panel autenticado');
    ack({ ok: true });
    socket.emit('state', { ...game.hostView(), serverTime: Date.now(), hostPinIsDefault: HOST_PIN === '1234' });
  });

  const hostActions = {
    startGame: () => game.startGame(),
    openAuction: () => game.openAuction(),
    closeAuctionNow: () => game.closeAuction(),
    showQuestion: () => game.showQuestion(),
    verdict: (p) => game.verdict(!!(p && p.correct === true)),
    undoVerdict: () => game.undoVerdict(),
    nextRound: () => game.nextRound(),
    repeatAuction: () => game.repeatAuction(),
    reopenAuction: () => game.reopenAuction(),
    toggleJoin: (p) => game.toggleJoin(!!(p && p.allow)),
    kickTeam: (p) => {
      const r = game.kickTeam(p && p.teamId);
      if (r.ok) {
        const s = teamSocket.get(r.team.id);
        if (s) {
          s.emit('kicked');
          s.data.teamId = null;
          s.leave('players');
        }
        teamSocket.delete(r.team.id);
      }
      return r;
    },
    adjustBalance: (p) => game.adjustBalance(p && p.teamId, p && p.delta),
    resetGame: () => game.resetGame(),
  };

  for (const [name, fn] of Object.entries(hostActions)) {
    socket.on(`host:${name}`, (payload, ack) => {
      ack = safeAck(ack);
      if (!socket.data.isHost) return ack({ ok: false, error: 'not_authorized' });
      let r;
      try {
        r = fn(payload);
      } catch (err) {
        console.error(`[host] Error en ${name}:`, err);
        r = { ok: false, error: 'Error interno. Revisa la consola del servidor.' };
      }
      if (name === 'verdict' && r.ok) console.log(`[verdict] ${payload && payload.correct ? 'CORRECTA' : 'INCORRECTA'}`);
      if (!r.ok) socket.emit('toast', { text: r.error });
      ack(r.ok ? { ok: true } : r);
      if (r.ok) afterChange(true);
    });
  }

  socket.on('disconnect', () => {
    const teamId = socket.data.teamId;
    if (teamId && teamSocket.get(teamId) === socket) {
      teamSocket.delete(teamId);
      game.setConnected(teamId, false);
      broadcast();
    }
  });
});

// ---------- start ----------
function start(port = PORT) {
  // If the server was down while a timer ran out, finish it now.
  const s = game.state;
  if (s.phase === PHASES.AUCTION && s.auction && Date.now() >= s.auction.endsAt) game.closeAuction();
  if (s.phase === PHASES.QUESTION && s.question && Date.now() >= s.question.endsAt) game.questionTimeUp();
  syncTimers();
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      port = server.address().port;
      if (process.env.QUIET === '1') return resolve(server);
      const lan = lanAddresses();
      const line = '─'.repeat(60);
      console.log(`\n${line}\n  ¿QUIÉN DA MÁS?  ·  Subasta en vivo de Mercagán\n${line}`);
      console.log(`  Proyector (en este computador):  http://localhost:${port}/proyector`);
      console.log(`  Panel del presentador:           http://localhost:${port}/panel`);
      if (PUBLIC_URL) console.log(`  Celulares (PUBLIC_URL):          ${PUBLIC_URL}/jugar`);
      else if (lan.length) {
        console.log(`  Celulares (misma red WiFi):      http://${lan[0].address}:${port}/jugar`);
        for (const a of lan.slice(1)) console.log(`     otra red detectada (${a.name}):   http://${a.address}:${port}/jugar`);
      } else console.log('  ⚠ No se detectó ninguna red WiFi. Conecta el computador a una red o activa un hotspot.');
      console.log(`  PIN del panel: ${HOST_PIN === '1234' ? '1234 (el de fábrica; cámbialo en data/config.json -> "hostPin")' : '(personalizado)'}`);
      console.log(`${line}\n  Para apagar: Ctrl + C\n`);
      resolve(server);
    });
  });
}

if (require.main === module) start();

module.exports = { start, server, io, game };
