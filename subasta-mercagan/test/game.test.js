'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game, PHASES } = require('../src/game');
const { Store } = require('../src/store');

const config = require('../data/config.json');
const questions = require('../data/questions.json');

function makeGame() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const game = new Game(config, questions, { now: clock.now });
  return { game, clock };
}

function setup(nTeams = 2) {
  const { game, clock } = makeGame();
  const teams = [];
  for (let i = 0; i < nTeams; i++) teams.push(game.join(`Equipo ${i + 1}`).team);
  return { game, clock, teams };
}

function toQuestion(game, clock, teams, amount = 100000) {
  if (game.phase === PHASES.LOBBY) assert.ok(game.startGame().ok);
  assert.ok(game.openAuction().ok);
  assert.ok(game.bid(teams[0].id, { amount }).ok);
  clock.advance(config.auctionSeconds * 1000);
  assert.ok(game.closeAuction().ok);
  const r = game.showQuestion();
  assert.ok(r.ok);
  return r.question;
}

test('join valida nombres', () => {
  const { game } = makeGame();
  assert.equal(game.join('A').ok, false);
  assert.equal(game.join('x'.repeat(25)).ok, false);
  assert.ok(game.join('Los <b>Toros</b>').ok);
  assert.equal(game.teamList()[0].name, 'Los bToros/b');
  assert.ok(game.join('Vaqueros').ok);
  assert.equal(game.join('VAQUEROS').ok, false, 'no repite ignorando mayúsculas');
  assert.equal(game.teamList()[1].balance, 2000000);
});

test('ingreso bloqueado tras iniciar y reabrible', () => {
  const { game } = setup(1);
  game.startGame();
  assert.equal(game.join('Tardíos').ok, false);
  game.toggleJoin(true);
  assert.ok(game.join('Tardíos').ok);
});

test('resume con token', () => {
  const { game, teams } = setup(1);
  assert.equal(game.resume(teams[0].token).team.id, teams[0].id);
  assert.equal(game.resume('nope').ok, false);
});

test('validación de ofertas', () => {
  const { game, clock, teams } = setup(3);
  const [a, b, c] = teams;
  const g = { bid: (id, x) => (clock.advance(210), game.bid(id, x)) };
  assert.equal(g.bid(a.id, { amount: 100000 }).ok, false, 'sin subasta abierta');
  game.startGame();
  game.openAuction();
  assert.equal(g.bid(a.id, { amount: 90000 }).ok, false, 'menor al base');
  assert.equal(g.bid(a.id, { amount: 105000 }).ok, false, 'no múltiplo');
  assert.equal(g.bid(a.id, { amount: 100000.5 }).ok, false, 'no entero');
  assert.equal(g.bid(a.id, { amount: 'abc' }).ok, false);
  assert.equal(g.bid(a.id, { amount: 2010000 }).ok, false, 'mayor al saldo');
  assert.ok(g.bid(a.id, { amount: 100000 }).ok);
  assert.equal(g.bid(a.id, { amount: 300000 }).ok, false, 'no se supera a sí mismo');
  assert.equal(g.bid(b.id, { amount: 140000 }).ok, false, 'incremento mínimo 50.000');
  assert.ok(g.bid(b.id, { amount: 150000 }).ok);
  // quick bid by increment adds to current highest
  assert.ok(g.bid(c.id, { increment: 200000 }).ok);
  assert.equal(game.state.auction.highest.amount, 350000);
  assert.equal(g.bid(a.id, { increment: 70000 }).ok, false, 'incremento no permitido');
  clock.advance(60000);
  assert.equal(g.bid(a.id, { amount: 1000000 }).ok, false, 'después del cierre');
});

test('primera oferta rápida arranca en el precio base', () => {
  const { game, teams } = setup(1);
  game.startGame();
  game.openAuction();
  assert.ok(game.bid(teams[0].id, { increment: 50000 }).ok);
  assert.equal(game.state.auction.highest.amount, 100000);
});

test('límite de 5 ofertas por segundo', () => {
  const { game, clock, teams } = setup(2);
  game.startGame();
  game.openAuction();
  const [a, b] = teams;
  let amount = 100000;
  let okCount = 0;
  for (let i = 0; i < 12; i++) {
    const who = i % 2 === 0 ? a : b;
    const r = game.bid(who.id, { amount });
    if (r.ok) {
      okCount++;
      amount += 50000;
    }
  }
  assert.equal(okCount, 10, 'cada equipo solo 5 en el mismo segundo');
  clock.advance(1000);
  assert.ok(game.bid(a.id, { amount }).ok);
});

test('cierre sin ofertas y reabrir', () => {
  const { game, clock } = setup(1);
  game.startGame();
  game.openAuction();
  clock.advance(60000);
  game.closeAuction();
  assert.equal(game.phase, PHASES.NO_BIDS);
  assert.equal(game.showQuestion().ok, false);
  assert.ok(game.reopenAuction().ok);
  assert.equal(game.phase, PHASES.AUCTION);
  assert.equal(game.minNextBid(), 100000);
});

test('venta correcta descuenta el saldo solo al marcar Correcta', () => {
  const { game, clock, teams } = setup(2);
  toQuestion(game, clock, teams, 300000);
  assert.equal(game.state.teams[teams[0].id].balance, 2000000, 'no descuenta al cerrar');
  assert.ok(game.verdict(true).ok);
  assert.equal(game.phase, PHASES.SOLD);
  assert.equal(game.state.teams[teams[0].id].balance, 1700000);
  assert.equal(game.state.sales.length, 1);
  assert.ok(game.nextRound().ok);
  assert.equal(game.state.round, 2);
  assert.equal(game.phase, PHASES.ROUND_INTRO);
});

test('anulación no descuenta, sube el intento y cambia la pregunta', () => {
  const { game, clock, teams } = setup(2);
  const q1 = toQuestion(game, clock, teams, 300000);
  assert.ok(game.verdict(false).ok);
  assert.equal(game.phase, PHASES.ANNULLED);
  assert.equal(game.state.teams[teams[0].id].balance, 2000000);
  assert.ok(game.repeatAuction().ok);
  assert.equal(game.state.attempt, 2);
  assert.equal(game.state.round, 1);
  // the team that failed can bid again
  const q2 = toQuestion(game, clock, teams, 100000);
  assert.notEqual(q1.id, q2.id);
  assert.equal(q2.level, 'facil');
});

test('preguntas por nivel y sin repetir en una partida completa', () => {
  const { game, clock, teams } = setup(2);
  const seen = [];
  for (let round = 1; round <= 5; round++) {
    // two annulments per round to burn more questions
    for (let k = 0; k < 2; k++) {
      const q = toQuestion(game, clock, teams, 100000);
      seen.push(q);
      assert.equal(q.level, config.difficultyByRound[round - 1]);
      game.verdict(false);
      game.repeatAuction();
    }
    const q = toQuestion(game, clock, teams, 100000);
    seen.push(q);
    game.verdict(true);
    game.nextRound();
  }
  assert.equal(game.phase, PHASES.FINISHED);
  const ids = seen.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'ninguna repetida');
  assert.equal(game.state.teams[teams[0].id].prizes.length, 5);
});

test('si un nivel se agota reutiliza la menos reciente', () => {
  const { game } = setup(1);
  const easy = questions.filter((q) => q.level === 'facil').map((q) => q.id);
  game.state.usedQuestions = easy.slice();
  game.state.round = 1;
  assert.equal(game.pickQuestion().id, easy[0]);
});

test('deshacer veredicto restituye saldo', () => {
  const { game, clock, teams } = setup(2);
  toQuestion(game, clock, teams, 500000);
  game.verdict(true);
  assert.equal(game.state.teams[teams[0].id].balance, 1500000);
  assert.ok(game.undoVerdict().ok);
  assert.equal(game.phase, PHASES.QUESTION);
  assert.equal(game.state.teams[teams[0].id].balance, 2000000);
  assert.equal(game.state.sales.length, 0);
  assert.equal(game.state.teams[teams[0].id].prizes.length, 0);
  game.verdict(false);
  assert.ok(game.undoVerdict().ok);
  assert.equal(game.phase, PHASES.QUESTION);
  game.verdict(true);
  game.nextRound();
  assert.equal(game.undoVerdict().ok, false, 'no se deshace tras avanzar');
});

test('saldo se acumula y nunca queda negativo', () => {
  const { game, clock, teams } = setup(2);
  toQuestion(game, clock, teams, 1500000);
  game.verdict(true);
  game.nextRound();
  game.openAuction();
  assert.equal(game.bid(teams[0].id, { amount: 600000 }).ok, false, 'solo le quedan 500.000');
  assert.ok(game.bid(teams[0].id, { amount: 500000 }).ok);
  assert.equal(game.adjustBalance(teams[0].id, -600000).ok, false);
});

test('las vistas públicas no filtran la respuesta esperada', () => {
  const { game, clock, teams } = setup(2);
  const q = toQuestion(game, clock, teams);
  const proj = JSON.stringify(game.projectorView());
  const p0 = JSON.stringify(game.playerView(teams[0].id));
  const p1 = JSON.stringify(game.playerView(teams[1].id));
  for (const s of [proj, p0, p1]) {
    assert.ok(!s.includes(q.expectedAnswer));
    assert.ok(!s.includes(q.criteria));
    assert.ok(!s.includes('expectedAnswer'));
    assert.ok(!s.includes('token'));
  }
  assert.ok(p0.includes(q.question), 'el ganador ve la pregunta');
  assert.ok(!p1.includes(q.question), 'los demás no');
  assert.ok(proj.includes(q.question));
  assert.equal(game.hostView().question.expectedAnswer, q.expectedAnswer);
});

test('expulsar a un equipo durante la subasta recalcula el líder', () => {
  const { game, teams } = setup(3);
  game.startGame();
  game.openAuction();
  game.bid(teams[0].id, { amount: 100000 });
  game.bid(teams[1].id, { amount: 200000 });
  assert.ok(game.kickTeam(teams[1].id).ok);
  assert.equal(game.state.auction.highest.teamId, teams[0].id);
});

test('reiniciar conserva equipos y devuelve el saldo', () => {
  const { game, clock, teams } = setup(2);
  toQuestion(game, clock, teams, 400000);
  game.verdict(true);
  game.resetGame();
  assert.equal(game.phase, PHASES.LOBBY);
  assert.equal(game.teamList().length, 2);
  assert.equal(game.state.teams[teams[0].id].balance, 2000000);
  assert.equal(game.state.usedQuestions.length, 0);
});

test('restauración desde state.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subasta-'));
  const store = new Store(path.join(dir, 'state.json'));
  const { game, clock, teams } = setup(2);
  game.startGame();
  game.openAuction();
  game.bid(teams[1].id, { amount: 250000 });
  store.saveNow(game.toJSON());

  const restored = new Game(config, questions, { now: clock.now }).loadState(store.load());
  assert.equal(restored.phase, PHASES.AUCTION);
  assert.equal(restored.state.auction.highest.amount, 250000);
  assert.equal(restored.resume(teams[0].token).team.name, 'Equipo 1');
  assert.ok(restored.bid(teams[0].id, { amount: 300000 }).ok);
  fs.rmSync(dir, { recursive: true, force: true });
});
