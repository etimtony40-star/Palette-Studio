/* ==========================================================
   Palette Studio · script.js
   Sections: config · state · color utils · harmony engine ·
             rendering · clipboard · favorites storage · events
   ========================================================== */
(() => {
  'use strict';

  /* ---------- 1. Config ---------- */
  const SIZE = 5;                                  // swatches per palette
  const STORAGE_KEY = 'palette-studio:favorites:v1';
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  const LOAD_MS = 1900;                            // load page duration
  const THEMES = ['midnight', 'ocean', 'ember', 'forest', 'daylight'];
  const THEME_KEY = 'palette-studio:theme:v1';
  const FS_SUPPORTED = 'showDirectoryPicker' in window; // File System Access API (Chromium browsers)

  /* ---------- 2. State engine ---------- */
  const state = {
    colors: Array(SIZE).fill('#222222'),           // current hex per swatch
    locked: Array(SIZE).fill(false),               // lock flag per swatch
    favorites: []                                  // [{ id, colors[], savedAt }]
  };

  /* ---------- 3. DOM references ---------- */
  const $ = (sel) => document.querySelector(sel);
  const paletteEl = $('#palette');
  const swatchEls = [...paletteEl.querySelectorAll('.swatch')];
  const panel = $('#favorites-panel');
  const overlay = $('#overlay');
  const favList = $('#fav-list');
  const favEmpty = $('#fav-empty');
  const favCount = $('#fav-count');
  const openBtn = $('#open-favorites-btn');
  const toastEl = $('#toast');
  const saveBtn = $('#save-btn');
  const loader = $('#loader');
  const themeBtns = [...document.querySelectorAll('.theme-dot')];

  /* ---------- 4. Color utilities ---------- */
  const rand = (min, max) => Math.random() * (max - min) + min;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const wrapHue = (h) => ((h % 360) + 360) % 360;

  /** HSL (h: 0-360, s/l: 0-100) -> "#rrggbb" */
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  /** "#rrggbb" -> { h, s, l } (used to harmonize with locked colors) */
  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    const l = (max + min) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return { h: wrapHue(h * 60), s: s * 100, l: l * 100 };
  }

  /** Choose black or white text for best contrast (WCAG relative luminance) */
  function inkFor(hex) {
    const lin = (i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
    return lum > 0.4 ? '#12141f' : '#ffffff';
  }

  /* ---------- 5. Harmony engine ---------- */
  // Hue offsets (degrees from the base hue) for classic color-wheel schemes.
  // Five offsets each, one per swatch.
  const SCHEMES = {
    analogous:     [-30, -15, 0, 15, 30],
    complementary: [0, 15, 180, 195, -15],
    triadic:       [0, 120, 240, 15, 135],
    splitComp:     [0, 150, 210, 20, 170],
    monochrome:    [0, 6, -6, 12, -12]
  };

  /** Fisher–Yates shuffle (returns a new array) */
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Build 5 harmonized hex colors. If a swatch is locked, its hue anchors the scheme. */
  function buildHarmony() {
    const anchor = state.locked.indexOf(true);
    const baseHue = anchor > -1 ? hexToHsl(state.colors[anchor]).h : rand(0, 360);
    const offsets = shuffle(pick(Object.values(SCHEMES)));
    // Spread lightness across the palette so it has dark, mid and light tones
    const lightness = shuffle([24, 40, 56, 71, 86]);

    return offsets.map((offset, i) => {
      const h = wrapHue(baseHue + offset + rand(-6, 6));
      const l = lightness[i] + rand(-4, 4);
      // Very light/dark tones get softer saturation to avoid harsh neon or mud
      const s = (l > 80 || l < 30) ? rand(35, 60) : rand(50, 82);
      return hslToHex(h, s, l);
    });
  }

  /** Generate: locked swatches keep their value, unlocked swatches take the new one */
  function generate() {
    const fresh = buildHarmony();
    state.colors = state.colors.map((c, i) => (state.locked[i] ? c : fresh[i]));
    render();
  }

  /* ---------- 6. Rendering ---------- */
  function render() {
    swatchEls.forEach((el, i) => {
      const hex = state.colors[i];
      el.style.setProperty('--swatch', hex);
      el.style.setProperty('--ink', inkFor(hex));
      el.classList.toggle('is-locked', state.locked[i]);
      el.querySelector('.swatch__hex').textContent = hex.toUpperCase();

      const lockBtn = el.querySelector('[data-action="lock"]');
      lockBtn.setAttribute('aria-pressed', String(state.locked[i]));
      lockBtn.setAttribute('aria-label', `${state.locked[i] ? 'Unlock' : 'Lock'} color ${i + 1}`);
      lockBtn.querySelector('use').setAttribute('href', state.locked[i] ? '#i-lock' : '#i-unlock');
    });

    // Feed the live palette to CSS so the ambient background and button follow it
    [0, 1, 2, 3, 4].forEach((i) => document.documentElement.style.setProperty(`--c${i}`, state.colors[i]));
    syncSaveButton();
  }

  /* ---------- 7. Toast micro-interaction ---------- */
  let toastTimer;
  function toast(message, color) {
    toastEl.innerHTML = '';
    if (color) {
      const dot = document.createElement('span');
      dot.className = 'toast__dot';
      dot.style.background = color;
      toastEl.append(dot);
    }
    toastEl.append(document.createTextNode(message));
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
  }

  /* ---------- 8. Clipboard handler ---------- */
  async function copyHex(hex) {
    const text = hex.toUpperCase();
    try {
      await navigator.clipboard.writeText(text);           // modern, secure contexts
    } catch (err) {
      // Fallback for http:// or older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) { console.error('Clipboard failed:', err); return toast('Copy failed. Select the code manually.'); }
    }
    toast(`Copied ${text}`, hex);
  }

  /* ---------- 9. Favorites + localStorage ---------- */
  function loadFavorites() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // Validate every entry so corrupted storage can never break the UI
      state.favorites = Array.isArray(parsed)
        ? parsed.filter((f) => f && Array.isArray(f.colors) && f.colors.length === SIZE && f.colors.every((c) => HEX_RE.test(c)))
        : [];
    } catch (err) {
      console.warn('Could not read favorites:', err);
      state.favorites = [];
    }
  }

  function persistFavorites() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
    } catch (err) {
      console.error('Could not save favorites:', err);
      toast('Storage is full or blocked. Favorites will not persist.');
    }
  }

  /* --- File saving: a chosen folder (File System Access API) with a plain download fallback --- */
  const DB_NAME = 'palette-studio';
  const DB_STORE = 'handles';
  let dirHandle = null;

  /** Tiny IndexedDB helper so the chosen folder is remembered between visits */
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  /** Returns a writable folder handle, or null. The picker only opens when allowPicker is true. */
  async function getFolder(allowPicker) {
    if (!FS_SUPPORTED) return null;
    try {
      if (!dirHandle) dirHandle = await idb('readonly', (s) => s.get('folder'));
      if (dirHandle) {
        const opts = { mode: 'readwrite' };
        if ((await dirHandle.queryPermission(opts)) === 'granted') return dirHandle;
        if (allowPicker && (await dirHandle.requestPermission(opts)) === 'granted') return dirHandle;
      }
      if (!allowPicker) return null;
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'palette-studio' });
      await idb('readwrite', (s) => s.put(dirHandle, 'folder'));
      return dirHandle;
    } catch (err) {
      console.warn('Folder access unavailable:', err);   // cancelled picker, blocked context, etc.
      dirHandle = null;
      return null;
    }
  }

  /** Build a small SVG image of the palette (opens in any browser or image viewer) */
  function paletteSvg(colors) {
    const w = 160, h = 240;
    const cells = colors.map((c, i) =>
      `<rect x="${i * w}" width="${w}" height="${h}" fill="${c}"/>` +
      `<text x="${i * w + w / 2}" y="${h - 22}" text-anchor="middle" font-family="monospace" font-size="16" fill="${inkFor(c)}">${c.toUpperCase()}</text>`
    ).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * colors.length}" height="${h}" viewBox="0 0 ${w * colors.length} ${h}">${cells}</svg>`;
  }

  /** Writes the file to the chosen folder; falls back to a normal browser download */
  async function writeFile(name, svg) {
    const dir = await getFolder(true);
    if (dir) {
      const handle = await dir.getFileHandle(name, { create: true });
      const out = await handle.createWritable();
      await out.write(svg);
      await out.close();
      return 'folder';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return 'download';
  }

  /** Deletes a previously saved file. Only possible inside the folder the user granted access to. */
  async function deleteFile(name) {
    try {
      const dir = await getFolder(false);
      if (!dir) return false;
      await dir.removeEntry(name);
      return true;
    } catch (err) {
      return err.name === 'NotFoundError';       // already gone counts as deleted
    }
  }

  const keyOf = (colors) => colors.join('');
  const findSaved = () => state.favorites.find((f) => keyOf(f.colors) === keyOf(state.colors));

  /** Reflect whether the current palette is saved on the heart button */
  function syncSaveButton() {
    const saved = Boolean(findSaved());
    saveBtn.setAttribute('aria-pressed', String(saved));
    $('#save-label').textContent = saved ? 'Saved' : 'Save palette';
  }

  let saving = false;                            // blocks double clicks while a file operation runs
  async function toggleSave() {
    if (saving) return;
    saving = true;
    try {
      const existing = findSaved();
      if (existing) return await removeFavorite(existing);

      const file = `palette-${state.colors.map((c) => c.slice(1)).join('-')}.svg`;
      const stored = await writeFile(file, paletteSvg(state.colors));
      state.favorites.unshift({ id: Date.now().toString(36), colors: [...state.colors], savedAt: Date.now(), file, stored });
      persistFavorites();
      renderFavorites();
      syncSaveButton();
      toast(stored === 'folder' ? `Saved ${file}` : 'Downloaded to your Downloads folder', state.colors[0]);
    } catch (err) {
      console.error('Save failed:', err);
      toast('Could not save the file');
    } finally {
      saving = false;
    }
  }

  /** Unsave: drop from favorites and delete the file when the browser allows it */
  async function removeFavorite(fav) {
    state.favorites = state.favorites.filter((f) => f.id !== fav.id);
    persistFavorites();
    renderFavorites();
    syncSaveButton();
    if (fav.stored === 'folder' && (await deleteFile(fav.file))) return toast('Unsaved and deleted from your folder');
    if (fav.stored === 'folder') return toast('Unsaved. Reconnect the folder to delete the file');
    toast('Unsaved. Browsers cannot delete files from Downloads, so remove it there');
  }

  function renderFavorites() {
    favCount.textContent = state.favorites.length;
    favEmpty.hidden = state.favorites.length > 0;
    favList.innerHTML = '';

    state.favorites.forEach((fav) => {
      const li = document.createElement('li');
      li.className = 'fav';
      li.dataset.id = fav.id;

      // Clickable strip of the five colors: loads the palette
      const strip = document.createElement('button');
      strip.type = 'button';
      strip.className = 'fav__strip';
      strip.dataset.action = 'load';
      strip.setAttribute('aria-label', `Load palette ${fav.colors.join(', ')}`);
      fav.colors.forEach((c) => {
        const s = document.createElement('span');
        s.style.background = c;
        strip.append(s);
      });

      const row = document.createElement('div');
      row.className = 'fav__row';
      const date = document.createElement('span');
      date.textContent = new Date(fav.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const del = document.createElement('button');
      del.type = 'button';
      del.dataset.action = 'delete';
      del.textContent = 'Remove';
      row.append(date, del);

      li.append(strip, row);
      favList.append(li);
    });
  }

  /* ---------- 10. Sidebar open/close ---------- */
  function setSidebar(open) {
    panel.classList.toggle('is-open', open);
    panel.inert = !open;                       // keeps hidden controls out of tab order
    overlay.hidden = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('button').focus(); else openBtn.focus();
  }

  /* ---------- 11. Event wiring ---------- */
  $('#generate-btn').addEventListener('click', generate);
  saveBtn.addEventListener('click', toggleSave);
  openBtn.addEventListener('click', () => setSidebar(true));
  $('#close-favorites-btn').addEventListener('click', () => setSidebar(false));
  overlay.addEventListener('click', () => setSidebar(false));

  // One delegated listener for all swatches: lock button, copy button, hex label, or the card itself
  paletteEl.addEventListener('click', (e) => {
    const card = e.target.closest('.swatch');
    if (!card) return;
    const i = Number(card.dataset.index);
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (action === 'lock') {
      state.locked[i] = !state.locked[i];
      render();
      toast(state.locked[i] ? `Locked ${state.colors[i].toUpperCase()}` : 'Unlocked', state.colors[i]);
    } else {
      copyHex(state.colors[i]);                // copy button, hex label, or card body
    }
  });

  // Favorites list: load or remove (delegated)
  favList.addEventListener('click', (e) => {
    const item = e.target.closest('.fav');
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!item || !action) return;
    const fav = state.favorites.find((f) => f.id === item.dataset.id);
    if (!fav) return;

    if (action === 'load') {
      state.colors = [...fav.colors];
      state.locked.fill(false);                // a loaded palette replaces all locks
      render();
      setSidebar(false);
      toast('Palette loaded', fav.colors[0]);
    } else if (action === 'delete') {
      removeFavorite(fav);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('is-open')) setSidebar(false);
    // Space generates only when no control has focus (otherwise Space would double-fire a button)
    if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); generate(); }
  });

  /* ---------- 12. Boot ---------- */
  /* ---------- 12. Theme switcher ---------- */
  function applyTheme(name) {
    if (!THEMES.includes(name)) name = THEMES[0];
    document.documentElement.dataset.theme = name;
    document.querySelector('meta[name="color-scheme"]').content = name === 'daylight' ? 'light' : 'dark';
    themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === name)));
    try { localStorage.setItem(THEME_KEY, name); } catch (err) { console.warn('Theme not persisted:', err); }
  }
  $('#themes').addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-dot');
    if (btn) applyTheme(btn.dataset.theme);
  });

  /* ---------- 13. Boot ---------- */
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (err) { /* storage blocked */ }
  applyTheme(savedTheme);
  loadFavorites();        // read saved palettes from localStorage immediately
  renderFavorites();
  generate();             // first palette (also colors the loader)

  // Hold the load page for LOAD_MS, then fade it out and remove it
  setTimeout(() => {
    loader.classList.add('is-done');
    document.body.classList.remove('is-loading');
    loader.addEventListener('transitionend', () => loader.remove(), { once: true });
  }, LOAD_MS);
})();