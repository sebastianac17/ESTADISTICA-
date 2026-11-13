/* Pantalla del jugador */
(function () {
  'use strict';
  const { el, $, setText, clear, money, toast, vibrate, Sound } = window.Mercagan;
  const M = window.Mercagan;
  const TOKEN_KEY = 'mercagan.token';

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  let state = null;
  let teamId = null;
  let lastAnimKey = null;
  let wasLeading = false;
  let lastLeaderKey = null;
  let sending = false;
  let out = false;

  const views = ['join', 'wait', 'intro', 'auction', 'answer', 'sold', 'annulled', 'finished', 'out'];
  function show(name) {
    for (const v of views) $('#view-' + v).hidden = v !== name;
  }

  function saveToken(t) {
    token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  // ---------- conexión ----------
  const socket = M.connect((s) => {
    if (token && !out) {
      s.emit('resume', { token }, (res) => {
        if (res && res.ok) {
          teamId = res.teamId;
        } else {
          saveToken(null);
          teamId = null;
          show('join');
        }
      });
    } else if (!teamId && !out) {
      show('join');
    }
  });

  socket.on('state', (s) => {
    state = s;
    render();
  });
  socket.on('bid:accepted', () => {
    vibrate(30);
  });
  socket.on('bid:rejected', (p) => {
    toast((p && p.reason) || 'Oferta rechazada', 'bad');
  });
  socket.on('bid:outbid', (p) => {
    vibrate([80, 60, 80]);
    toast(`${p.teamName} ofreció ${money(p.amount)}`, 'bad', 1600);
  });
  socket.on('kicked', () => {
    out = true;
    saveToken(null);
    teamId = null;
    setText('#outTitle', 'Quedaste por fuera');
    setText('#outMsg', 'Los presentadores sacaron a tu equipo de la sala. Si fue un error, vuelve a entrar.');
    $('#meChip').hidden = true;
    show('out');
  });
  socket.on('session:replaced', () => {
    out = true;
    teamId = null;
    setText('#outTitle', 'Tu equipo se abrió en otro lado');
    setText('#outMsg', 'La última pestaña que se conecta es la que juega. Si quieres jugar desde aquí, toca el botón.');
    show('out');
  });
  $('#outBtn').addEventListener('click', () => {
    out = false;
    if (token) socket.emit('resume', { token }, (res) => {
      if (res && res.ok) teamId = res.teamId;
      else {
        saveToken(null);
        show('join');
      }
    });
    else show('join');
  });

  // ---------- entrada ----------
  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Sound.unlock();
    const name = $('#teamName').value.trim();
    setText('#joinError', '');
    if (name.length < 2) return setText('#joinError', 'El nombre debe tener al menos 2 caracteres.');
    if (name.length > 24) return setText('#joinError', 'Máximo 24 caracteres.');
    const btn = $('#joinBtn');
    btn.disabled = true;
    socket.timeout(6000).emit('join', { teamName: name }, (err, res) => {
      btn.disabled = false;
      if (err) return setText('#joinError', 'No hubo respuesta del servidor. Revisa tu conexión al WiFi.');
      if (!res || !res.ok) return setText('#joinError', (res && res.error) || 'No se pudo entrar.');
      saveToken(res.token);
      teamId = res.teamId;
    });
  });

  // ---------- ofertas ----------
  function sendBid(payload) {
    if (sending) return;
    Sound.unlock();
    sending = true;
    setTimeout(() => (sending = false), 350); // anti doble-toque
    socket.timeout(5000).emit('bid', payload, (err) => {
      if (err) toast('La oferta no llegó. Revisa tu conexión.', 'bad');
    });
  }

  function buildQuickBids() {
    const box = $('#quickBids');
    if (box.childElementCount === state.quickBids.length) return;
    clear(box);
    for (const inc of state.quickBids) {
      const b = el('button', { class: 'btn', type: 'button', 'data-inc': inc }, '+' + money(inc), el('small', { text: '' }));
      b.addEventListener('click', () => sendBid({ increment: inc }));
      box.appendChild(b);
    }
  }

  $('#customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#customAmount').value.replace(/[^0-9]/g, '');
    const amount = parseInt(raw, 10);
    if (!amount) return toast('Escribe un monto.', 'bad');
    const step = state ? state.customBidStep : 10000;
    if (amount % step !== 0) return toast(`El monto debe ser múltiplo de ${money(step)}.`, 'bad');
    sendBid({ amount });
    $('#customAmount').value = '';
  });
  $('#customAmount').addEventListener('input', (e) => {
    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
    e.target.value = digits ? money(digits).slice(1) : '';
  });

  // ---------- render ----------
  function lotText(s) {
    return `Lote ${s.round} de ${s.rounds}`;
  }

  function render() {
    const s = state;
    if (!s || out) return;
    const me = s.me;
    if (!me) {
      if (!teamId) show('join');
      return;
    }
    teamId = me.id;
    $('#meChip').hidden = false;
    setText('#meName', `#${me.paddle} · ${me.name}`);
    setText('#meBalance', money(me.balance));

    switch (s.phase) {
      case 'LOBBY':
        renderWait(s, me);
        break;
      case 'ROUND_INTRO':
      case 'NO_BIDS':
        renderIntro(s);
        break;
      case 'AUCTION':
        renderAuction(s, me);
        break;
      case 'AUCTION_CLOSED':
      case 'QUESTION':
        renderAnswer(s, me);
        break;
      case 'SOLD':
        renderSold(s, me);
        break;
      case 'ANNULLED':
        renderAnnulled(s, me);
        break;
      case 'FINISHED':
        renderFinished(s, me);
        break;
    }
    if (s.phase !== 'SOLD' && s.phase !== 'ANNULLED') lastAnimKey = null;
  }

  function renderWait(s, me) {
    const p = $('#waitPaddle');
    if (p.dataset.n !== String(me.paddle)) {
      p.innerHTML = M.paddleSVG(me.paddle); // SVG propio; el número se sanea en paddleSVG
      p.dataset.n = String(me.paddle);
    }
    setText('#waitName', me.name);
    setText('#waitBalance', money(me.balance));
    setText('#waitTeams', s.teamCount);
    show('wait');
  }

  function renderIntro(s) {
    wasLeading = false;
    lastLeaderKey = null;
    $('#aucStatus').hidden = true;
    $('#aucStatus').className = 'status';
    setText('#introLot', lotText(s));
    $('#introAttempt').hidden = s.attempt <= 1;
    setText('#introAttempt', `Intento ${s.attempt}`);
    setText('#introPrize', s.prize.name);
    setText('#introBase', money(s.basePrice));
    setText('#introMsg', s.phase === 'NO_BIDS' ? 'Nadie ofertó. Ya mismo se reabre: ¡alisten la paleta!' : 'Prepárate: la subasta abre en un momento.');
    show('intro');
  }

  function renderAuction(s, me) {
    buildQuickBids();
    setText('#aucLot', lotText(s));
    setText('#aucPrize', s.prize.name + (s.attempt > 1 ? ` · Intento ${s.attempt}` : ''));
    const a = s.auction;
    const hi = a.highest;
    const leading = !!hi && hi.teamId === me.id;
    const leaderKey = hi ? hi.teamId + ':' + hi.amount : '';
    if (leaderKey !== lastLeaderKey) {
      const card = $('.current');
      card.classList.remove('bump');
      void card.offsetWidth;
      card.classList.add('bump');
      lastLeaderKey = leaderKey;
    }
    setText('#aucAmount', hi ? money(hi.amount) : '—');
    setText('#aucCurrentLabel', hi ? 'Oferta actual' : `Precio base ${money(s.basePrice)}`);
    setText('#aucLeader', hi ? (leading ? 'La tienes tú' : `Va ganando: ${hi.teamName}`) : 'Nadie ha ofertado todavía');

    const status = $('#aucStatus');
    if (leading) {
      status.hidden = false;
      status.className = 'status win';
      setText(status, 'Vas ganando');
    } else if (wasLeading && hi) {
      status.hidden = false;
      status.className = 'status lost';
      setText(status, 'Te superaron');
    } else if (!hi || !wasLeading) {
      if (!status.classList.contains('lost')) status.hidden = true;
    }
    wasLeading = leading;

    const open = M.msLeft(a.endsAt) > 0;
    const current = hi ? hi.amount : 0;
    for (const b of $('#quickBids').children) {
      const inc = Number(b.dataset.inc);
      const amount = Math.max(s.basePrice, current + inc);
      const affordable = amount <= me.balance;
      b.disabled = !open || leading || !affordable;
      setText(b.querySelector('small'), leading ? 'Vas ganando' : affordable ? '→ ' + money(amount) : 'Sin saldo');
    }
    $('#customBtn').disabled = !open || leading;
    $('#customAmount').disabled = !open || leading;
    $('#customAmount').placeholder = `Mínimo ${money(a.minNext)}`;
    setText('#aucHint', a.minNext > me.balance && !leading ? 'Tu saldo no alcanza para la oferta mínima. Guarda la plata para el próximo lote.' : `Múltiplos de ${money(s.customBidStep)} · Tu saldo: ${money(me.balance)}`);
    show('auction');
  }

  function renderAnswer(s, me) {
    setText('#ansLot', lotText(s));
    const hi = s.auction && s.auction.highest;
    const q = s.question;
    const winnerId = q ? q.teamId : hi && hi.teamId;
    const iWon = winnerId === me.id;
    $('#ansWinner').hidden = !iWon;
    $('#ansOther').hidden = iWon;
    if (iWon) {
      setText('#ansQuestion', q && q.text ? q.text : 'Atentos: los presentadores van a mostrar la pregunta.');
      setText('#ansAmount', money(q ? q.amount : hi.amount));
      $('#ansTimer').hidden = !q;
    } else {
      const name = q ? q.teamName : hi ? hi.teamName : '';
      setText('#ansOtherTitle', q ? `El equipo ${name} está respondiendo` : `Adjudicado a ${name}…`);
      setText('#ansOtherSub', q ? 'Si falla, se repite la subasta y todos vuelven a ofertar.' : `por ${money(hi ? hi.amount : 0)}, si responde bien.`);
      $('#ansOtherTimer').hidden = !q;
    }
    show('answer');
  }

  function renderSold(s, me) {
    const sale = s.lastSale;
    const key = 'sold:' + s.round + ':' + s.attempt;
    const mine = sale && sale.teamId === me.id;
    if (lastAnimKey !== key) {
      lastAnimKey = key;
      const stage = clear($('#soldStage'));
      const view = $('#view-sold');
      view.classList.remove('play');
      if (mine) {
        M.playGavel(stage, 'hit');
        void view.offsetWidth;
        view.classList.add('play');
        Sound.gavel(0.7);
        Sound.fanfare(1.1);
        setTimeout(() => {
          vibrate([120, 60, 200]);
          M.confetti(90);
        }, 750);
      }
      $('.stamp-holder').hidden = !mine;
    }
    if (mine) {
      setText('#soldLine1', `¡Es suyo: ${sale.prize}!`);
      setText('#soldLine2', `Pagaron ${money(sale.amount)}. Nuevo saldo: ${money(me.balance)}.`);
    } else if (sale) {
      setText('#soldLine1', `¡Vendido! ${sale.prize}`);
      setText('#soldLine2', `Se lo llevó ${sale.teamName} por ${money(sale.amount)}. Tu saldo sigue en ${money(me.balance)}.`);
    }
    show('sold');
  }

  function renderAnnulled(s, me) {
    const key = 'annul:' + s.round + ':' + s.attempt;
    const mine = !!s.question && s.question.teamId === me.id;
    if (lastAnimKey !== key) {
      lastAnimKey = key;
      const stage = clear($('#annulStage'));
      if (mine) {
        M.playGavel(stage, 'miss');
        Sound.sad();
        vibrate([200]);
      }
    }
    setText('#annulMsg', mine ? 'No se dio esta vez. No se les descontó nada y pueden volver a ofertar.' : `${s.annulledTeam || 'El equipo'} no acertó. Nadie pierde plata: se repite la subasta del mismo lote.`);
    show('annulled');
  }

  function renderFinished(s, me) {
    setText('#finPrizes', me.prizes.length);
    setText('#finSpent', money(me.spent));
    setText('#finBalance', money(me.balance));
    const sales = clear($('#finSales'));
    for (const x of s.sales || []) {
      sales.appendChild(el('li', null, el('b', { text: 'L' + x.round }), el('span', { class: 'grow', text: `${x.prize} → ${x.teamName}` }), el('span', { class: 'money', text: money(x.amount) })));
    }
    const rank = clear($('#finRanking'));
    (s.ranking || []).forEach((r, i) => {
      rank.appendChild(el('li', { class: r.name === me.name ? 'me' : '' }, el('b', { text: i + 1 + '.' }), el('span', { class: 'grow', text: r.name }), el('span', { text: `${r.prizes} 🏆 · ${money(r.balance)}` })));
    });
    if (lastAnimKey !== 'fin') {
      lastAnimKey = 'fin';
      M.confetti(80);
    }
    show('finished');
  }

  // ---------- temporizadores (cada 200 ms) ----------
  let lastTick = null;
  setInterval(() => {
    const s = state;
    if (!s) return;
    if (s.phase === 'AUCTION' && s.auction) {
      const sec = M.secondsLeft(s.auction.endsAt);
      const t = $('#aucTimer');
      setText(t, sec);
      t.classList.toggle('urgent', sec <= 10 && sec > 0);
      if (sec <= 10 && sec > 0 && lastTick !== sec) {
        lastTick = sec;
        vibrate(15);
      }
      if (sec === 0) {
        for (const b of $('#quickBids').children) b.disabled = true;
        $('#customBtn').disabled = true;
      }
    }
    if (s.phase === 'QUESTION' && s.question) {
      const sec = M.secondsLeft(s.question.endsAt);
      const txt = s.question.timeUp || sec === 0 ? '¡Se acabó el tiempo!' : String(sec);
      for (const id of ['#ansTimer', '#ansOtherTimer']) {
        const t = $(id);
        setText(t, txt);
        t.classList.toggle('urgent', sec <= 10);
        t.style.fontSize = sec === 0 ? '26px' : '';
      }
    }
  }, 200);
})();
