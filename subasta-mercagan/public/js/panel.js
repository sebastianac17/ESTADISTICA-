/* Panel del presentador */
(function () {
  'use strict';
  const { el, $, setText, clear, money, toast } = window.Mercagan;
  const M = window.Mercagan;
  const PIN_KEY = 'mercagan.pin';

  let pin = null;
  try { pin = sessionStorage.getItem(PIN_KEY); } catch (e) {}
  let authed = false;
  let state = null;
  let actions = [];
  let lastTeamSig = '';
  let lastLogSig = ''; // [{label, cls, action, payload, key, primary}]

  const PHASE_LABEL = {
    LOBBY: 'Lobby',
    ROUND_INTRO: 'Intro del lote',
    AUCTION: 'Subasta abierta',
    AUCTION_CLOSED: 'Subasta cerrada',
    NO_BIDS: 'Sin ofertas',
    QUESTION: 'Pregunta',
    SOLD: 'Vendido',
    ANNULLED: 'Anulada',
    FINISHED: 'Final',
  };

  const socket = M.connect((s) => {
    setConn(true);
    if (pin) auth(pin);
  });
  socket.on('disconnect', () => setConn(false));
  socket.on('state', (s) => {
    if (!authed) return;
    state = s;
    render();
  });

  function setConn(on) {
    $('#hDot').className = 'dot ' + (on ? 'on' : 'off');
    setText('#hConn', on ? 'Conectado' : 'Sin conexión');
  }

  function auth(p) {
    socket.emit('host:auth', { pin: p }, (res) => {
      if (res && res.ok) {
        authed = true;
        pin = p;
        try { sessionStorage.setItem(PIN_KEY, p); } catch (e) {}
        $('#pinView').hidden = true;
        $('#panel').hidden = false;
        loadInfo();
      } else {
        authed = false;
        try { sessionStorage.removeItem(PIN_KEY); } catch (e) {}
        $('#pinView').hidden = false;
        $('#panel').hidden = true;
        setText('#pinError', (res && res.error) || 'PIN incorrecto.');
      }
    });
  }

  $('#pinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    setText('#pinError', '');
    auth($('#pinInput').value.trim());
  });

  function loadInfo() {
    fetch('/api/info')
      .then((r) => r.json())
      .then((info) => setText('#joinUrlText', `Los celulares entran en: ${info.joinUrl}  ·  Código de sala: ${info.roomCode}`))
      .catch(() => {});
  }

  function send(action, payload) {
    return new Promise((resolve) => {
      socket.timeout(5000).emit('host:' + action, payload || {}, (err, res) => {
        if (err) {
          toast('El servidor no respondió. ¿Está encendido?', 'bad');
          return resolve({ ok: false });
        }
        if (res && !res.ok && res.error === 'not_authorized') {
          authed = false;
          $('#pinView').hidden = false;
          $('#panel').hidden = true;
        }
        resolve(res || { ok: false });
      });
    });
  }

  // ---------- acciones principales por fase ----------
  function computeActions(s) {
    const a = [];
    const last = s.round >= s.rounds;
    switch (s.phase) {
      case 'LOBBY':
        a.push({ label: `Iniciar juego (${s.teamCount} equipos)`, action: 'startGame', key: 'space', disabled: s.teamCount === 0 });
        break;
      case 'ROUND_INTRO':
        a.push({ label: 'Abrir subasta', action: 'openAuction', key: 'space' });
        break;
      case 'AUCTION':
        a.push({ label: 'Cerrar ahora', action: 'closeAuctionNow', cls: 'wood', key: 'space', confirm: '¿Cerrar la subasta ya, antes de que acabe el tiempo?' });
        break;
      case 'NO_BIDS':
        a.push({ label: 'Reabrir subasta', action: 'reopenAuction', key: 'space' });
        break;
      case 'AUCTION_CLOSED':
        a.push({ label: 'Mostrar pregunta', action: 'showQuestion', key: 'space' });
        break;
      case 'QUESTION':
        a.push({ label: '✔ Correcta', action: 'verdict', payload: { correct: true }, cls: 'green', key: 'c' });
        a.push({ label: '✘ Incorrecta', action: 'verdict', payload: { correct: false }, cls: 'red', key: 'i' });
        break;
      case 'SOLD':
        a.push({ label: last ? 'Ver podio' : 'Siguiente ronda', action: 'nextRound', key: 'space' });
        a.push({ label: 'Deshacer veredicto', action: 'undoVerdict', cls: 'wood secondary-act' });
        break;
      case 'ANNULLED':
        a.push({ label: 'Repetir subasta', action: 'repeatAuction', key: 'space' });
        a.push({ label: 'Deshacer veredicto', action: 'undoVerdict', cls: 'wood secondary-act' });
        break;
      case 'FINISHED':
        break;
    }
    return a;
  }

  let busy = false;
  async function runAction(act) {
    if (busy || act.disabled) return;
    if (act.confirm && !window.confirm(act.confirm)) return;
    busy = true;
    const res = await send(act.action, act.payload);
    busy = false;
    if (res && !res.ok && res.error && res.error !== 'not_authorized') toast(res.error, 'bad');
  }

  function renderActions(s) {
    const box = $('#primaryActions');
    const next = computeActions(s);
    const sig = JSON.stringify(next.map((x) => [x.label, x.action, x.disabled]));
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    actions = next;
    clear(box);
    for (const act of next) {
      const b = el('button', { class: 'btn ' + (act.cls || ''), type: 'button', text: act.label });
      b.disabled = !!act.disabled;
      b.addEventListener('click', () => runAction(act));
      box.appendChild(b);
    }
  }

  // ---------- render ----------
  function render() {
    const s = state;
    if (!s) return;
    $('#pinWarn').hidden = !s.hostPinIsDefault;
    setText('#hPhase', PHASE_LABEL[s.phase] || s.phase);
    setText('#hRound', s.phase === 'LOBBY' ? 'Sin empezar' : `Lote ${s.round}/${s.rounds} · Intento ${s.attempt}`);
    setText('#sLot', `Lote ${s.round} de ${s.rounds}`);
    setText('#sPrize', s.prize.name);
    const lvl = $('#sLevel');
    setText(lvl, s.level === 'alta' ? 'Nivel alto' : 'Nivel fácil');
    lvl.className = 'pill level ' + s.level;

    const hi = s.auction && s.auction.highest;
    let msg = '';
    let big = '';
    switch (s.phase) {
      case 'LOBBY':
        msg = s.teamCount ? `Hay ${s.teamCount} equipos en la sala. Cuando estén todos, arranca.` : 'Esperando equipos. Que escaneen el QR del proyector.';
        break;
      case 'ROUND_INTRO':
        msg = `Presenta el lote${s.attempt > 1 ? ` (intento ${s.attempt})` : ''}. Precio base ${money(s.basePrice)}.`;
        break;
      case 'AUCTION':
        msg = hi ? `Va ganando ${hi.teamName} · ${s.auction.bidCount} ofertas` : 'Subasta abierta. Nadie ha ofertado todavía.';
        big = hi ? money(hi.amount) : '';
        break;
      case 'NO_BIDS':
        msg = 'Nadie ofertó. Puedes reabrir la subasta (mismo lote, mismo precio base).';
        break;
      case 'AUCTION_CLOSED':
        msg = `Adjudicado provisionalmente a ${hi.teamName}. Muestra la pregunta cuando estés listo.`;
        big = money(hi.amount);
        break;
      case 'QUESTION':
        msg = s.question.timeUp ? '¡Se acabó el tiempo! Decide: ¿correcta o incorrecta?' : 'El equipo responde en voz alta. Puedes calificar cuando quieras.';
        break;
      case 'SOLD':
        msg = `¡Vendido! ${s.lastSale.prize} para ${s.lastSale.teamName} por ${money(s.lastSale.amount)}.`;
        break;
      case 'ANNULLED':
        msg = `Subasta anulada (${s.annulledTeam || ''} no acertó). No se descontó nada.`;
        break;
      case 'FINISHED':
        msg = 'Juego terminado. El podio está en el proyector.';
        break;
    }
    setText('#sMsg', msg);
    setText('#sBig', big);

    const q = s.question;
    const showQ = !!q && (s.phase === 'QUESTION' || s.phase === 'SOLD' || s.phase === 'ANNULLED');
    $('#answerBox').hidden = !showQ;
    if (showQ) {
      setText('#qTeam', q.teamName);
      setText('#qAmount', money(q.amount));
      setText('#qText', q.text || '');
      setText('#qId', q.id || '');
      setText('#qExpected', q.expectedAnswer || '');
      setText('#qCriteria', q.criteria || '');
    }

    renderActions(s);

    // secundarios
    const bj = $('#btnJoin');
    setText(bj, s.joinOpenFlag ? 'Bloquear ingresos' : 'Permitir ingresos');
    bj.disabled = s.phase === 'LOBBY';
    $('#btnUndo').disabled = !s.canUndo;
    $('#btnReopen').disabled = s.phase !== 'NO_BIDS';

    // ventas
    const sales = clear($('#sales'));
    for (const x of s.sales) sales.appendChild(el('li', { text: `Lote ${x.round}: ${x.prize} → ${x.teamName} (${money(x.amount)})` }));

    // equipos (solo se reconstruye si cambió algo, para no perder clics)
    setText('#teamCount', s.teams.length);
    const teamSig = JSON.stringify([s.teams, hi && hi.teamId]);
    if (teamSig !== lastTeamSig) {
    lastTeamSig = teamSig;
    const body = clear($('#teamsBody'));
    for (const t of s.teams) {
      const tr = el('tr', { class: hi && hi.teamId === t.id ? 'leader' : '' },
        el('td', null, el('span', { class: 'dot ' + (t.connected ? 'on' : 'off'), title: t.connected ? 'Conectado' : 'Desconectado' })),
        el('td', { text: String(t.paddle) }),
        el('td', { class: 'name', text: t.name }),
        el('td', { class: 'money', text: money(t.balance) }),
        el('td', { text: String(t.prizes) }),
        el('td', { class: 'actions' },
          el('button', { class: 'btn small wood', type: 'button', text: 'Saldo', onclick: () => openAdjust(t) }),
          el('button', { class: 'btn small red', type: 'button', text: 'Expulsar', onclick: () => kick(t) })
        )
      );
      body.appendChild(tr);
    }
    }

    // bitácora
    const lastLog = s.log.length ? s.log[s.log.length - 1] : null;
    const logSig = s.log.length + ':' + (lastLog ? lastLog.at + lastLog.text : '');
    if (logSig === lastLogSig) return;
    lastLogSig = logSig;
    const log = clear($('#log'));
    for (const item of s.log.slice().reverse()) {
      const d = new Date(item.at);
      const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
      log.appendChild(el('li', { class: item.type }, el('time', { text: hh }), item.text));
    }
  }

  // ---------- temporizador en cabecera ----------
  setInterval(() => {
    const s = state;
    let txt = '';
    if (s && s.phase === 'AUCTION' && s.auction) txt = '⏱ ' + M.secondsLeft(s.auction.endsAt) + ' s';
    if (s && s.phase === 'QUESTION' && s.question) txt = s.question.timeUp ? '⏱ Tiempo' : '⏱ ' + M.secondsLeft(s.question.endsAt) + ' s';
    setText('#hTimer', txt);
    $('#hTimer').hidden = !txt;
  }, 250);

  // ---------- secundarios ----------
  $('#btnJoin').addEventListener('click', async () => {
    const res = await send('toggleJoin', { allow: !state.joinOpenFlag });
    if (!res.ok && res.error) toast(res.error, 'bad');
  });
  $('#btnUndo').addEventListener('click', async () => {
    const res = await send('undoVerdict');
    if (!res.ok && res.error) toast(res.error, 'bad');
  });
  $('#btnReopen').addEventListener('click', () => send('reopenAuction'));

  const resetDialog = $('#resetDialog');
  $('#btnReset').addEventListener('click', () => {
    $('#resetInput').value = '';
    resetDialog.showModal();
  });
  $('#resetCancel').addEventListener('click', () => resetDialog.close());
  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#resetInput').value.trim().toUpperCase() !== 'REINICIAR') return toast('Escribe REINICIAR para confirmar.', 'bad');
    resetDialog.close();
    const res = await send('resetGame');
    if (res.ok) toast('Juego reiniciado.', 'good');
  });

  let adjustTeam = null;
  const adjustDialog = $('#adjustDialog');
  function openAdjust(t) {
    adjustTeam = t;
    setText('#adjName', t.name);
    setText('#adjBalance', money(t.balance));
    $('#adjDelta').value = '';
    adjustDialog.showModal();
  }
  $('#adjCancel').addEventListener('click', () => adjustDialog.close());
  $('#adjustForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('#adjDelta').value.replace(/[.\s$]/g, '');
    const delta = parseInt(raw, 10);
    if (!Number.isInteger(delta) || delta === 0) return toast('Escribe un número, por ejemplo 100000 o -50000.', 'bad');
    adjustDialog.close();
    const res = await send('adjustBalance', { teamId: adjustTeam.id, delta });
    if (res.ok) toast(`Saldo de ${adjustTeam.name} ajustado.`, 'good');
    else if (res.error) toast(res.error, 'bad');
  });

  async function kick(t) {
    if (!window.confirm(`¿Expulsar al equipo "${t.name}"?`)) return;
    const res = await send('kickTeam', { teamId: t.id });
    if (res.ok) toast(`${t.name} salió de la sala.`, 'good');
  }

  // ---------- atajos de teclado ----------
  document.addEventListener('keydown', (e) => {
    if (!authed || !state) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    const act = actions.find((a) => a.key === k);
    if (act) {
      e.preventDefault();
      runAction(act);
    }
  });
})();
