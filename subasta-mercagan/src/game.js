'use strict';
/**
 * Pure game logic for "¿Quién da más?". No network, no timers.
 * Every mutating method returns { ok: true, ... } or { ok: false, error }.
 * Error strings are user-facing (Colombian Spanish).
 */
const crypto = require('crypto');

const PHASES = Object.freeze({
  LOBBY: 'LOBBY',
  ROUND_INTRO: 'ROUND_INTRO',
  AUCTION: 'AUCTION',
  AUCTION_CLOSED: 'AUCTION_CLOSED',
  NO_BIDS: 'NO_BIDS',
  QUESTION: 'QUESTION',
  SOLD: 'SOLD',
  ANNULLED: 'ANNULLED',
  FINISHED: 'FINISHED',
});

const MAX_BIDS_PER_SECOND = 5;
const LOG_LIMIT = 300;

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
  return code;
}

/** Normalises a team name: strips HTML-ish chars and control chars, collapses spaces. */
function cleanTeamName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}
function fail(error) {
  return { ok: false, error };
}

class Game {
  /**
   * @param {object} config   contents of data/config.json
   * @param {Array}  questions contents of data/questions.json
   * @param {object} [opts]   { now: () => ms, random: () => [0,1) }
   */
  constructor(config, questions, opts = {}) {
    this.config = config;
    this.questions = questions;
    this.now = opts.now || (() => Date.now());
    this.random = opts.random || Math.random;
    this.bidTimes = new Map(); // teamId -> recent bid timestamps (rate limit, not persisted)
    this.state = this.freshState();
  }

  freshState() {
    return {
      phase: PHASES.LOBBY,
      round: 1,
      attempt: 1,
      allowJoin: true,
      roomCode: randomRoomCode(),
      teams: {},
      auction: null,
      question: null,
      usedQuestions: [],
      sales: [],
      lastVerdict: null,
      nextPaddle: 1,
      log: [],
      version: 0,
    };
  }

  // ---------- persistence ----------
  toJSON() {
    return this.state;
  }

  loadState(saved) {
    const base = this.freshState();
    this.state = { ...base, ...saved };
    for (const t of Object.values(this.state.teams)) t.connected = false;
    return this;
  }

  // ---------- helpers ----------
  get phase() {
    return this.state.phase;
  }

  currentPrize() {
    const r = this.state.round;
    return this.config.prizes.find((p) => p.round === r) || { round: r, name: `Premio ${r}`, imageUrl: null };
  }

  currentLevel() {
    return this.config.difficultyByRound[this.state.round - 1] || 'facil';
  }

  setPhase(phase) {
    this.state.phase = phase;
    this.state.version++;
  }

  log(type, text) {
    this.state.log.push({ at: this.now(), type, text });
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT);
  }

  teamList() {
    return Object.values(this.state.teams);
  }

  findTeamByToken(token) {
    if (typeof token !== 'string') return null;
    return this.teamList().find((t) => t.token === token) || null;
  }

  canJoin() {
    return this.state.phase === PHASES.LOBBY || this.state.allowJoin;
  }

  /** Minimum valid amount for the next bid. */
  minNextBid() {
    const a = this.state.auction;
    if (!a || !a.highest) return this.config.basePrice;
    return a.highest.amount + this.config.minIncrement;
  }

  // ---------- players ----------
  join(rawName) {
    if (!this.canJoin()) return fail('El ingreso está cerrado por ahora. Pídele a los presentadores que lo abran.');
    const name = cleanTeamName(rawName);
    if (name.length < 2) return fail('El nombre debe tener al menos 2 caracteres.');
    if (name.length > 24) return fail('El nombre puede tener máximo 24 caracteres.');
    if (this.teamList().length >= this.config.maxTeams) return fail('La sala está llena.');
    const lower = name.toLocaleLowerCase('es');
    if (this.teamList().some((t) => t.name.toLocaleLowerCase('es') === lower)) {
      return fail('Ese nombre ya lo tiene otro equipo. Prueba con otro.');
    }
    const team = {
      id: randomId(6),
      token: randomId(16),
      name,
      paddle: this.state.nextPaddle++,
      balance: this.config.startingBalance,
      prizes: [],
      spent: 0,
      joinedAt: this.now(),
      connected: true,
    };
    this.state.teams[team.id] = team;
    this.log('join', `Entró el equipo ${name}`);
    return ok({ team });
  }

  resume(token) {
    const team = this.findTeamByToken(token);
    if (!team) return fail('No encontramos tu equipo. Vuelve a entrar con un nombre.');
    return ok({ team });
  }

  setConnected(teamId, connected) {
    const t = this.state.teams[teamId];
    if (t) t.connected = connected;
  }

  /**
   * Places a bid. `input` is { amount } or { increment } (increment must be one of quickBids).
   */
  bid(teamId, input = {}) {
    const s = this.state;
    const cfg = this.config;
    const team = s.teams[teamId];
    if (!team) return fail('Tu equipo ya no está en la sala.');
    if (s.phase !== PHASES.AUCTION || !s.auction) return fail('La subasta no está abierta.');
    const now = this.now();
    if (now >= s.auction.endsAt) return fail('Se acabó el tiempo de la subasta.');

    // rate limit: max 5 per rolling second
    const times = (this.bidTimes.get(teamId) || []).filter((t) => now - t < 1000);
    if (times.length >= MAX_BIDS_PER_SECOND) return fail('Calma, vaquero: muchas ofertas seguidas.');
    times.push(now);
    this.bidTimes.set(teamId, times);

    const highest = s.auction.highest;
    if (highest && highest.teamId === teamId) return fail('Vas ganando: no puedes superarte a ti mismo.');

    let amount;
    if (input && input.increment !== undefined) {
      const inc = Number(input.increment);
      if (!cfg.quickBids.includes(inc)) return fail('Ese botón de oferta no es válido.');
      amount = Math.max(cfg.basePrice, (highest ? highest.amount : 0) + inc);
    } else {
      amount = Number(input && input.amount);
    }

    if (!Number.isInteger(amount) || amount <= 0) return fail('El monto debe ser un número entero.');
    if (amount % cfg.customBidStep !== 0) {
      return fail(`El monto debe ser múltiplo de $${formatMoney(cfg.customBidStep)}.`);
    }
    const min = this.minNextBid();
    if (amount < min) {
      return fail(highest ? `Te superaron: la oferta mínima ahora es $${formatMoney(min)}.` : `La oferta mínima es $${formatMoney(min)}.`);
    }
    if (amount > team.balance) return fail('No te alcanza el saldo para esa oferta.');

    const bid = { teamId, teamName: team.name, amount, at: now };
    s.auction.bids.push(bid);
    s.auction.highest = { teamId, teamName: team.name, amount };
    this.log('bid', `${team.name} ofertó $${formatMoney(amount)}`);
    return ok({ bid, previousLeader: highest ? highest.teamId : null });
  }

  // ---------- host actions ----------
  startGame() {
    if (this.phase !== PHASES.LOBBY) return fail('El juego ya empezó.');
    if (this.teamList().length === 0) return fail('Todavía no hay equipos en la sala.');
    this.state.round = 1;
    this.state.attempt = 1;
    this.state.allowJoin = false;
    this.setPhase(PHASES.ROUND_INTRO);
    this.log('phase', 'Arrancó el juego: Lote 1');
    return ok();
  }

  openAuction() {
    if (this.phase !== PHASES.ROUND_INTRO && this.phase !== PHASES.NO_BIDS) {
      return fail('Solo puedes abrir la subasta desde la presentación del lote.');
    }
    const now = this.now();
    this.state.auction = {
      startedAt: now,
      endsAt: now + this.config.auctionSeconds * 1000,
      bids: [],
      highest: null,
    };
    this.state.question = null;
    this.bidTimes.clear();
    this.setPhase(PHASES.AUCTION);
    this.log('phase', `Subasta abierta: Lote ${this.state.round}, intento ${this.state.attempt}`);
    return ok();
  }

  /** Reopen after no bids (same prize, same base price). */
  reopenAuction() {
    if (this.phase !== PHASES.NO_BIDS) return fail('Solo se reabre cuando no hubo ofertas.');
    return this.openAuction();
  }

  closeAuction() {
    if (this.phase !== PHASES.AUCTION) return fail('No hay subasta abierta.');
    const a = this.state.auction;
    a.endsAt = Math.min(a.endsAt, this.now());
    a.closedAt = this.now();
    if (!a.highest) {
      this.setPhase(PHASES.NO_BIDS);
      this.log('phase', 'Subasta cerrada sin ofertas');
    } else {
      this.setPhase(PHASES.AUCTION_CLOSED);
      this.log('phase', `Subasta cerrada: ${a.highest.teamName} con $${formatMoney(a.highest.amount)}`);
    }
    return ok();
  }

  pickQuestion() {
    const level = this.currentLevel();
    const pool = this.questions.filter((q) => q.level === level);
    if (pool.length === 0) throw new Error(`No hay preguntas de nivel ${level}`);
    const used = this.state.usedQuestions;
    const unused = pool.filter((q) => !used.includes(q.id));
    if (unused.length > 0) {
      return unused[Math.floor(this.random() * unused.length)];
    }
    // All used: reuse the least recently used one of this level.
    let best = pool[0];
    let bestIdx = Infinity;
    for (const q of pool) {
      const idx = used.lastIndexOf(q.id);
      if (idx < bestIdx) {
        bestIdx = idx;
        best = q;
      }
    }
    return best;
  }

  showQuestion() {
    if (this.phase !== PHASES.AUCTION_CLOSED) return fail('Primero hay que cerrar la subasta con un ganador.');
    const q = this.pickQuestion();
    const used = this.state.usedQuestions;
    const prevIdx = used.indexOf(q.id);
    if (prevIdx !== -1) used.splice(prevIdx, 1);
    used.push(q.id);
    const now = this.now();
    const winner = this.state.auction.highest;
    this.state.question = {
      id: q.id,
      startedAt: now,
      endsAt: now + this.config.questionSeconds * 1000,
      timeUp: false,
      teamId: winner.teamId,
      teamName: winner.teamName,
      amount: winner.amount,
    };
    this.setPhase(PHASES.QUESTION);
    this.log('phase', `Pregunta ${q.id} para ${winner.teamName}`);
    return ok({ question: q });
  }

  questionTimeUp() {
    if (this.phase !== PHASES.QUESTION || !this.state.question) return fail('No hay pregunta en curso.');
    this.state.question.timeUp = true;
    this.state.version++;
    return ok();
  }

  verdict(correct) {
    if (this.phase !== PHASES.QUESTION) return fail('No hay una pregunta para calificar.');
    const q = this.state.question;
    const team = this.state.teams[q.teamId];
    const prize = this.currentPrize();
    if (correct) {
      if (!team) return fail('El equipo ganador ya no está en la sala.');
      if (team.balance < q.amount) return fail('El equipo ya no tiene saldo suficiente (¿ajustaste su saldo?).');
      team.balance -= q.amount;
      team.spent += q.amount;
      team.prizes.push(this.state.round);
      const sale = {
        round: this.state.round,
        attempt: this.state.attempt,
        teamId: team.id,
        teamName: team.name,
        amount: q.amount,
        prize: prize.name,
        questionId: q.id,
      };
      this.state.sales.push(sale);
      this.state.lastVerdict = { correct: true, sale };
      this.setPhase(PHASES.SOLD);
      this.log('verdict', `CORRECTA: ¡Vendido! Lote ${sale.round} a ${team.name} por $${formatMoney(q.amount)}`);
      return ok({ sale });
    }
    this.state.lastVerdict = { correct: false, teamId: q.teamId, teamName: q.teamName };
    this.setPhase(PHASES.ANNULLED);
    this.log('verdict', `INCORRECTA: subasta anulada (${q.teamName})`);
    return ok();
  }

  undoVerdict() {
    if (this.phase !== PHASES.SOLD && this.phase !== PHASES.ANNULLED) return fail('No hay veredicto para deshacer.');
    const lv = this.state.lastVerdict;
    if (lv && lv.correct) {
      const sale = this.state.sales.pop();
      const team = this.state.teams[sale.teamId];
      if (team) {
        team.balance += sale.amount;
        team.spent -= sale.amount;
        const idx = team.prizes.lastIndexOf(sale.round);
        if (idx !== -1) team.prizes.splice(idx, 1);
      }
    }
    this.state.lastVerdict = null;
    if (this.state.question) this.state.question.timeUp = this.now() >= this.state.question.endsAt;
    this.setPhase(PHASES.QUESTION);
    this.log('verdict', 'Se deshizo el veredicto');
    return ok();
  }

  nextRound() {
    if (this.phase !== PHASES.SOLD) return fail('La ronda todavía no se ha vendido.');
    this.state.auction = null;
    this.state.question = null;
    this.state.lastVerdict = null;
    if (this.state.round >= this.config.rounds) {
      this.setPhase(PHASES.FINISHED);
      this.log('phase', 'Fin del juego: podio');
      return ok({ finished: true });
    }
    this.state.round += 1;
    this.state.attempt = 1;
    this.setPhase(PHASES.ROUND_INTRO);
    this.log('phase', `Siguiente ronda: Lote ${this.state.round}`);
    return ok();
  }

  repeatAuction() {
    if (this.phase !== PHASES.ANNULLED) return fail('Solo se repite una subasta anulada.');
    this.state.auction = null;
    this.state.question = null;
    this.state.lastVerdict = null;
    this.state.attempt += 1;
    this.setPhase(PHASES.ROUND_INTRO);
    this.log('phase', `Se repite el Lote ${this.state.round} (intento ${this.state.attempt})`);
    return ok();
  }

  toggleJoin(allow) {
    this.state.allowJoin = !!allow;
    this.state.version++;
    this.log('host', allow ? 'Ingresos abiertos' : 'Ingresos cerrados');
    return ok();
  }

  kickTeam(teamId) {
    const team = this.state.teams[teamId];
    if (!team) return fail('Ese equipo no existe.');
    const q = this.state.question;
    const a = this.state.auction;
    if ((this.phase === PHASES.AUCTION_CLOSED || this.phase === PHASES.QUESTION) && a && a.highest && a.highest.teamId === teamId) {
      return fail('No puedes expulsar al equipo que ganó la puja en este momento.');
    }
    if (q && q.teamId === teamId && this.phase === PHASES.QUESTION) {
      return fail('No puedes expulsar al equipo que está respondiendo.');
    }
    if (a && this.phase === PHASES.AUCTION) {
      a.bids = a.bids.filter((b) => b.teamId !== teamId);
      const top = a.bids.reduce((m, b) => (!m || b.amount > m.amount ? b : m), null);
      a.highest = top ? { teamId: top.teamId, teamName: top.teamName, amount: top.amount } : null;
    }
    delete this.state.teams[teamId];
    this.bidTimes.delete(teamId);
    this.state.version++;
    this.log('host', `Expulsado: ${team.name}`);
    return ok({ team });
  }

  adjustBalance(teamId, delta) {
    const team = this.state.teams[teamId];
    if (!team) return fail('Ese equipo no existe.');
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) return fail('El ajuste debe ser un número entero distinto de cero.');
    if (team.balance + d < 0) return fail('El saldo no puede quedar negativo.');
    team.balance += d;
    this.state.version++;
    this.log('host', `Ajuste de saldo a ${team.name}: ${d > 0 ? '+' : '−'}$${formatMoney(Math.abs(d))}`);
    return ok({ team });
  }

  resetGame() {
    const teams = this.state.teams;
    const fresh = this.freshState();
    for (const t of Object.values(teams)) {
      t.balance = this.config.startingBalance;
      t.prizes = [];
      t.spent = 0;
    }
    fresh.teams = teams;
    fresh.roomCode = this.state.roomCode;
    fresh.nextPaddle = this.state.nextPaddle;
    fresh.version = this.state.version + 1;
    this.state = fresh;
    this.bidTimes.clear();
    this.log('host', 'Juego reiniciado');
    return ok();
  }

  // ---------- views ----------
  ranking() {
    return this.teamList()
      .map((t) => ({ id: t.id, name: t.name, prizes: t.prizes.length, balance: t.balance, spent: t.spent }))
      .sort((a, b) => b.prizes - a.prizes || b.balance - a.balance || a.name.localeCompare(b.name, 'es'));
  }

  questionById(id) {
    return this.questions.find((q) => q.id === id) || null;
  }

  /** Shared base for every role. Never includes expectedAnswer/criteria. */
  baseView() {
    const s = this.state;
    const a = s.auction;
    const q = s.question;
    return {
      phase: s.phase,
      round: s.round,
      rounds: this.config.rounds,
      attempt: s.attempt,
      level: this.currentLevel(),
      prize: this.currentPrize(),
      allowJoin: this.canJoin(),
      roomCode: s.roomCode,
      teamCount: this.teamList().length,
      basePrice: this.config.basePrice,
      minIncrement: this.config.minIncrement,
      quickBids: this.config.quickBids,
      customBidStep: this.config.customBidStep,
      auctionSeconds: this.config.auctionSeconds,
      questionSeconds: this.config.questionSeconds,
      auction: a
        ? {
            endsAt: a.endsAt,
            highest: a.highest ? { teamId: a.highest.teamId, teamName: a.highest.teamName, amount: a.highest.amount } : null,
            bidCount: a.bids.length,
            minNext: this.minNextBid(),
          }
        : null,
      question: q
        ? { endsAt: q.endsAt, timeUp: q.timeUp, teamId: q.teamId, teamName: q.teamName, amount: q.amount }
        : null,
      lastSale: s.phase === PHASES.SOLD ? s.sales[s.sales.length - 1] : null,
      annulledTeam: s.phase === PHASES.ANNULLED && s.lastVerdict ? s.lastVerdict.teamName : null,
      sales: s.sales.map((x) => ({ round: x.round, teamName: x.teamName, amount: x.amount, prize: x.prize })),
      prizes: this.config.prizes,
    };
  }

  projectorView() {
    const v = this.baseView();
    const s = this.state;
    if (s.question && (s.phase === PHASES.QUESTION || s.phase === PHASES.SOLD || s.phase === PHASES.ANNULLED)) {
      const q = this.questionById(s.question.id);
      v.question.text = q ? q.question : '';
    }
    if (s.auction) v.auction.history = s.auction.bids.slice(-8).map((b) => ({ teamName: b.teamName, amount: b.amount, at: b.at }));
    v.showBalances = !!this.config.showBalancesOnProjector;
    v.teams = this.teamList()
      .map((t) => ({ id: t.id, name: t.name, paddle: t.paddle, balance: v.showBalances ? t.balance : null, prizes: t.prizes.length, joinedAt: t.joinedAt }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (s.phase === PHASES.FINISHED) v.ranking = this.ranking().map(({ id, ...r }) => r);
    return v;
  }

  /** Light state for a phone. Question text only for the team that answers. */
  playerView(teamId) {
    const v = this.baseView();
    const s = this.state;
    const t = s.teams[teamId];
    v.me = t ? { id: t.id, name: t.name, paddle: t.paddle, balance: t.balance, prizes: t.prizes.slice(), spent: t.spent } : null;
    if (s.question && t && s.question.teamId === t.id && (s.phase === PHASES.QUESTION || s.phase === PHASES.SOLD || s.phase === PHASES.ANNULLED)) {
      const q = this.questionById(s.question.id);
      v.question.text = q ? q.question : '';
    }
    delete v.prizes;
    if (s.phase !== PHASES.FINISHED) delete v.sales;
    else v.ranking = this.ranking().slice(0, 10).map(({ id, ...r }) => r);
    return v;
  }

  hostView() {
    const v = this.projectorView();
    const s = this.state;
    if (s.question) {
      const q = this.questionById(s.question.id);
      if (q) {
        v.question.id = q.id;
        v.question.text = q.question;
        v.question.expectedAnswer = q.expectedAnswer;
        v.question.criteria = q.criteria;
      }
    }
    v.teams = this.teamList()
        .map((t) => ({ id: t.id, name: t.name, paddle: t.paddle, balance: t.balance, prizes: t.prizes.length, spent: t.spent, connected: !!t.connected, joinedAt: t.joinedAt }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
    v.joinOpenFlag = s.allowJoin;
    v.canUndo = s.phase === PHASES.SOLD || s.phase === PHASES.ANNULLED;
    v.usedQuestions = s.usedQuestions.slice();
    v.log = s.log.slice(-80);
    v.ranking = this.ranking().map(({ id, ...r }) => r);
    return v;
  }
}

function formatMoney(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

module.exports = { Game, PHASES, cleanTeamName, formatMoney };
