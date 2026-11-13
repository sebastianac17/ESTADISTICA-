/* Utilidades compartidas: socket, reloj, dinero, sonidos, martillo, confeti. */
(function () {
  'use strict';
  const M = (window.Mercagan = {});

  // ---------- DOM ----------
  /** Crea un elemento. Los textos SIEMPRE se insertan con textContent. */
  M.el = function (tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  };
  M.$ = (sel, root) => (root || document).querySelector(sel);
  M.setText = (sel, text) => {
    const n = typeof sel === 'string' ? M.$(sel) : sel;
    if (n && n.textContent !== String(text)) n.textContent = String(text);
  };
  M.clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  // ---------- dinero ----------
  M.money = (n) => '$' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ---------- reloj del servidor ----------
  let offset = 0; // serverTime - clientTime
  let bestRtt = Infinity;
  M.serverNow = () => Date.now() + offset;
  M.secondsLeft = (endsAt) => Math.max(0, Math.ceil((endsAt - M.serverNow()) / 1000));
  M.msLeft = (endsAt) => Math.max(0, endsAt - M.serverNow());

  function measureClock(socket) {
    let n = 0;
    const once = () => {
      const t0 = Date.now();
      socket.timeout(4000).emit('clock', {}, (err, res) => {
        if (!err && res && res.serverTime) {
          const t1 = Date.now();
          const rtt = t1 - t0;
          if (rtt < bestRtt || n === 0) {
            bestRtt = rtt;
            offset = res.serverTime + rtt / 2 - t1;
          }
        }
        if (++n < 5) setTimeout(once, 150);
      });
    };
    bestRtt = Infinity;
    once();
  }

  // ---------- socket con banner de reconexión ----------
  M.connect = function (onConnect) {
    const socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    let banner = null;
    let everConnected = false;
    const showBanner = () => {
      if (banner || !everConnected) return;
      banner = M.el('div', { class: 'reconnect', text: 'Reconectando…' });
      document.body.appendChild(banner);
    };
    const hideBanner = () => {
      if (banner) banner.remove();
      banner = null;
    };
    socket.on('connect', () => {
      everConnected = true;
      hideBanner();
      measureClock(socket);
      onConnect && onConnect(socket);
    });
    socket.on('disconnect', showBanner);
    socket.on('connect_error', showBanner);
    socket.on('clock', (p) => {
      if (p && p.serverTime && bestRtt === Infinity) offset = p.serverTime - Date.now();
    });
    socket.on('toast', (p) => p && p.text && M.toast(p.text, 'bad'));
    setInterval(() => socket.connected && measureClock(socket), 60000);
    return socket;
  };

  // ---------- toasts ----------
  M.toast = function (text, kind, ms) {
    let box = M.$('.toasts');
    if (!box) {
      box = M.el('div', { class: 'toasts' });
      document.body.appendChild(box);
    }
    const t = M.el('div', { class: 'toast ' + (kind || ''), text });
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), ms || 2600);
  };

  M.vibrate = (p) => {
    try {
      navigator.vibrate && navigator.vibrate(p);
    } catch (e) {}
  };

  // ---------- sonidos sintetizados (Web Audio) ----------
  const Sound = (M.Sound = {
    ctx: null,
    muted: false,
    unlock() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      } catch (e) {
        return false;
      }
    },
    get ready() {
      return !!this.ctx && this.ctx.state === 'running' && !this.muted;
    },
    tone(freq, dur, opts = {}) {
      if (!this.ready) return;
      const c = this.ctx;
      const t = c.currentTime + (opts.delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = opts.type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(opts.vol || 0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    noise(dur, opts = {}) {
      if (!this.ready) return;
      const c = this.ctx;
      const t = c.currentTime + (opts.delay || 0);
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.cutoff || 1200;
      const g = c.createGain();
      g.gain.value = opts.vol || 0.8;
      src.connect(f).connect(g).connect(c.destination);
      src.start(t);
    },
    gavel(delay = 0) {
      this.noise(0.18, { delay, cutoff: 900, vol: 1.2 });
      this.tone(140, 0.25, { delay, type: 'triangle', slide: 60, vol: 0.6 });
      this.tone(420, 0.08, { delay, type: 'square', vol: 0.12 });
    },
    tick(high) {
      this.tone(high ? 1500 : 1100, 0.05, { type: 'square', vol: 0.09 });
    },
    bell() {
      this.tone(1318, 0.5, { vol: 0.18 });
      this.tone(1976, 0.35, { vol: 0.08, delay: 0.02 });
    },
    fanfare(delay = 0) {
      const notes = [523, 659, 784, 1047, 784, 1047];
      const times = [0, 0.13, 0.26, 0.42, 0.62, 0.74];
      notes.forEach((n, i) => {
        this.tone(n, i === notes.length - 1 ? 0.7 : 0.18, { delay: delay + times[i], type: 'sawtooth', vol: 0.12 });
        this.tone(n / 2, i === notes.length - 1 ? 0.7 : 0.18, { delay: delay + times[i], type: 'triangle', vol: 0.15 });
      });
    },
    sad() {
      this.tone(392, 0.3, { type: 'triangle', vol: 0.2 });
      this.tone(330, 0.3, { type: 'triangle', vol: 0.2, delay: 0.3 });
      this.tone(262, 0.7, { type: 'triangle', vol: 0.2, delay: 0.6, slide: 220 });
    },
  });

  // ---------- martillo (SVG estático, sin datos de usuario) ----------
  M.gavelSVG = function () {
    return `
<svg viewBox="0 0 520 300" aria-hidden="true">
  <defs>
    <linearGradient id="gw" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#8a5f36"/><stop offset=".5" stop-color="#624427"/><stop offset="1" stop-color="#3D3120"/>
    </linearGradient>
    <linearGradient id="gh" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#4a331d"/><stop offset=".5" stop-color="#7a5431"/><stop offset="1" stop-color="#4a331d"/>
    </linearGradient>
  </defs>
  <!-- bloque de madera -->
  <ellipse cx="160" cy="292" rx="140" ry="8" fill="rgba(0,0,0,.35)"/>
  <rect x="50" y="248" width="220" height="42" rx="10" fill="url(#gw)" stroke="#2a2016" stroke-width="4"/>
  <rect x="62" y="254" width="196" height="8" rx="4" fill="rgba(255,255,255,.15)"/>
  <!-- impacto -->
  <g class="impact" stroke="#FDDF54" stroke-width="7" stroke-linecap="round">
    <line x1="160" y1="226" x2="160" y2="196"/><line x1="122" y1="232" x2="98" y2="212"/><line x1="198" y1="232" x2="222" y2="212"/>
    <line x1="104" y1="244" x2="74" y2="238"/><line x1="216" y1="244" x2="246" y2="238"/>
  </g>
  <!-- brazo del martillo: pivota en el mango (420,198) -->
  <g class="gavel-arm">
    <rect x="196" y="188" width="270" height="20" rx="10" fill="url(#gh)" stroke="#2a2016" stroke-width="4"/>
    <rect x="448" y="185" width="30" height="26" rx="8" fill="#FDDF54" stroke="#2a2016" stroke-width="4"/>
    <rect x="120" y="152" width="80" height="92" rx="10" fill="url(#gw)" stroke="#2a2016" stroke-width="5"/>
    <rect x="110" y="142" width="100" height="18" rx="7" fill="#FDDF54" stroke="#2a2016" stroke-width="4"/>
    <rect x="110" y="232" width="100" height="16" rx="7" fill="#FDDF54" stroke="#2a2016" stroke-width="4"/>
    <rect x="132" y="164" width="10" height="64" rx="5" fill="rgba(255,255,255,.18)"/>
  </g>
</svg>`;
  };

  /** Monta la escena del martillo en `container`. kind = 'hit' | 'miss'. Devuelve el nodo. */
  M.playGavel = function (container, kind) {
    const scene = M.el('div', { class: 'sold-scene' });
    const wrap = M.el('div', { class: 'gavel-wrap' });
    wrap.innerHTML = M.gavelSVG(); // markup estático propio
    scene.appendChild(wrap);
    container.appendChild(scene);
    requestAnimationFrame(() => {
      scene.classList.add('play');
      if (kind === 'miss') scene.classList.add('miss');
    });
    return scene;
  };

  // ---------- confeti con colores de marca ----------
  M.confetti = function (count) {
    const colors = ['#FDDF54', '#F8E46D', '#D1301F', '#647544', '#FFF8E1', '#624427'];
    const layer = M.el('div', { class: 'confetti-layer' });
    const n = count || 140;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(1) + 'vw');
      c.style.setProperty('--rot', Math.floor(Math.random() * 1440 - 720) + 'deg');
      c.style.animationDuration = (2.4 + Math.random() * 2.4).toFixed(2) + 's';
      c.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's';
      if (Math.random() < 0.3) {
        c.style.width = '8px';
        c.style.height = '8px';
        c.style.borderRadius = '50%';
      }
      layer.appendChild(c);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 6500);
  };

  // ---------- paleta de puja numerada (SVG propio) ----------
  M.paddleSVG = function (num) {
    const n = String(num).replace(/[^0-9]/g, '').slice(0, 3) || '1';
    return `
<svg viewBox="0 0 120 180" aria-hidden="true">
  <rect x="52" y="104" width="16" height="70" rx="6" fill="#624427" stroke="#2a2016" stroke-width="4"/>
  <rect x="55" y="110" width="4" height="58" rx="2" fill="rgba(255,255,255,.2)"/>
  <ellipse cx="60" cy="58" rx="52" ry="54" fill="#FDDF54" stroke="#2a2016" stroke-width="5"/>
  <ellipse cx="60" cy="58" rx="40" ry="42" fill="#FFF8E1" stroke="#D1301F" stroke-width="3"/>
  <text x="60" y="74" text-anchor="middle" font-family="Alfa Slab One, Georgia, serif" font-size="${n.length > 2 ? 34 : 44}" fill="#3D3120">${n}</text>
</svg>`;
  };
})();
