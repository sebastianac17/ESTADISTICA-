/* Pantalla del proyector */
(function () {
  'use strict';
  const { el, $, setText, clear, money, Sound } = window.Mercagan;
  const M = window.Mercagan;
  const RING = 553; // 2πr con r = 88

  let state = null;
  let currentView = null;
  let animKey = null;
  let knownTeams = new Set();
  let firstTeams = true;
  let lastHistKey = '';
  let lastLeaderKey = '';
  let lastTick = null;
  let qrLoadedFor = null;

  // ---------- sonido / pantalla completa ----------
  function closeGate(withSound) {
    if (withSound) Sound.unlock();
    $('#soundGate').hidden = true;
    updateMute();
  }
  $('#soundBtn').addEventListener('click', () => closeGate(true));
  $('#noSoundBtn').addEventListener('click', () => {
    Sound.muted = true;
    closeGate(false);
  });
  function updateMute() {
    setText('#muteBtn', Sound.muted || !Sound.ctx ? '🔇' : '🔊');
  }
  $('#muteBtn').addEventListener('click', () => {
    if (!Sound.ctx) {
      Sound.unlock();
      Sound.muted = false;
    } else Sound.muted = !Sound.muted;
    updateMute();
  });
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'f') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen && document.exitFullscreen();
    }
    if (k === 'm') $('#muteBtn').click();
  });

  // ---------- conexión ----------
  const socket = M.connect((s) => s.emit('projector:hello'));
  socket.on('state', (s) => {
    state = s;
    render();
  });
  socket.on('bid:new', () => Sound.bell());

  // ---------- vistas ----------
  const VIEWS = ['lobby', 'intro', 'nobids', 'auction', 'closed', 'question', 'sold', 'annulled', 'podium'];
  function show(name) {
    if (currentView === name) return;
    currentView = name;
    for (const v of VIEWS) $('#v-' + v).hidden = v !== name;
  }

  function render() {
    const s = state;
    if (!s) return;
    const lot = $('#hLot');
    lot.hidden = s.phase === 'LOBBY' || s.phase === 'FINISHED';
    setText(lot, `Lote ${s.round} de ${s.rounds}`);
    setText('#hRoom', s.phase === 'LOBBY' ? '' : `Sala ${s.roomCode}`);

    switch (s.phase) {
      case 'LOBBY':
        renderLobby(s);
        break;
      case 'ROUND_INTRO':
        renderIntro(s);
        break;
      case 'NO_BIDS':
        setText('#nbLot', `lote ${s.round}`);
        if (animKey !== 'nobids' + s.round + s.attempt) {
          animKey = 'nobids' + s.round + s.attempt;
          Sound.sad();
        }
        show('nobids');
        break;
      case 'AUCTION':
        renderAuction(s);
        break;
      case 'AUCTION_CLOSED':
        renderClosed(s);
        break;
      case 'QUESTION':
        renderQuestion(s);
        break;
      case 'SOLD':
        renderSold(s);
        break;
      case 'ANNULLED':
        renderAnnulled(s);
        break;
      case 'FINISHED':
        renderPodium(s);
        break;
    }
  }

  function renderLobby(s) {
    if (qrLoadedFor !== 'x') {
      qrLoadedFor = 'x';
      fetch('/api/info')
        .then((r) => r.json())
        .then((info) => {
          $('#qrImg').src = '/qr.png?url=' + encodeURIComponent(info.joinUrl);
          setText('#qrUrl', info.joinUrl.replace(/^https?:\/\//, ''));
        })
        .catch(() => {
          $('#qrImg').src = '/qr.png';
          qrLoadedFor = null;
        });
    }
    setText('#roomCode', s.roomCode);
    setText('#teamCount', s.teamCount);
    setText('#teamCountLabel', s.teamCount === 1 ? 'equipo listo' : 'equipos listos');
    const cloud = $('#teamCloud');
    const ids = new Set(s.teams.map((t) => t.id));
    // quita los que ya no están
    for (const li of Array.from(cloud.children)) if (!ids.has(li.dataset.id)) li.remove();
    for (const t of s.teams) {
      if (cloud.querySelector(`li[data-id="${CSS.escape(t.id)}"]`)) continue;
      const li = el('li', { 'data-id': t.id, class: firstTeams ? '' : 'new' }, el('span', { class: 'num', text: String(t.paddle) }), el('span', { text: t.name }));
      cloud.appendChild(li);
      if (!firstTeams && !knownTeams.has(t.id)) Sound.tone(880, 0.12, { type: 'triangle', vol: 0.15 });
      knownTeams.add(t.id);
    }
    firstTeams = false;
    show('lobby');
  }

  function renderIntro(s) {
    setText('#iLot', `LOTE ${s.round} DE ${s.rounds}`);
    $('#iAttempt').hidden = s.attempt <= 1;
    setText('#iAttempt', `Intento ${s.attempt}`);
    setText('#iPrize', s.prize.name);
    const img = $('#iImg');
    if (s.prize.imageUrl) {
      if (img.getAttribute('src') !== s.prize.imageUrl) img.src = s.prize.imageUrl;
      img.hidden = false;
    } else img.hidden = true;
    setText('#iBase', money(s.basePrice));
    setText('#iLevel', s.level === 'alta' ? 'Pregunta de nivel intermedio alto' : 'Pregunta de nivel intermedio fácil');
    if (animKey !== 'intro' + s.round + s.attempt) {
      animKey = 'intro' + s.round + s.attempt;
      Sound.gavel();
    }
    show('intro');
  }

  function renderAuction(s) {
    const a = s.auction;
    const hi = a.highest;
    setText('#aPrize', s.prize.name + (s.attempt > 1 ? ` · Intento ${s.attempt}` : ''));
    setText('#aLabel', hi ? 'Oferta más alta' : `Precio base ${money(s.basePrice)}`);
    setText('#aAmount', hi ? money(hi.amount) : '¿Quién da más?');
    $('#aAmount').style.fontSize = hi ? '' : '11vh';
    setText('#aLeader', hi ? hi.teamName : 'Levanten la paleta');
    const leaderKey = hi ? hi.teamId + hi.amount : '';
    if (leaderKey !== lastLeaderKey) {
      lastLeaderKey = leaderKey;
      const amt = $('#aAmount');
      amt.classList.remove('bump');
      void amt.offsetWidth;
      amt.classList.add('bump');
    }

    const hist = (a.history || []).slice().reverse();
    const histKey = hist.map((h) => h.at + h.amount).join('|');
    if (histKey !== lastHistKey) {
      const prevTop = lastHistKey.split('|')[0];
      lastHistKey = histKey;
      const list = clear($('#aHistory'));
      hist.forEach((h, i) => {
        const isNew = i === 0 && String(h.at + h.amount) !== prevTop;
        list.appendChild(el('li', { class: isNew ? 'new' : '' }, el('span', { text: h.teamName }), el('span', { class: 'money', text: money(h.amount) })));
      });
    }

    const side = $('#aSide');
    side.hidden = !s.showBalances;
    $('#v-auction').classList.toggle('no-side', !s.showBalances);
    if (s.showBalances) {
      const bal = clear($('#aBalances'));
      const teams = s.teams.slice().sort((x, y) => y.balance - x.balance).slice(0, 22);
      for (const t of teams) bal.appendChild(el('li', { class: hi && hi.teamId === t.id ? 'lead' : '' }, el('span', { text: t.name }), el('span', { class: 'money', text: money(t.balance) })));
    }
    if (animKey !== 'auction' + s.round + s.attempt) {
      animKey = 'auction' + s.round + s.attempt;
      lastHistKey = '';
      Sound.bell();
    }
    show('auction');
  }

  function renderClosed(s) {
    const hi = s.auction.highest;
    setText('#cTeam', hi.teamName);
    setText('#cAmount', money(hi.amount));
    const key = 'closed' + s.round + s.attempt;
    if (animKey !== key) {
      animKey = key;
      const stage = clear($('#cStage'));
      M.playGavel(stage, 'hit');
      Sound.gavel(0.7);
    }
    show('closed');
  }

  function renderQuestion(s) {
    const q = s.question;
    setText('#qTeam', q.teamName);
    setText('#qText', q.text || '');
    $('#qTimeUp').hidden = !q.timeUp;
    if (animKey !== 'q' + q.endsAt) {
      animKey = 'q' + q.endsAt;
      Sound.tone(660, 0.15, { type: 'triangle', vol: 0.2 });
      Sound.tone(990, 0.25, { type: 'triangle', vol: 0.2, delay: 0.15 });
    }
    show('question');
  }

  function renderSold(s) {
    const sale = s.lastSale;
    setText('#sTeam', sale.teamName);
    setText('#sAmount', money(sale.amount));
    setText('#sPrize', sale.prize);
    const key = 'sold' + sale.round + sale.attempt;
    if (animKey !== key) {
      animKey = key;
      show('sold');
      const view = $('#v-sold');
      view.classList.remove('play');
      const stage = clear($('#sStage'));
      M.playGavel(stage, 'hit');
      void view.offsetWidth;
      view.classList.add('play');
      const screen = $('#screen');
      screen.classList.remove('shake');
      void screen.offsetWidth;
      screen.classList.add('shake');
      Sound.gavel(0.7);
      Sound.fanfare(1.15);
      setTimeout(() => M.confetti(220), 750);
    }
    show('sold');
  }

  function renderAnnulled(s) {
    setText('#nMsg', `${s.annulledTeam || 'El equipo'} no acertó. Nadie pierde plata: todos vuelven a ofertar por el mismo lote.`);
    const key = 'annul' + s.round + s.attempt;
    if (animKey !== key) {
      animKey = key;
      const stage = clear($('#nStage'));
      M.playGavel(stage, 'miss');
      Sound.sad();
    }
    show('annulled');
  }

  function renderPodium(s) {
    if (animKey === 'podium') return show('podium');
    animKey = 'podium';
    const lots = clear($('#pLots'));
    const byRound = new Map((s.sales || []).map((x) => [x.round, x]));
    for (let r = 1; r <= s.rounds; r++) {
      const sale = byRound.get(r);
      const prize = (s.prizes || []).find((p) => p.round === r);
      const li = el('li', null,
        el('span', { class: 'lot-tag', text: `Lote ${r}` }),
        el('div', { class: 'who' }, el('b', { text: sale ? sale.teamName : '—' }), el('span', { text: prize ? prize.name : sale ? sale.prize : '' })),
        el('span', { class: 'price', text: sale ? money(sale.amount) : '' })
      );
      li.style.animationDelay = (r * 0.25).toFixed(2) + 's';
      lots.appendChild(li);
    }
    const rank = clear($('#pRanking'));
    (s.ranking || []).slice(0, 10).forEach((t, i) => {
      rank.appendChild(el('li', null, el('span', { class: 'pos', text: i + 1 + '°' }), el('span', { class: 'nm', text: t.name }), el('span', { class: 'sc', text: `${t.prizes} 🏆 · ${money(t.balance)}` })));
    });
    show('podium');
    Sound.fanfare(0.2);
    M.confetti(260);
    setTimeout(() => M.confetti(160), 2500);
  }

  // ---------- relojes ----------
  function setRing(fg, ring, numEl, endsAt, total) {
    const ms = M.msLeft(endsAt);
    const sec = Math.ceil(ms / 1000);
    setText(numEl, sec);
    fg.style.strokeDashoffset = String(RING * (1 - Math.min(1, ms / total)));
    ring.classList.toggle('urgent', sec <= 10 && sec > 0);
    return sec;
  }

  setInterval(() => {
    const s = state;
    if (!s) return;
    if (s.phase === 'AUCTION' && s.auction) {
      const total = (s.auctionSeconds || 60) * 1000;
      const sec = setRing($('#aRingFg'), $('#aRing'), $('#aSec'), s.auction.endsAt, total);
      if (sec <= 10 && sec > 0 && lastTick !== 'a' + sec) {
        lastTick = 'a' + sec;
        Sound.tick(sec <= 3);
      }
    }
    if (s.phase === 'QUESTION' && s.question) {
      const sec = setRing($('#qRingFg'), $('#qRing'), $('#qSec'), s.question.endsAt, (s.questionSeconds || 60) * 1000);
      if (sec <= 10 && sec > 0 && lastTick !== 'q' + sec) {
        lastTick = 'q' + sec;
        Sound.tick(sec <= 3);
      }
      if (sec === 0) $('#qTimeUp').hidden = false;
    }
  }, 200);
})();
