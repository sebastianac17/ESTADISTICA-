'use strict';
/** Persists the game state to data/state.json (atomic write: tmp file + rename). */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.timer = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return null;
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[store] No se pudo leer el respaldo, se arranca de cero:', err.message);
      return null;
    }
  }

  saveNow(state) {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] Error guardando el respaldo:', err.message);
    }
  }

  /** Debounced save for high-frequency changes (bids). */
  saveSoon(getState, ms = 400) {
    if (this.timer) return;
    this.timer = setTimeout(() => this.saveNow(getState()), ms);
  }

  clear() {
    try {
      fs.unlinkSync(this.file);
    } catch {}
  }
}

module.exports = { Store };
