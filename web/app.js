(() => {
  const L = window.BourseLib, U = window.Universes;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const app = window.bourseApp || null;
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };

  // The site is served by the same Worker as its data; the phone app isn't.
  const SITE = 'https://bourse.matisseduffield.workers.dev';
  const API = location.hostname === 'appassets.androidplatform.net' ? `${SITE}/api/` : '/api/';
  // A request hanging on poor mobile data gives up, so the app can say it's offline.
  // Older WebViews lack AbortSignal.timeout.
  function deadline(ms) {
    if (AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  }
  async function api(path) {
    const res = await fetch(API + path, { signal: deadline(10000) });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  // ---- saved state ----
  const FIRST_LIST = ['^AXJO', '^GSPC', '^IXIC', '^DJI', 'AAPL', 'NVDA', 'BHP.AX', 'CBA.AX', 'BTC-USD'];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('bourse.' + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('bourse.' + k, JSON.stringify(v)); } catch {} },
  };
  const saved = store.get('state') || {};
  // A damaged save falls back to the first list rather than a blank app.
  function goodLists(lists) {
    const good = (Array.isArray(lists) ? lists : [])
      .filter(l => l && typeof l.name === 'string' && Array.isArray(l.symbols))
      .map(l => ({ name: l.name, symbols: l.symbols.filter(x => typeof x === 'string') }));
    return good.length ? good : [{ name: 'My Symbols', symbols: FIRST_LIST }];
  }
  const state = {
    tab: saved.tab === 'map' ? 'map' : 'list',
    lists: goodLists(saved.lists),
    at: Number.isInteger(saved.at) ? saved.at : 0,
    metric: ['change', 'pct', 'cap'].includes(saved.metric) ? saved.metric : 'pct',
    sort: ['manual', 'name', 'pct', 'change', 'cap'].includes(saved.sort) ? saved.sort : 'manual',
    market: ['sp500', 'asx', 'ndx', 'dow', 'world', 'crypto', 'mine'].includes(saved.market) ? saved.market : 'sp500',
    period: ['day', 'week', 'month', 'year'].includes(saved.period) ? saved.period : 'day',
    size: ['cap', 'volume', 'equal'].includes(saved.size) ? saved.size : 'cap',
  };
  if (!state.lists[state.at]) state.at = 0;
  const save = () => store.set('state', state);
  const list = () => state.lists[state.at];
  const following = symbol => list().symbols.includes(symbol);
  function setSymbols(symbols) { list().symbols = symbols; save(); }

  const quotes = store.get('quotes') || {};   // the last prices seen, so a slow start isn't empty
  const sparks = store.get('sparks') || {};
  const live = new Set();   // symbols whose quote came from the network this time, not the save
  const gone = new Set();   // symbols a good answer left out: delisted or renamed, so their save is all there is
  // Each list has its own saved map. The one save every list used to share is no longer read.
  try { localStorage.removeItem('bourse.map.mine'); } catch {}
  const mapKey = market => (market === 'mine' ? `map.mine.${state.at}` : 'map.' + market);
  // A part whose last refresh failed shows old prices: the header says so, and a
  // stock says when its price is from instead of whether its market is open.
  // Each part has its own, so one failing can't make another look fresh or old.
  const stale = { list: false, map: false, stock: false };
  function setStale(part, on) {
    if (stale[part] === on) return;
    stale[part] = on;
    if (part !== 'stock') renderMeta();
    else if (open) renderHeadline(quotes[open]);
  }
  const current = (q, part) => !!q && !stale[part] && live.has(q.symbol);
  // A share's times are its exchange's. A coin or a currency trades round the clock and has no
  // exchange, so its times are this device's. Before its quote has come, its symbol says which it is.
  const allHours = (symbol, type) => (type ? type === 'CRYPTOCURRENCY' || type === 'CURRENCY' : /=X$|-USD$/.test(symbol || ''));
  const zoneOf = (symbol, type, tz) => (allHours(symbol, type) || tz === 'UTC' ? undefined : tz);
  // A date or time where a price traded, so the header and a stock agree.
  function inZone(q, opts) {
    const say = timeZone => new Intl.DateTimeFormat('en-AU', { timeZone, ...opts }).format(q.time * 1000);
    try { return say(zoneOf(q.symbol, q.type, q.tz)); } catch { return say(undefined); }
  }
  // A currency pair under 10 is read to four decimals, in every number about it.
  const fine = q => q?.type === 'CURRENCY' && Math.abs(q.price) < 10;
  const priceOf = (n, q) => L.price(n, undefined, fine(q));
  let editing = false;

  // ---- the list ----
  const SORTS = { manual: 'My order', name: 'Name', pct: '% change', change: 'Price change', cap: 'Market cap' };
  // What the pill on each row shows, and what a tap on it shows next.
  const METRICS = { pct: '% change', change: 'price change', cap: 'market cap' };
  const NEXT_METRIC = { pct: 'change', change: 'cap', cap: 'pct' };
  const INDEXES = { '^AXJO': 'ASX 200', '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^FTSE': 'FTSE 100', '^N225': 'Nikkei 225' };
  const shortName = s => INDEXES[s] || s.replace(/\.AX$/, '').replace(/-USD$/, '');

  function metricText(q) {
    if (!q) return '–';
    if (state.metric === 'cap') return L.big(q.cap);
    return state.metric === 'pct' ? L.percent(q.pct) : L.change(q.change, q.price, fine(q));
  }

  // Yahoo's previous close doesn't always match its own change, and the change is
  // what the headline shows, so the line has to start from there. (A coin's change is over the
  // last 24 hours, which is the day the Worker sends for its chart and its small line.)
  const prevClose = (q, fallback) => (q?.price != null && q?.change != null ? q.price - q.change : fallback);

  // The page's files are each cached on their own, so for a few minutes after a release this one can
  // be running beside a lib.js, a page or a stylesheet from the release before. It asks for nothing
  // new without looking first: with an older lib.js a chart is drawn in one colour, as it used to be.
  const has = (...names) => names.every(name => typeof L[name] === 'function');
  const SPLIT = has('seated', 'areaOf', 'splitAt', 'lying');
  // A colour of the theme in use, for parts whose colour an older stylesheet doesn't give.
  const theme = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // A line that is green above its base and red below, with the space between tinted the same way
  // and fading towards the base. Each is one path under one paint, whose two colours meet at the
  // base: so the colour changes exactly there, with nothing to line up and no join to show.
  // A stretch that lies along the base (for twice the line's width or more) would be half of each:
  // it is cut out and drawn in one colour, that of the side it leaves the base to. `wide` is the
  // line's width, and `deep` the tint's strength furthest from the base.
  let paints = 0;
  function splitParts(points, baseY, height, wide, deep) {
    const n = ++paints, ys = points.map(p => p[1]);
    const at = L.splitAt(baseY, Math.min(...ys), Math.max(...ys), height);
    // The stylesheet colours the stops, and follows the theme; these are for a stylesheet that doesn't.
    const colours = { up: theme('--pos'), down: theme('--neg') };
    const paint = (id, stops) => {
      const g = svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: height });
      g.append(...stops.map(([way, offset, opacity = 1]) => svg('stop', { class: way, offset, 'stop-opacity': opacity, ...(colours[way] ? { 'stop-color': colours[way] } : {}) })));
      return g;
    };
    const defs = svg('defs');
    defs.append(
      paint(`line${n}`, [['up', at.at], ['down', at.at]]),
      paint(`tint${n}`, [['up', at.top, deep], ['up', at.at, deep / 8], ['down', at.at, deep / 8], ['down', at.bottom, deep]]),
    );
    const cut = L.lying(points, baseY, wide / 2 + .25, wide * 2);
    // As styles, or the sheet's own fill and stroke would win over them.
    return {
      defs,
      tint: svg('path', { class: 'tint', style: `fill:url(#tint${n})`, d: L.areaOf(points, baseY) }),
      lines: [
        svg('path', { class: 'plot', style: `stroke:url(#line${n})`, d: cut.rest.map(L.pathOf).join('') }),
        ...cut.runs.map(run => svg('path', { class: `plot run ${run.way || 'flat'}`, d: L.pathOf(run.points) })),
      ],
    };
  }

  function sparkOf(symbol, q) {
    const box = svg('svg', { class: 'spark', viewBox: '0 0 76 34', 'aria-hidden': 'true' });
    const s = sparks[symbol];
    if (!s?.close || s.close.length < 2) return box;
    const prev = prevClose(q, s.prev);
    const drawn = L.line(s.close, 76, 34, prev, 3, L.across(s.times, s.session));
    // With no close to measure from, the line is all the colour of the day's move. So is every line beside an older lib.js.
    if (prev == null || !SPLIT) {
      if (prev != null) box.append(svg('path', { class: 'base', d: `M0 ${drawn.y(prev).toFixed(1)}H76` }));
      box.append(svg('path', { class: L.direction(q?.change), d: L.pathOf(drawn.points) }));
      return box;
    }
    const l = L.seated(drawn, prev), base = svg('path', { class: 'base', d: `M0 ${l.baseY}H76` });
    // A line that never leaves its base has no side to take a colour from.
    if (s.close.every(v => v === prev)) { box.append(base, svg('path', { class: 'flat', d: L.pathOf(l.points) })); return box; }
    const parts = splitParts(l.points, l.baseY, 34, 1.5, .3);
    box.append(parts.defs, parts.tint, base, ...parts.lines);
    return box;
  }

  const GRIP = '<svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1 1h16M1 6h16M1 11h16"/></svg>';
  const MINUS = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 6h8"/></svg>';
  // An index has no company name worth repeating, so it says where it's from.
  const PLACES = { '^AXJO': 'Australia', '^GSPC': 'United States', '^IXIC': 'United States', '^DJI': 'United States', '^FTSE': 'United Kingdom', '^N225': 'Japan' };
  const subtitle = (symbol, q) => PLACES[symbol] || q?.name || ' ';

  // A <select> from {value: text}, with one chosen.
  function fillPick(pick, options, chosen) {
    pick.replaceChildren(...Object.entries(options).map(([value, text]) => { const o = el('option', '', text); o.value = value; return o; }));
    pick.value = chosen;
  }

  // The lists, then making and renaming them, all in the phone's own picker.
  function renderLists() {
    $('listName').textContent = list().name;
    fillPick($('listPick'), { ...state.lists.map(l => l.name), new: 'New list…', rename: 'Rename…' }, String(state.at));
  }

  function renderList() {
    renderLists();
    $('sortName').replaceChildren(el('span', 'pre', 'Sort: '), SORTS[state.sort]);
    fillPick($('sortPick'), SORTS, state.sort);
    $('sortWrap').hidden = editing;
    $('editBtn').textContent = editing ? 'Done' : 'Edit';
    const order = editing ? list().symbols : L.sorted(list().symbols, quotes, state.sort, shortName);
    if (!order.length) return $('rows').replaceChildren(el('p', 'empty', 'Nothing here yet. Search for a stock to follow it.'));
    // Rows are kept and updated in place by symbol, so a refresh neither takes
    // focus from a row nor has a screen reader read it again.
    const mode = editing ? 'edit' : 'view';
    const had = new Map([...$('rows').children].filter(r => r.dataset.mode === mode).map(r => [r.dataset.symbol, r]));
    const rows = order.map(symbol => {
      const row = had.get(symbol) || newRow(symbol);
      had.delete(symbol);
      if (!editing) fillRow(row, symbol);
      return row;
    });
    const was = [...$('rows').children];
    if (rows.length === was.length && rows.every((r, i) => r === was[i])) return;
    // Moving a row drops its focus, which goes straight back.
    const focused = $('rows').contains(document.activeElement) ? document.activeElement : null;
    $('rows').replaceChildren(...rows);
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  function newRow(symbol) {
    const row = el('div', editing ? 'row editing' : 'row');
    row.dataset.symbol = symbol;
    row.dataset.mode = editing ? 'edit' : 'view';
    const who = el('div', 'who');
    who.append(el('b', '', shortName(symbol)), el('small', '', subtitle(symbol, quotes[symbol])));
    if (editing) {
      const drop = el('button', 'drop');
      drop.type = 'button';
      drop.dataset.drop = symbol;
      drop.setAttribute('aria-label', `Remove ${symbol}`);
      drop.innerHTML = MINUS;
      const grip = el('button', 'grip');
      grip.type = 'button';
      grip.setAttribute('aria-label', `Move ${symbol}. Use the up and down arrow keys.`);
      grip.innerHTML = GRIP;
      row.append(drop, who, grip);
      return row;
    }
    const open = el('button', 'open');
    open.type = 'button';
    open.dataset.open = symbol;
    const pill = el('button', 'pill');
    pill.type = 'button';
    pill.dataset.metric = '1';
    const nums = el('div', 'nums');
    nums.append(el('p'), pill);
    row.append(open, who, sparkOf(symbol, quotes[symbol]), nums);
    return row;
  }

  // A row's numbers, written only where they changed.
  function fillRow(row, symbol) {
    const q = quotes[symbol];
    const [open, who, spark, nums] = row.children, pill = nums.lastChild;
    const put = (e, text) => { if (e.textContent !== text) e.textContent = text; };
    const name = (e, text) => { if (e.getAttribute('aria-label') !== text) e.setAttribute('aria-label', text); };
    // A price nobody answers for any more says when it's from, not how it moved.
    const old = q?.time && gone.has(symbol) && !stale.list ? inZone(q, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    name(open, `${shortName(symbol)}, ${priceOf(q?.price, q)}, ${old ? `last price ${old}` : L.percent(q?.pct)}`);
    put(who.lastChild, subtitle(symbol, q));
    row.replaceChild(sparkOf(symbol, q), spark);
    put(nums.firstChild, priceOf(q?.price, q));
    put(pill, old || metricText(q));
    pill.className = 'pill ' + (old || state.metric === 'cap' ? '' : L.direction(q?.change));
    name(pill, old ? `Last price ${old}` : `${metricText(q)}. Showing ${METRICS[state.metric]}. Switch to ${METRICS[NEXT_METRIC[state.metric]]}`);
  }

  // Coins never close, so beside shares they'd make every hour read Open: the shares say.
  const traded = all => { const shares = all.filter(q => q.type !== 'CRYPTOCURRENCY'); return (shares.length ? shares : all).map(q => q.state); };
  // Whether a market is open is said only from fresh numbers: a save from
  // Friday's session would still say Open on Monday morning. The Map tab speaks
  // for the map, the List tab for the list.
  function renderMeta() {
    const onMap = state.tab === 'map';
    let parts;
    if (stale[onMap ? 'map' : 'list']) {
      const shown = onMap ? tiles : list().symbols.map(s => quotes[s]).filter(Boolean);
      const newest = shown.reduce((a, t) => (t.time > (a?.time || 0) ? t : a), null);
      parts = ['Offline', newest && inZone(newest, { day: 'numeric', month: 'short' })];
    } else if (onMap && tiles.length) {
      const { up, down } = L.breadth(tiles, moveOf);
      // The world's markets are never all open or all closed, so that map doesn't say.
      parts = [`${up} up`, `${down} down`, fresh && state.market !== 'world' ? L.marketOf(traded(tiles)) : ''];
    } else {
      const shown = list().symbols.map(s => quotes[s]).filter(q => current(q, 'list'));
      parts = [new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long' }).format(new Date()), L.marketOf(traded(shown))];
    }
    // Each part stays whole, and a dot that would start a line is hidden (style.css).
    $('meta').replaceChildren(...parts.filter(Boolean).map((p, i) => {
      const s = el('span');
      if (i) { const dot = el('i', '', '·'); dot.setAttribute('aria-hidden', 'true'); s.append(dot); }
      s.append(p);
      return s;
    }));
  }

  // One batch failing loses only its own symbols, which come back as `missed`.
  // Only all of them failing is an error.
  // Quotes that aren't a list are no answer at all.
  const listed = a => { if (!Array.isArray(a)) throw new Error('quotes'); return a; };
  async function chunks(symbols, size, fetchPart) {
    const parts = [];
    for (let i = 0; i < symbols.length; i += size) parts.push(symbols.slice(i, i + size));
    const done = await Promise.allSettled(parts.map(fetchPart));
    const got = [], missed = new Set();
    done.forEach((d, i) => { if (d.status === 'fulfilled') got.push(d.value); else for (const s of parts[i]) missed.add(s); });
    if (parts.length && !got.length) throw done[0].reason;
    return { got, missed };
  }

  // When each part last asked for prices, and how many asks are still out.
  const last = { list: 0, map: 0, stock: 0 };
  const busy = { list: 0, map: 0, stock: 0 };
  async function refreshList() {
    last.list = Date.now();
    const symbols = list().symbols;
    if (!symbols.length) return renderList();
    busy.list++;
    try {
      // The Worker answers for 100 symbols at a time.
      const ask = (route, good = x => x) => chunks(symbols, 100, part => api(`${route}?symbols=` + encodeURIComponent(part.join(','))).then(good));
      const [parts, lines] = await Promise.all([ask('quotes', listed), ask('sparks').catch(() => ({ got: [] }))]);
      const fresh = parts.got.flat();
      // An answer with nobody in it is a refresh that failed, not a list of the delisted: the header
      // says Offline and the prices held aren't passed off as new. Unless every price held is weeks
      // old, which is what a list of only delisted stocks looks like, and they're marked as ever.
      if (!fresh.length && symbols.some(s => quotes[s]?.time > Date.now() / 1000 - 14 * 86400)) throw new Error('quotes');
      for (const q of fresh) { quotes[q.symbol] = q; live.add(q.symbol); gone.delete(q.symbol); }
      for (const s of L.absent(symbols, fresh.map(q => q.symbol), parts.missed)) { live.delete(s); gone.add(s); }
      Object.assign(sparks, ...lines.got);
      const all = new Set(state.lists.flatMap(l => l.symbols));
      store.set('quotes', Object.fromEntries([...all].filter(x => quotes[x]).map(x => [x, quotes[x]])));
      store.set('sparks', Object.fromEntries([...all].filter(x => sparks[x]).map(x => [x, sparks[x]])));
      setStale('list', false);
      renderMeta();
      if (state.tab === 'list' && !editing) renderList();
    } catch { setStale('list', true); }
    finally { busy.list--; }
  }

  $('rows').addEventListener('click', e => {
    if (e.target.closest('[data-metric]')) {
      state.metric = NEXT_METRIC[state.metric];
      save();
      renderList();
      $('listSay').textContent = `Showing ${METRICS[state.metric]}`;
      return;
    }
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      const at = [...$('rows').children].indexOf(drop.closest('.row'));
      setSymbols(list().symbols.filter(x => x !== drop.dataset.drop));
      renderList();
      // Focus goes to the row that took its place, or Done once the list is empty.
      const rows = $('rows').children;
      (rows[Math.min(at, rows.length - 1)]?.querySelector('.drop') || $('editBtn')).focus({ preventScroll: true });
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openStock(open.dataset.open);
  });

  // Rows move by the grip, or by the arrow keys on it.
  let lifted = null;
  $('rows').addEventListener('pointerdown', e => {
    const grip = e.target.closest('.grip');
    if (!grip) return;
    const row = grip.closest('.row');
    const all = [...$('rows').children];
    grip.setPointerCapture(e.pointerId);
    row.classList.add('lifted');
    const box = $('rows').parentElement;
    lifted = { id: e.pointerId, row, all, from: all.indexOf(row), to: all.indexOf(row), y: e.clientY, at: e.clientY, moved: false, h: row.getBoundingClientRect().height, box, top: box.scrollTop, now: performance.now(), frame: requestAnimationFrame(edge) };
  });
  $('rows').addEventListener('pointermove', e => {
    if (!lifted || e.pointerId !== lifted.id) return;
    lifted.at = e.clientY;
    if (Math.abs(e.clientY - lifted.y) > 8) lifted.moved = true;
    carry();
  });
  // A row held near the top or bottom of a long list scrolls it, faster the nearer the edge.
  // By the clock, not the frame: ten rows a second at most, whatever the screen's refresh rate.
  // Not until the finger has moved, or a still press on a grip near an edge would move its row.
  function edge(now) {
    if (!lifted) return;
    const { box, at } = lifted, b = box.getBoundingClientRect(), was = box.scrollTop;
    const past = Math.min(40, Math.max(0, b.top + 40 - at)) - Math.min(40, Math.max(0, at - b.bottom + 40));
    if (past && lifted.moved) box.scrollTop -= past * Math.min(50, now - lifted.now) * .015;
    lifted.now = now;
    if (box.scrollTop !== was) carry();
    lifted.frame = requestAnimationFrame(edge);
  }
  // The row follows the finger, counting how far the list has scrolled under it, and stops at the
  // list's first and last places: past them it would make room for itself to scroll into.
  function carry() {
    const { row, all, from, h, box } = lifted;
    const dy = Math.max(-from * h, Math.min((all.length - 1 - from) * h, lifted.at - lifted.y + box.scrollTop - lifted.top));
    row.style.transform = `translateY(${dy}px)`;
    const to = Math.max(0, Math.min(all.length - 1, from + Math.round(dy / h)));
    lifted.to = to;
    all.forEach((r, i) => {
      if (r === row) return;
      const shift = i > from && i <= to ? -h : i < from && i >= to ? h : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }
  function dropRow(e) {
    if (!lifted || e.pointerId !== lifted.id) return;
    const { from, to, all } = lifted;
    cancelAnimationFrame(lifted.frame);
    lifted = null;
    // Rows moved by hand are made afresh, rather than eased back from where the finger left them.
    for (const r of all) delete r.dataset.mode;
    if (e.type === 'pointerup' && to !== from) { setSymbols(L.moved(list().symbols, from, to)); state.sort = 'manual'; save(); }
    renderList();
  }
  $('rows').addEventListener('pointerup', dropRow);
  $('rows').addEventListener('pointercancel', dropRow);
  $('rows').addEventListener('keydown', e => {
    const grip = e.target.closest('.grip');
    const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!grip || !step) return;
    e.preventDefault();
    const symbol = grip.closest('.row').dataset.symbol, from = list().symbols.indexOf(symbol);
    const to = Math.max(0, Math.min(list().symbols.length - 1, from + step));
    setSymbols(L.moved(list().symbols, from, to));
    state.sort = 'manual';
    save();
    renderList();
    $('rows').children[to].querySelector('.grip').focus();
  });

  // On a desktop, arrow keys step a closed picker through its options. Stepping
  // onto New or Rename mustn't open the dialog, so those count only when picked.
  let stepped = false;
  $('listPick').addEventListener('keydown', e => {
    stepped = /^(Arrow|Page|Home|End)/.test(e.key);
    setTimeout(() => { stepped = false; });
  });
  $('listPick').addEventListener('change', () => {
    const v = $('listPick').value;
    // New and Rename open the dialog; the picker goes back to the list on screen.
    if (v === 'new' || v === 'rename') { renderLists(); return stepped ? undefined : askList(v === 'rename' ? state.at : null); }
    state.at = Number(v);
    editing = false;
    otherList();
    save();
    renderList();
    $('rows').parentElement.scrollTop = 0;
    refreshList();
  });

  // One dialog names a new list or renames this one, and holds its Delete.
  let asking = null, sure = false;
  function askList(at) {
    asking = at;
    sure = false;
    $('nameTitle').textContent = at == null ? 'New list' : 'Rename list';
    $('nameSave').textContent = at == null ? 'Create' : 'Save';
    $('nameBox').value = at == null ? '' : state.lists[at].name;
    // The only list stays, so the app always has one.
    $('nameDelete').hidden = at == null || state.lists.length < 2;
    $('nameDelete').textContent = 'Delete list';
    $('nameNote').hidden = true;
    show('nameList');
  }
  $('nameBox').addEventListener('input', () => { $('nameNote').hidden = true; });
  $('nameForm').addEventListener('submit', e => {
    const name = $('nameBox').value.trim();
    // A blank name or one already taken keeps the dialog open.
    const taken = state.lists.some((l, i) => i !== asking && l.name.toLowerCase() === name.toLowerCase());
    if (!name || taken) {
      e.preventDefault();
      $('nameNote').hidden = !taken;
      $('nameBox').focus();
      return;
    }
    if (asking == null) {
      state.lists.push({ name, symbols: [] });
      state.at = state.lists.length - 1;
      editing = false;
      otherList();
    } else state.lists[asking].name = name;
    save();
    renderList();
    refreshList();
  });
  $('nameList').addEventListener('click', e => { if (e.target.closest('[data-cancel]')) $('nameList').close(); });
  // Two taps, so a stray one can't lose a list. No timer: the ask stands until the dialog closes.
  $('nameDelete').addEventListener('click', () => {
    if (!sure) { sure = true; $('nameDelete').textContent = `Tap again to delete ${state.lists[asking].name}`; return; }
    // The lists after it move up one, so their saved maps are no longer theirs.
    try { state.lists.forEach((l, i) => { if (i >= asking) localStorage.removeItem(`bourse.map.mine.${i}`); }); } catch {}
    state.lists.splice(asking, 1);
    state.at = 0;
    editing = false;
    otherList();
    save();
    $('nameList').close();
    renderList();
    $('rows').parentElement.scrollTop = 0;
    refreshList();
  });

  $('sortPick').addEventListener('change', () => {
    state.sort = $('sortPick').value;
    save();
    renderList();
  });
  $('editBtn').addEventListener('click', () => { editing = !editing; renderList(); });

  // ---- one stock ----
  const RANGES = ['1D', '1W', '1M', '6M', '1Y', '5Y', 'ALL'];
  let open = null;       // the symbol on screen
  let plot = null;       // the chart on screen: its points and scale
  let range = '1D';
  let rangeBase = null;  // the first price of a longer chart on screen: { symbol, range, base }
  // One finger on the chart reads a point; two compare the points under them.
  const fingers = new Map();
  const reading = () => (plot && fingers.size === 1 ? pointAt(fingers.values().next().value) : null);

  // Follow is the thing to do, so it's in ink; Following is only a state.
  function renderFollow() {
    $('followBtn').textContent = following(open) ? 'Following' : 'Follow';
    $('followBtn').classList.toggle('ink', !following(open));
  }

  // A figure whose digits each roll a short way when they change, up for a rise and down for a fall.
  // The figure is always the newest: a digit still on its way lands on whatever it has become, and
  // nothing waits its turn. A screen reader gets the figure whole, from a copy that isn't shown.
  // `lively` is off where a change isn't a move: another stock's page.
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const rolling = new WeakMap(), rolledTo = new WeakMap();
  function roll(box, text, value, lively) {
    if (!box.firstElementChild) {
      const digits = el('span', 'roll');
      digits.setAttribute('aria-hidden', 'true');
      box.replaceChildren(el('span', 'unseen'), digits);
    }
    const said = box.firstElementChild, digits = box.lastElementChild;
    const was = said.textContent;
    if (was === text) return;
    said.textContent = text;
    const fall = value < rolledTo.get(box);
    rolledTo.set(box, value);
    const chars = [...text], changed = has('rolled') ? L.rolled(was, text) : [];
    // Kept from the right, so the cents are the same cents when a figure gains a digit.
    while (digits.childElementCount > chars.length) digits.firstChild.remove();
    while (digits.childElementCount < chars.length) digits.prepend(el('span'));
    [...digits.children].forEach((d, i) => {
      if (d.textContent !== chars[i]) { d.textContent = chars[i]; d.className = chars[i] === ' ' ? 'gap' : ''; }
      if (!lively || !changed[i] || calm.matches || !d.animate || rolling.get(d)?.playState === 'running') return;
      rolling.set(d, d.animate([{ transform: `translateY(${fall ? '-' : ''}.34em)`, opacity: .25 }, { transform: 'none', opacity: 1 }], { duration: 120, easing: 'cubic-bezier(.2, .7, .2, 1)' }));
    });
  }

  // What the line under the price says: whether the market is open, and what trading outside its hours has done.
  function stateLine(q) {
    // A saved price that couldn't be refreshed says when it's from, not whether its market is open.
    if (q && !current(q, 'stock')) return q.time ? `Last price, ${inZone(q, { day: 'numeric', month: 'short' })} ${inZone(q, { hour: 'numeric', minute: '2-digit' })}` : '';
    // Between the evening's trading and the morning's (PREPRE), the evening's move still stands.
    const late = q?.state?.startsWith('POST') || (q?.state === 'PREPRE' && !q.pre);
    const extra = late ? q.post : q?.state?.startsWith('PRE') ? q.pre : null;
    const label = late ? 'After hours' : 'Pre-market';
    // Prices run behind while a market is open, and for that long after it shuts: until then the
    // last price shown (a minute's grace for its trip here) may not be the day's last.
    const slow = q?.delay && (q.state === 'REGULAR' || Date.now() / 1000 - q.time < (q.delay + 1) * 60);
    return extra?.price != null ? `${label}: ${priceOf(extra.price, q)} (${L.percent(extra.pct)})` : `${L.marketState(q?.state)}${slow ? `, delayed ${q.delay} min` : ''}`;
  }

  // The move beside the price is a figure and the name of its stretch. A page from the release
  // before has it as one bare line, so its two parts are made here.
  if (!$('stockMoveNum')) {
    const num = el('span'), span = el('span', 'move-span');
    num.id = 'stockMoveNum';
    span.id = 'stockSpan';
    $('stockMove').replaceChildren(num, span);
  }

  let headed = null;     // the symbol whose figures the headline holds
  function renderHeadline(q) {
    const put = (e, text) => { if (e.textContent !== text) e.textContent = text; };
    put($('stockCurrency'), q?.currency || '');
    // With one finger on the chart the headline reads the point under it: its price, its move from
    // the chart's base line, and when it was. Lifting the finger puts back the price now.
    const at = reading();
    // The figure follows the chart: the day's move on 1D, and on a longer
    // range the move from that chart's first price, named so it isn't mistaken for today's.
    const far = q && rangeBase && rangeBase.symbol === open && rangeBase.range === range ? L.moveOver(rangeBase.base, q.price) : null;
    // From a base of nothing (or less) there is no per cent to give, and the change stands alone.
    const m = at ? L.moveOver(plot.base, at.p[1]) || { change: at.p[1] - plot.base, pct: null } : far || (q ? { change: q.change, pct: q.pct } : null);
    const price = at ? at.p[1] : q?.price;
    const lively = headed === open;
    headed = open;
    roll($('stockPrice'), at || q ? priceOf(price, q) : '–', price, lively);
    roll($('stockMoveNum'), m ? `${L.change(m.change, price, fine(q))}${at && m.pct == null ? '' : ` (${L.percent(m.pct)})`}` : '', m?.change, lively);
    put($('stockSpan'), m && (at ? plot.range !== '1D' : far) ? L.spanName(at ? plot.range : range) : '');
    $('stockMove').className = 'big-move ' + L.direction(m?.change);
    const line = $('stockAfter');
    if (!at) return put(line, stateLine(q));
    // When the point was, on one line: said more briefly where the full date won't fit.
    for (const stamp of plot.stamps) {
      put(line, stamp.format(at.p[0] * 1000));
      if (line.scrollWidth <= line.clientWidth) break;
    }
  }

  function renderStats(q) {
    const bar = (label, low, high) => {
      const at = L.rangeAt(q?.price, low, high);
      if (at == null) return null;
      const row = el('div', 'band-row');
      const line = el('div', 'band-line');
      const mark = el('i');
      mark.style.left = at * 100 + '%';
      line.append(mark);
      const wrap = el('div');
      const ends = el('div', 'band-ends');
      ends.append(el('span', '', priceOf(low, q)), el('span', '', priceOf(high, q)));
      wrap.append(line, ends);
      row.append(el('span', '', label), wrap);
      return row;
    };
    // A coin's chart is its last 24 hours, and Yahoo's day for it runs from midnight in London: its
    // high, low and open are that day's, so they're left out beside a chart they wouldn't match.
    const coin = q?.type === 'CRYPTOCURRENCY';
    $('bands').replaceChildren(...[coin ? null : bar('Today', q?.low, q?.high), bar('52 weeks', q?.low52, q?.high52)].filter(Boolean));
    const fixed = n => (n == null || Number.isNaN(n) ? '–' : n.toFixed(2));
    const coming = q?.earnings && q.earnings * 1000 > Date.now();
    const day = coming ? L.dayIn(q.earnings, q.tz) : null;
    const pairs = [
      // A coin never closes: its day's move is measured from its price 24 hours ago.
      ...(coin ? [] : [['Open', priceOf(q?.open, q)]]), [coin ? '24h ago' : 'Prev close', priceOf(prevClose(q, q?.prev), q)],
      // A currency has no volume, and Yahoo says 0.
      ['Volume', L.big(q?.volume || null)], ['Avg volume', L.big(q?.avgVolume || null)], ['Market cap', L.big(q?.cap)], ['P/E', fixed(q?.pe)],
      ['EPS', fixed(q?.eps)], ['Yield', q?.yield == null || Number.isNaN(q.yield) ? '–' : `${q.yield.toFixed(2)}%`],
      ['Earnings', day ? `${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(day)}${q.earningsEstimate ? ' est.' : ''}` : '–'],
    ];
    // A figure Yahoo doesn't have, like an index's P/E or a currency's volume, is left out rather than shown as a dash.
    $('stats').replaceChildren(...pairs.filter(([, v]) => v !== '–').map(([k, v]) => { const s = el('div', 'stat'); s.append(el('span', '', k), el('b', '', v)); return s; }));
    const e = $('earnings');
    e.hidden = !(coming && app);
    if (coming && app) {
      const add = el('button', 'tool', 'Add earnings to calendar');
      add.type = 'button';
      add.addEventListener('click', () => toApp({ type: 'calendar', title: `${shortName(q.symbol)} earnings`, time: day.getTime() }));
      e.replaceChildren(add);
    }
  }

  // With nothing to show, one line says so rather than a page of dashes.
  // (A good answer with nothing in it is `none`: asking again won't help.)
  function renderMiss(missing, none) {
    if (missing) $('stockMiss').textContent = none ? 'No prices for this stock' : 'Can’t load this stock. Try again in a moment.';
    $('stockMiss').hidden = !missing;
    $('stockAll').hidden = missing;
  }

  // An open stock keeps its price and the day's line current, like the list,
  // though never while a finger is reading the chart.
  async function refreshStock(symbol) {
    last.stock = Date.now();
    let fresh;
    busy.stock++;
    try { [fresh] = await api('quotes?symbols=' + encodeURIComponent(symbol)); } catch { if (open === symbol) setStale('stock', true); return; }
    finally { busy.stock--; }
    if (!fresh || open !== symbol) return;
    const missed = !$('stockMiss').hidden;
    quotes[symbol] = fresh;
    live.add(symbol);
    setStale('stock', false);
    renderMiss(false);
    $('stockName').textContent = subtitle(symbol, fresh);
    renderHeadline(fresh);
    renderStats(fresh);
    if ((range === '1D' || missed) && !fingers.size) drawChart();
  }

  async function openStock(symbol) {
    open = symbol;
    range = '1D';
    plot = null;
    letAllGo();
    renderScrub();
    $('chart').querySelector('.chart-note')?.remove();
    const q = quotes[symbol];
    // A new page starts from what's known of this stock, not the last one's failure.
    stale.stock = false;
    $('stockSymbol').textContent = shortName(symbol);
    // The same second line as the list: an index's place, not its name again.
    $('stockName').textContent = subtitle(symbol, q);
    renderMiss(false);
    $('chartSvg').replaceChildren();
    $('about').hidden = true;
    $('newsBox').hidden = true;
    renderFollow();
    renderHeadline(q);
    renderStats(q);
    renderRanges();
    show('stock');
    $('stockAll').parentElement.scrollTop = 0;
    drawChart();
    last.stock = Date.now();
    try {
      const [fresh] = await api('quotes?symbols=' + encodeURIComponent(symbol));
      if (fresh && open === symbol) {
        quotes[symbol] = fresh;
        live.add(symbol);
        setStale('stock', false);
        $('stockName').textContent = subtitle(symbol, fresh);
        renderHeadline(fresh);
        renderStats(fresh);
        // A stock not seen before has no change yet, and the day's line starts from it.
        if (!q && range === '1D') drawChart();
      } else if (open === symbol && !quotes[symbol]) renderMiss(true, true);
    } catch {
      if (open === symbol) setStale('stock', true);
      if (open === symbol && !quotes[symbol]) renderMiss(true);
    }
    try {
      const info = await api('stock?symbol=' + encodeURIComponent(symbol));
      if (open !== symbol) return;
      const a = $('about');
      a.hidden = !info.summary;
      a.textContent = info.summary || '';
      a.classList.remove('open');
      $('newsBox').hidden = !info.news?.length;
      $('news').replaceChildren(...(info.news || []).map(n => {
        const link = el('a');
        link.href = /^https:/i.test(n.url || '') ? n.url : '#';
        link.target = '_blank';
        link.rel = 'noopener';
        const when = Number.isFinite(n.time) ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(n.time * 1000) : '';
        link.append(el('b', '', n.title || ''), el('small', '', [n.source, when].filter(Boolean).join(' · ')));
        return link;
      }));
    } catch {}
  }
  $('about').addEventListener('click', () => $('about').classList.toggle('open'));

  function renderRanges() {
    $('ranges').replaceChildren(...RANGES.map(r => {
      const b = el('button', '', r);
      b.type = 'button';
      b.dataset.range = r;
      b.setAttribute('aria-pressed', String(r === range));
      return b;
    }));
  }
  $('ranges').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    renderRanges();
    renderHeadline(quotes[open]);
    drawChart();
  });

  // Dates are the exchange's own, or Friday's close reads as Saturday in Sydney (plot.tz, from zoneOf).
  const when = t => new Intl.DateTimeFormat('en-AU', {
    timeZone: plot.tz,
    ...(plot.range === '1D' || plot.range === '1W' ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }),
  }).format(t * 1000);

  const charts = new Map();     // what's been fetched, so going back to a range is instant
  async function chartData(symbol, wanted) {
    const key = `${symbol} ${wanted}`, hit = charts.get(key);
    if (hit && Date.now() - hit.at < (wanted === '1D' ? 60e3 : 600e3)) return hit.data;
    const data = await api(`chart?symbol=${encodeURIComponent(symbol)}&range=${wanted}`);
    charts.set(key, { data, at: Date.now() });
    return data;
  }

  async function drawChart() {
    const symbol = open, wanted = range;
    const box = $('chart');
    box.classList.add('waiting');
    let data;
    try { data = await chartData(symbol, wanted); } catch { data = null; }
    if (open !== symbol || range !== wanted) return;
    box.classList.remove('waiting');
    box.querySelector('.chart-note')?.remove();
    const size = box.getBoundingClientRect();
    const W = size.width, H = size.height, bottom = H - 18;
    const s = $('chartSvg');
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!data || !(data.points?.length >= 2)) {
      plot = null;
      rangeBase = null;
      renderHeadline(quotes[symbol]);
      s.replaceChildren();
      box.append(el('p', 'chart-note', data ? 'No prices for this range' : 'Can’t load the chart'));
      return;
    }
    const values = data.points.map(p => p[1]);
    const hi = Math.max(...values), lo = Math.min(...values);
    const q = quotes[symbol];
    // The dashed line is what the move beside the price is measured from: the close before on a
    // day, and on a longer range its own first price. A week is measured from where the map
    // measures it, which the Worker sends with the chart, so the two agree. (An older Worker
    // doesn't, and the week starts from its first price.)
    const known = { prev: prevClose(q, data.prev), weekBase: data.weekBase, first: values[0] };
    const base = has('baseOf') ? L.baseOf(wanted, known) : (wanted === '1D' ? known.prev : wanted === '1W' ? known.weekBase : null) ?? known.first;
    rangeBase = wanted === '1D' ? null : { symbol, range: wanted, base };
    // Room for the high and low beside the line, however many digits they have.
    const right = W - Math.max(46, Math.max(priceOf(hi, q).length, priceOf(lo, q).length) * 5.6 + 10);
    // The base's value is on a tag at the left end of its line, in room of its own, so the line
    // never runs under it. A chart too narrow for both keeps the line. (The tag's look is the
    // stylesheet's: what's set here is for a stylesheet from before there was a tag.)
    const tagText = svg('text', { class: 'tag-text', 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 500, fill: theme('--ink') });
    let wide = 0, left = 0;
    if (has('tag', 'tagRoom')) {
      tagText.textContent = L.tag(base, fine(q));
      s.replaceChildren(tagText);
      wide = Math.ceil((tagText.getComputedTextLength?.() || tagText.textContent.length * 6.2) + 12);
      left = L.tagRoom(wide, right);
    }
    // A day still trading fills only its share of the width.
    const at = wanted === '1D' ? L.across(data.points.map(p => p[0]), data.session) : null;
    const plain = L.line(values, right - left, bottom, base, 16, at);
    const l = SPLIT ? L.seated(plain, base) : plain, baseY = SPLIT ? l.baseY : +l.y(base).toFixed(1);
    const parts = [];
    // The line and what moves with it, clear of the tag.
    const drawn = svg('g', { transform: `translate(${left} 0)` });
    const marks = svg('g');
    const dashes = svg('path', { class: 'base', d: `M${left ? wide : 0} ${baseY}H${right}` });
    // A line that never leaves its base has no side to take a colour from. Beside an older lib.js
    // the whole line takes the colour of its move, which on a longer range runs to the price now.
    if (hi === lo && hi === base) drawn.append(svg('path', { class: 'plot flat', d: L.pathOf(l.points) }));
    else if (!SPLIT) drawn.append(svg('path', { class: `plot ${L.direction((wanted !== '1D' && q?.price != null ? q.price : values[values.length - 1]) - base)}`, d: L.pathOf(l.points) }));
    else {
      const split = splitParts(l.points, baseY, H, 1.8, .2);
      drawn.append(split.defs, split.tint, ...split.lines);
    }
    drawn.append(marks);
    parts.push(dashes, drawn);
    if (left) {
      tagText.setAttribute('x', wide / 2);
      tagText.setAttribute('y', baseY + 4);
      const tag = svg('g', { class: 'tag' });
      tag.append(svg('rect', { x: 0, y: baseY - 9, width: wide, height: 18, rx: 9, fill: theme('--bg') }), tagText);
      parts.push(tag);
    }
    const label = (text, x, y, anchor) => {
      const t = svg('text', { class: 'scale', x, y, 'text-anchor': anchor });
      t.textContent = text;
      parts.push(t);
    };
    for (const v of [hi, lo]) label(priceOf(v, q), W, l.y(v) + 4, 'end');
    // A coin's or a currency's hours are read on this device's clock. Its days are Yahoo's own.
    const hours = wanted === '1D' || wanted === '1W';
    const tz = hours ? zoneOf(symbol, q?.type, data.tz) : data.tz;
    const [from, to] = at ? data.session : [data.points[0][0], data.points[data.points.length - 1][0]];
    // A day that runs past midnight on the clock it's read by (a coin's last 24 hours, a currency's
    // day seen from Australia) would start and end at the same time, so each end names its day.
    const dateOf = new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: 'numeric' });
    const overnight = wanted === '1D' && dateOf.format(from * 1000) !== dateOf.format(to * 1000);
    // With little room between the two, the day and the hour are enough.
    const tight = overnight && right - left < 160;
    const axis = new Intl.DateTimeFormat('en-AU', { timeZone: tz, ...(wanted === '1D' ? { ...(overnight ? { weekday: 'short' } : {}), hour: 'numeric', ...(tight ? {} : { minute: '2-digit' }) } : wanted === '1W' ? { weekday: 'short', day: 'numeric' } : ['1M', '6M', '1Y'].includes(wanted) ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' }) });
    label(axis.format(from * 1000), left, H - 3, 'start');
    label(axis.format(to * 1000), right, H - 3, 'end');
    s.replaceChildren(...parts);
    // When a point was, for the headline: its day, and on a day's or a week's chart its time too.
    // Each way of saying it is shorter than the one before, for a narrow screen with big text.
    const time = { hour: 'numeric', minute: '2-digit' }, day = { day: 'numeric', month: 'short' };
    const stamps = (hours ? [{ weekday: 'short', ...day, ...time }, { ...day, ...time }, wanted === '1D' ? time : { weekday: 'short', ...time }] : [{ ...day, year: 'numeric' }, { day: 'numeric', month: 'numeric', year: '2-digit' }])
      .map(how => new Intl.DateTimeFormat('en-AU', { timeZone: tz, ...how }));
    plot = { points: data.points, l, marks, left, right, bottom, tz, range: wanted, base, stamps };
    // The headline last, as it reads the chart's base. A finger already down is on this chart now.
    if (fingers.size) renderScrub();
    else renderHeadline(quotes[symbol]);
  }

  function pointAt(clientX) {
    // The nearest point to the finger: points aren't evenly spaced on a day still trading.
    const x = clientX - $('chart').getBoundingClientRect().left - plot.left, points = plot.l.points;
    let i = 0;
    if (has('nearest')) i = L.nearest(points, x);
    else points.forEach(([px], j) => { if (Math.abs(px - x) <= Math.abs(points[i][0] - x)) i = j; });
    return { i, x: points[i][0], y: points[i][1], p: plot.points[i] };
  }

  // A light tick as a finger lands on each point: no more than 28 a second, or a quick drag across a
  // day's hundreds of points would be one long buzz. The phone app makes it, as its plain tick, which
  // every build of it has and every phone can be felt to make. A browser gives its shortest buzz,
  // where it has one and the page has been touched: before that it refuses, and says so in the console.
  const tickOk = has('gate') ? L.gate(36) : () => false;
  function tick() {
    if (!tickOk(performance.now())) return;
    if (app) return toApp({ type: 'haptic', kind: 'tick' });
    if (typeof navigator.vibrate !== 'function' || navigator.userActivation?.hasBeenActive === false) return;
    try { navigator.vibrate(4); } catch {}
  }

  // While a finger is reading the chart the headline's three lines keep the height they had, each
  // cut off at its own edge (style.css), so whatever the figures under the finger come to, the
  // chart stays where it is and nothing is written over it.
  let held = false;
  function hold(on) {
    if (held === on) return;
    held = on;
    const head = $('stockPrice').closest('.headline');
    for (const p of head.children) p.style.height = on ? `${p.getBoundingClientRect().height}px` : '';
    head.classList.toggle('held', on);
  }

  let landed = { count: 0, i: -1 };     // how many fingers were reading, and the one's point, to tell when it changes
  let scrubFrame = 0;
  function renderScrub() {
    cancelAnimationFrame(scrubFrame);
    scrubFrame = 0;
    const at = plot ? [...fingers.values()].slice(0, 2).map(pointAt) : [];
    const read = $('readout');
    read.hidden = at.length < 2;
    plot?.marks.replaceChildren();
    // A dot on each point, in the colour the line is there.
    for (const m of at) {
      plot.marks.append(svg('path', { class: 'mark', d: `M${m.x.toFixed(1)} 0V${plot.bottom}` }), svg('circle', { class: `dot ${L.direction(m.p[1] - plot.base)}`, cx: m.x.toFixed(1), cy: m.y.toFixed(1), r: 4.5 }));
    }
    if (at.length === 2) {
      const m = L.between(at[0].p, at[1].p);
      const [a, b] = at[0].x < at[1].x ? at : [at[1], at[0]];
      plot.marks.prepend(svg('rect', { class: 'band', x: a.x, y: 0, width: b.x - a.x, height: plot.bottom }));
      read.textContent = `${when(m.from[0])} to ${when(m.to[0])}: ${L.change(m.change, m.to[1], fine(quotes[open]))} (${L.percent(m.pct)})`;
    }
    // A tick for each new point under one finger. Two fingers compare in silence, and so does the
    // second one arriving or leaving.
    const now = { count: at.length, i: at.length === 1 ? at[0].i : -1 };
    if (now.count === 1 && landed.count < 2 && now.i !== landed.i) tick();
    landed = now;
    if (at.length) hold(true);
    renderHeadline(quotes[open]);
    if (!at.length) hold(false);
  }

  // A finger put on the chart may be the start of a scroll down the page, so it reads nothing until
  // it has plainly moved sideways (6px, and further across than up or down) or has rested where it
  // landed for a moment. One that moves up or down first is the page's, and changes nothing; a
  // quick tap is nothing either. A mouse can't scroll by dragging, so it reads at once, and so does
  // a second finger, which can only be there to compare.
  // The rest is long enough that a thumb pausing before it scrolls the page isn't taken for a read.
  const SLOP = 6, REST = 280;
  const resting = new Map();     // fingers down that aren't reading yet: id -> { x, y, at, timer }
  function begin(id) {
    const r = resting.get(id);
    if (!r) return;
    clearTimeout(r.timer);
    resting.delete(id);
    fingers.set(id, r.at);
    renderScrub();
  }
  // A finger gone, however it went: lifted, taken by a scroll, or lost with the page.
  function letGo(id) {
    clearTimeout(resting.get(id)?.timer);
    resting.delete(id);
    if (fingers.delete(id)) renderScrub();
  }
  const letAllGo = () => { for (const id of [...resting.keys(), ...fingers.keys()]) letGo(id); };
  const chartBox = $('chart');
  chartBox.addEventListener('pointerdown', e => {
    // Only a finger, a pen, or a mouse's main button.
    if (!plot || e.button) return;
    // A finger that can't be held on to is still read while it's over the chart.
    try { chartBox.setPointerCapture(e.pointerId); } catch {}
    const others = fingers.size + resting.size;
    resting.set(e.pointerId, { x: e.clientX, y: e.clientY, at: e.clientX, timer: 0 });
    if (e.pointerType === 'mouse' || others) for (const id of [...resting.keys()]) begin(id);
    else resting.get(e.pointerId).timer = setTimeout(begin, REST, e.pointerId);
  });
  chartBox.addEventListener('pointermove', e => {
    const r = resting.get(e.pointerId);
    if (r) {
      const dx = Math.abs(e.clientX - r.x), dy = Math.abs(e.clientY - r.y);
      r.at = e.clientX;
      if (dx >= SLOP && dx > dy) begin(e.pointerId);
      else if (dy >= SLOP) letGo(e.pointerId);
      return;
    }
    if (!fingers.has(e.pointerId)) return;
    // A mouse whose button came up somewhere it couldn't be seen.
    if (e.pointerType === 'mouse' && !e.buttons) return letGo(e.pointerId);
    fingers.set(e.pointerId, e.clientX);
    // However many times a finger moves between two frames, the chart is read once for the frame.
    if (!scrubFrame) scrubFrame = requestAnimationFrame(renderScrub);
  });
  // Until a finger is reading, a drag up or down is the page's to scroll (touch-action, style.css).
  // Once it is, it may wander up and down without the page taking it for a scroll.
  chartBox.addEventListener('touchmove', e => { if (fingers.size && e.cancelable) e.preventDefault(); }, { passive: false });
  // Whichever way a finger's touch ends, the headline goes back to the price now.
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) chartBox.addEventListener(type, e => letGo(e.pointerId));
  // A long press is reading the chart, not asking for a menu, which would take the finger's lifting with it.
  chartBox.addEventListener('contextmenu', e => { if (fingers.size || resting.size) e.preventDefault(); });
  $('stock').addEventListener('close', letAllGo);
  document.addEventListener('visibilitychange', () => { if (document.hidden) letAllGo(); });

  // Turning the phone changes the chart's box, and the marks must still land under the finger.
  new ResizeObserver(() => { if (open && $('chart').getBoundingClientRect().width) drawChart(); }).observe($('chart'));

  $('followBtn').addEventListener('click', () => {
    toggleFollow(open);
    renderFollow();
  });

  function toggleFollow(symbol) {
    setSymbols(following(symbol) ? list().symbols.filter(x => x !== symbol) : [...list().symbols, symbol]);
    if (state.tab === 'list') renderList();
    refreshList();
  }

  // ---- find a stock ----
  let findTimer = 0;
  const PLUS = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>';
  const TICK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>';
  $('searchBtn').addEventListener('click', () => {
    $('findBox').value = '';
    $('findClear').hidden = true;
    $('found').replaceChildren();
    show('find');
    $('findBox').focus();
  });
  let shown = { q: '', hits: [] };    // the results on screen, for Enter
  async function find(q) {
    let hits;
    try { hits = await api('search?q=' + encodeURIComponent(q)); } catch { hits = null; }
    if ($('findBox').value.trim() !== q) return null;
    if (hits) shown = { q, hits };
    if (!hits) { $('found').replaceChildren(el('p', 'empty', 'Can’t reach the market.')); return null; }
    if (!hits.length) { $('found').replaceChildren(el('p', 'empty', 'Nothing by that name.')); return hits; }
    $('found').replaceChildren(...hits.map(h => {
      const row = el('div', 'hit');
      const open = el('button', 'open');
      open.type = 'button';
      open.dataset.symbol = h.symbol;
      open.setAttribute('aria-label', `${h.symbol}, ${h.name}`);
      const who = el('div');
      who.append(el('b', '', h.symbol), el('small', '', h.name));
      const add = el('button', following(h.symbol) ? 'follow on' : 'follow');
      add.type = 'button';
      add.dataset.follow = h.symbol;
      add.setAttribute('aria-label', `Follow ${h.symbol}`);
      add.setAttribute('aria-pressed', String(following(h.symbol)));
      add.innerHTML = following(h.symbol) ? TICK : PLUS;
      row.append(open, who, el('span', '', h.exchange || ''), add);
      return row;
    }));
    return hits;
  }
  $('findBox').addEventListener('input', () => {
    clearTimeout(findTimer);
    $('findClear').hidden = !$('findBox').value;
    const q = $('findBox').value.trim();
    if (!q) return $('found').replaceChildren();
    findTimer = setTimeout(() => find(q), 220);
  });
  // Enter doesn't wait for typing to settle: it opens the first result.
  $('findBox').addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    clearTimeout(findTimer);
    const q = $('findBox').value.trim();
    if (!q) return;
    const hits = shown.q === q ? shown.hits : await find(q);
    if (!hits?.length || $('findBox').value.trim() !== q || !$('find').open) return;
    $('find').close();
    openStock(hits[0].symbol);
  });
  // Pressing it doesn't take focus from the box, so the keyboard stays up.
  $('findClear').addEventListener('mousedown', e => e.preventDefault());
  $('findClear').addEventListener('click', () => {
    $('findBox').value = '';
    $('findBox').dispatchEvent(new Event('input'));
    $('findBox').focus();
  });
  $('found').addEventListener('click', e => {
    const add = e.target.closest('[data-follow]');
    if (add) {
      toggleFollow(add.dataset.follow);
      const on = following(add.dataset.follow);
      add.className = on ? 'follow on' : 'follow';
      add.setAttribute('aria-pressed', String(on));
      add.innerHTML = on ? TICK : PLUS;
      return;
    }
    const b = e.target.closest('.open');
    if (!b) return;
    $('find').close();
    openStock(b.dataset.symbol);
  });
  for (const d of document.querySelectorAll('dialog.page')) {
    d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
  }
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', tellBack);
  $('stock').addEventListener('close', () => {
    const symbol = open;
    open = null;
    plot = null;
    // Back on the list, focus returns to the stock's row, even if the list moved meanwhile.
    if (state.tab === 'list' && (!document.activeElement || document.activeElement === document.body)) {
      [...$('rows').children].find(r => r.dataset.symbol === symbol)?.querySelector('.open')?.focus({ preventScroll: true });
    }
  });

  // ---- the market map ----
  const MARKETS = { sp500: U.sp500.name, asx: U.asx.name, ndx: U.ndx.name, dow: U.dow.name, world: U.world.name, crypto: 'Crypto', mine: 'My list' };
  const SECTORS = { 'Information Technology': 'Technology', 'Communication Services': 'Communication', 'Consumer Discretionary': 'Discretionary', 'Consumer Staples': 'Staples', 'Health Care': 'Health', 'Real Estate': 'Property' };
  // The same coin again, or pegged to a dollar: neither says anything on a heat map.
  const NOT_COINS = /^(WBTC|BTCB|CBBTC|WETH|WBETH|STETH|WSTETH|WEETH|RETH|AETHWETH|DAI|XAUT|PAXG|[A-Z]*USD[A-Z0-9]?)-USD$/;
  // Yahoo's names for exchanges, as people say them.
  const EXCHANGES = { NasdaqGS: 'Nasdaq', NasdaqGM: 'Nasdaq', NasdaqCM: 'Nasdaq', NYSEArca: 'NYSE Arca', 'Cboe US': 'Cboe', LSE: 'London', Toronto: 'TSX', HKSE: 'Hong Kong', 'Other OTC': 'OTC', 'OTC Markets': 'OTC' };
  const PERIODS = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
  const SIZES = { cap: 'Market cap', volume: 'Volume', equal: 'Equal' };
  const canvas = $('canvas'), ctx = canvas.getContext('2d');
  const stage = $('stage');
  let tiles = [];                 // the market on screen, with its numbers
  let map = null;                 // its layout
  let view = { k: 1, x: 0, y: 0 };
  let size = { w: 0, h: 0 };
  let drawing = 0, flying = 0;
  let picked = null;              // the square being looked at
  let paint = null;               // colours read once per draw settings, not per frame
  const moveCache = {};           // week and month moves by market
  let loadId = 0;

  const moveOf = t => ({ day: t.pct, week: t.week, month: t.month, year: t.year })[state.period];
  // Bitcoin alone would fill the crypto map, so sizes there go by the square root.
  function sizeOf(t) {
    if (U[state.market]?.equal || state.size === 'equal' || mixed) return 1;
    // Yahoo gives a coin's volume in dollars already, and a stock's in shares.
    const traded = t.type === 'CRYPTOCURRENCY' ? t.volume || 0 : (t.volume || 0) * (t.price || 0);
    const value = state.size === 'volume' ? traded : t.cap || 0;
    return state.market === 'crypto' ? Math.sqrt(value) : value;
  }

  // A list of funds with no market cap, or caps in several currencies, can't be
  // compared by size, so every square is the same.
  let mixed = false;
  let laidOut = '';               // the symbols the layout was made from
  let fresh = false, laidFresh = false;   // whether the numbers, and the layout, are new or the last saved
  // Size is offered only where it changes something: not where every square is the same.
  const sizeTool = () => { $('sizeWrap').hidden = !!U[state.market]?.equal || (state.market === 'mine' && mixed); };
  function relayout() {
    laidFresh = fresh;
    mixed = state.market === 'mine' && (tiles.some(t => !t.cap) || new Set(tiles.map(t => t.currency)).size > 1);
    sizeTool();
    map = L.layoutMap(tiles.map(t => ({ ...t, value: sizeOf(t) })), size.w, size.h, L.heads(size.w, size.h));
    laidOut = tiles.map(t => t.symbol).join();
    labelSectors();
  }
  // New numbers for the same stocks only recolour the squares. Moving them would
  // lose the one being looked at, so sizes change only with the market, the size
  // setting or the screen.
  // A layout from saved numbers, or a stock that had no size and now has one, is laid out again.
  function update() {
    if (!map || !laidFresh || laidOut !== tiles.map(t => t.symbol).join()) return relayout();
    const placed = new Set(map.tiles.map(t => t.symbol));
    if (tiles.some(t => !placed.has(t.symbol) && sizeOf(t) > 0)) return relayout();
    const by = new Map(tiles.map(t => [t.symbol, t]));
    for (const t of map.tiles) Object.assign(t, by.get(t.symbol));
    labelSectors();
  }

  // Each sector's heading says how it did, and the header how the market did.
  function labelSectors() {
    if (!map) return;
    // Each move counts up to the colour's limit, and caps in different currencies
    // can't be weighed against each other, so then every stock counts the same.
    const moved = list => L.heat(L.weightedMove(list, moveOf, t => (mixed ? 1 : t.cap || 1), L.SPREAD[state.period]), state.period);
    for (const s of map.sectors) {
      s.text = SECTORS[s.name] || s.name;
      s.colour = L.band(moved(map.tiles.filter(t => t.sector === s.name)), 0.45);
    }
    for (const g of map.industries) g.colour = L.band(moved(map.tiles.filter(t => t.sector === g.sector && t.industry === g.name)), 0.3);
    paint = null;
    if (state.tab === 'map') renderMeta();
    request();
  }

  function resize() {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const resized = box.width !== size.w || box.height !== size.h;
    size = { w: box.width, h: box.height };
    view = L.clampView(view, size.w, size.h);
    if (tiles.length && (resized || !map)) relayout();
    else request();
  }

  const request = () => { if (!drawing) drawing = requestAnimationFrame(draw); };

  function draw() {
    drawing = 0;
    if (!map) return;
    const { k, x: ox, y: oy } = view, { w: W, h: H } = size;
    if (!paint) {
      paint = true;
      for (const t of map.tiles) { t.colour = L.heat(moveOf(t), state.period); t.moveText = L.percent(moveOf(t)); }
    }
    const seen = (a, b, c, d) => a < W && b < H && a + c > 0 && b + d > 0;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Each sector is a tinted frame with its name across the top.
    for (const s of map.sectors) {
      const x = s.x * k + ox, y = s.y * k + oy, w = s.w * k, h = s.h * k;
      if (!seen(x, y, w, h)) continue;
      ctx.fillStyle = `rgb(${s.colour})`;
      ctx.fillRect(x + .5, y + .5, w - 1, h - 1);
    }
    // Then each industry's band.
    for (const g of map.industries) {
      const x = g.x * k + ox, y = g.y * k + oy, w = g.w * k, h = g.h * k;
      if (!seen(x, y, w, h)) continue;
      ctx.fillStyle = `rgb(${g.colour})`;
      ctx.fillRect(x, y, w, h);
    }
    // The squares.
    ctx.fillStyle = '#fff';
    for (const t of map.tiles) {
      const x = t.x * k + ox, y = t.y * k + oy, w = t.w * k, h = t.h * k;
      if (!seen(x, y, w, h)) continue;
      ctx.fillStyle = `rgb(${t.colour})`;
      ctx.fillRect(x, y, w, h);
      const text = L.tileText(t.label, t.moveText, w, h);
      if (!text) continue;
      ctx.fillStyle = '#fff';
      // A square half off the screen keeps its name on the half that shows, if that half has room for
      // it. If not, the name stays where it was, cut off with its square, rather than over its neighbours.
      let cx = x + w / 2, cy = y + h / 2, cut = false;
      if (x < 0 || y < 0 || x + w > W || y + h > H) {
        const left = Math.max(x, 0), top = Math.max(y, 0), sw = Math.min(x + w, W) - left, sh = Math.min(y + h, H) - top;
        const wide = Math.max(t.label.length * text.size, text.both ? t.moveText.length * text.moveSize : 0) * .62 + 3;
        if (sw >= wide && sh >= text.size * (text.both ? 2.05 : 1.1) + 2) { cx = left + sw / 2; cy = top + sh / 2; }
        else { cut = true; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
      }
      ctx.font = `600 ${text.size}px "Hanken Grotesk", sans-serif`;
      if (text.both) {
        ctx.fillText(t.label, cx, cy - text.size * .52);
        ctx.font = `400 ${text.moveSize}px "Hanken Grotesk", sans-serif`;
        ctx.fillText(t.moveText, cx, cy + text.size * .56);
      } else ctx.fillText(t.label, cx, cy);
      if (cut) ctx.restore();
    }
    // Headings go on last, centred on the part that's on screen.
    ctx.fillStyle = '#fff';
    const heading = (g, font, weight) => {
      if (font < 5) return;
      const x = g.x * k + ox, y = g.y * k + oy, w = g.w * k;
      const left = Math.max(x, 0), right = Math.min(x + w, W);
      if (right - left < 18) return;
      ctx.font = `${weight} ${font}px "Hanken Grotesk", sans-serif`;
      fit(g.text || g.name, (left + right) / 2, y + g.h * k / 2, right - left - 4);
    };
    // Fonts follow the strips, which grow with the map; zooming in adds a little more.
    const { sectorHead: sh, industryHead: ih } = map;
    // Whole pixels, like the squares' labels.
    const industryFont = Math.round(Math.min(ih * 1.44, ih * k * .74));
    for (const g of map.industries) if (seen(g.x * k + ox, g.y * k + oy, g.w * k, g.h * k)) heading(g, industryFont, 400);
    const sectorFont = Math.round(Math.min(sh * 1.07, sh * k * .72));
    for (const s of map.sectors) if (s.head && seen(s.x * k + ox, s.y * k + oy, s.w * k, sh * k)) heading({ ...s, h: sh }, sectorFont, 600);

    // The square being looked at.
    const t = picked && map.tiles.find(m => m.symbol === picked);
    if (t) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x * k + ox + 1, t.y * k + oy + 1, Math.max(2, t.w * k - 2), Math.max(2, t.h * k - 2));
    }
  }
  // Text cut to a width.
  function fit(text, x, y, width) {
    let t = text;
    while (t.length > 3 && ctx.measureText(t).width > width) t = t.slice(0, -2);
    ctx.fillText(t === text ? t : t.trimEnd() + '…', x, y);
  }

  // A tap shows a square's numbers without leaving the map.
  function renderPeek() {
    const t = picked && tiles.find(m => m.symbol === picked);
    $('peek').hidden = !t;
    if (!t) return;
    const move = moveOf(t);
    $('peekSymbol').textContent = t.label;
    $('peekName').textContent = t.name;
    $('peekPrice').textContent = priceOf(t.price, t);
    const line = $('peekMove');
    line.textContent = [L.percent(move), PERIODS[state.period].toLowerCase(), t.cap ? `· ${L.big(t.cap)}` : ''].filter(Boolean).join(' ');
    line.className = L.direction(move);
  }
  let peekAt = 0;                 // when the card last came up
  function pick(symbol) {
    if (symbol) { haptic(); peekAt = performance.now(); }
    picked = symbol;
    renderPeek();
    request();
    tellBack();
    // Said once per pick, not on every refresh of the card.
    $('mapSay').textContent = picked ? `${$('peekSymbol').textContent}, ${$('peekName').textContent}, ${$('peekPrice').textContent}, ${$('peekMove').textContent}` : '';
  }
  // The tap that picks a square near the foot of the map lands its click on the card that tap
  // brought up. That click began before the card was there, and isn't a press on it.
  $('peek').addEventListener('click', e => { if (picked && e.timeStamp > peekAt) openStock(picked); });

  function setView(next) {
    view = next;
    $('fitBtn').hidden = view.k <= 1.01;
    request();
  }
  // A smooth move to a new view, for taps; fingers move the map directly.
  function flyTo(target) {
    cancelAnimationFrame(flying);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setView(target);
    const from = view, began = performance.now();
    const step = at => {
      const t = Math.min(1, (at - began) / 300), e = 1 - (1 - t) ** 3;
      setView({ k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      if (t < 1) flying = requestAnimationFrame(step);
    };
    flying = requestAnimationFrame(step);
  }

  function hit(px, py) {
    const x = (px - view.x) / view.k, y = (py - view.y) / view.k;
    if (!map) return {};
    const tile = map.tiles.find(t => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
    if (tile) return { tile };
    const inside = (b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    return { sector: map.sectors.find(inside), industry: map.industries.find(inside) };
  }

  const touches = new Map();
  let gesture = null, lastTap = 0;
  const local = e => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const spread = ([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const middle = ([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  canvas.addEventListener('pointerdown', e => {
    cancelAnimationFrame(flying);
    if (!$('mapHint').hidden) { $('mapHint').hidden = true; store.set('seenMapHint', true); }
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, local(e));
    const pts = [...touches.values()];
    gesture = pts.length === 1
      ? { start: pts[0], moved: false, last: pts[0] }
      : { moved: true, last: middle(pts), gap: spread(pts) };
  });
  canvas.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId) || !gesture) return;
    touches.set(e.pointerId, local(e));
    const pts = [...touches.values()];
    if (pts.length >= 2) {
      const mid = middle(pts), gap = spread(pts);
      let next = L.zoomAt(view, gap / (gesture.gap || gap), mid[0], mid[1], size.w, size.h);
      next = L.clampView({ ...next, x: next.x + mid[0] - gesture.last[0], y: next.y + mid[1] - gesture.last[1] }, size.w, size.h);
      gesture.last = mid;
      gesture.gap = gap;
      return setView(next);
    }
    const p = pts[0];
    if (!gesture.moved && Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) < 8) return;
    gesture.moved = true;
    const next = L.clampView({ ...view, x: view.x + p[0] - gesture.last[0], y: view.y + p[1] - gesture.last[1] }, size.w, size.h);
    gesture.last = p;
    setView(next);
  });
  function lift(e) {
    if (!touches.has(e.pointerId)) return;
    const pos = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    const pts = [...touches.values()];
    if (pts.length === 1) { gesture = { moved: true, last: pts[0] }; return; }
    if (pts.length >= 2) { gesture = { moved: true, last: middle(pts), gap: spread(pts) }; return; }
    if (pts.length || !gesture) return;
    const tapped = !gesture.moved && e.type === 'pointerup';
    gesture = null;
    if (!tapped) return;
    const now = performance.now();
    const quick = now - lastTap < 280;
    lastTap = now;
    const found = hit(pos[0], pos[1]);
    if (quick) return flyTo(L.zoomAt(view, 2.4, pos[0], pos[1], size.w, size.h));
    // A second tap on the square being looked at puts its card away.
    if (found.tile) return pick(found.tile.symbol === picked ? null : found.tile.symbol);
    pick(null);
    if (found.sector || found.industry) flyTo(L.viewOf(found.industry && view.k > 1.5 ? groupBox(found.industry) : found.sector, size.w, size.h));
  }
  // An industry heading stands for the stocks under it.
  function groupBox(g) {
    const members = map.tiles.filter(t => t.industry === g.name);
    const x = Math.min(...members.map(t => t.x)), y = Math.min(...members.map(t => t.y));
    const head = map.industryHead - 1;
    return { x, y: y - head, w: Math.max(...members.map(t => t.x + t.w)) - x, h: Math.max(...members.map(t => t.y + t.h)) - y + head };
  }
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnimationFrame(flying);
    const [x, y] = local(e);
    setView(L.zoomAt(view, Math.exp(-e.deltaY * .0022), x, y, size.w, size.h));
  }, { passive: false });
  $('fitBtn').addEventListener('click', () => flyTo({ k: 1, x: 0, y: 0 }));
  canvas.addEventListener('keydown', e => {
    cancelAnimationFrame(flying);
    const step = 60;
    const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (pan) { e.preventDefault(); return setView(L.clampView({ ...view, x: view.x + pan[0], y: view.y + pan[1] }, size.w, size.h)); }
    if (e.key === '+' || e.key === '=') return setView(L.zoomAt(view, 1.4, size.w / 2, size.h / 2, size.w, size.h));
    if (e.key === '-') return setView(L.zoomAt(view, 1 / 1.4, size.w / 2, size.h / 2, size.w, size.h));
    if (e.key === 'Escape') { pick(null); flyTo({ k: 1, x: 0, y: 0 }); }
    // Enter or Space shows the square in the middle of the view: arrows and zoom aim.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const t = middleTile();
      if (t) pick(t.symbol);
    }
  });
  // The square under the middle of the view, or the nearest one when that's a heading.
  function middleTile() {
    if (!map?.tiles.length) return null;
    const found = hit(size.w / 2, size.h / 2).tile;
    if (found) return found;
    const x = (size.w / 2 - view.x) / view.k, y = (size.h / 2 - view.y) / view.k;
    const away = t => Math.hypot(Math.max(t.x - x, 0, x - t.x - t.w), Math.max(t.y - y, 0, y - t.y - t.h));
    return map.tiles.reduce((a, b) => (away(b) < away(a) ? b : a));
  }

  function renderLegend() {
    const spread = L.SPREAD[state.period];
    // Whole percents, each square coloured for the number on it, so the legend fits beside Size on a phone.
    const steps = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1].map(s => Math.round(s * spread));
    $('legend').replaceChildren(...steps.map(v => {
      const c = L.heat(v, state.period);
      const s = el('span', '', `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`);
      s.style.background = `rgb(${c})`;
      return s;
    }));
    $('legend').style.setProperty('--chars', Math.max(...[...$('legend').children].map(s => s.textContent.length)));
  }

  function renderMapTools() {
    $('marketName').textContent = MARKETS[state.market];
    fillPick($('marketPick'), MARKETS, state.market);
    $('periods').replaceChildren(...Object.entries(PERIODS).map(([id, name]) => {
      const b = el('button', '', name);
      b.type = 'button';
      b.dataset.period = id;
      b.setAttribute('aria-pressed', String(id === state.period));
      return b;
    }));
    $('sizeName').textContent = `Size: ${SIZES[state.size]}`;
    fillPick($('sizePick'), SIZES, state.size);
    sizeTool();
    renderLegend();
  }

  // A stock whose batch failed (`missed`) keeps its last numbers from `last`, but
  // not a day's move from an earlier day. One Yahoo left out of a good batch is gone.
  function tilesFrom(members, numbers, market, last = [], missed = new Set()) {
    const by = new Map(numbers.map(q => [q.symbol, q]));
    const had = new Map(last.filter(t => missed.has(t.symbol)).map(t => [t.symbol, t]));
    const newest = Math.max(0, ...numbers.map(q => q.time || 0));
    return members.filter(m => by.has(m[0]) || had.has(m[0])).map(([symbol, name, sector, industry, label]) => {
      const q = by.get(symbol);
      if (!q) { const t = had.get(symbol); return newest - (t.time || 0) > 12 * 3600 ? { ...t, pct: undefined } : t; }
      return { symbol, label: label || (q.type === 'CRYPTOCURRENCY' ? L.coinName(symbol) : symbol.replace(/\.AX$/, '').replace(/-USD$/, '')), name, sector, industry, time: q.time, tz: q.tz, price: q.price, pct: q.pct, year: q.year, cap: q.cap, volume: q.volume, state: q.state, type: q.type, currency: q.currency, ...(moveCache[market]?.all[symbol] || {}) };
    });
  }

  // Squares a load left without numbers are asked for again on their own, quietly:
  // three times at most, further apart each time, one ask at a time, and only while
  // the map is being looked at. The refresh below asks for every square anyway, but
  // only each quarter hour while the market is shut. What the last try still hasn't
  // got is `spent`, and left to that refresh. What it did get back is `got`: a later
  // answer that leaves one of those out keeps its square, so the map stays still.
  const noAgain = () => ({ want: [], spent: new Set(), got: new Set(), step: 0, timer: 0 });
  let again = noAgain();
  function dropAgain() { clearTimeout(again.timer); again = noAgain(); }
  function askAgain() {
    if (again.timer || state.tab !== 'map' || document.hidden) return;
    if (!again.want.length) { again.step = 0; return; }
    const wait = L.againIn(again.step);
    if (wait == null) { for (const s of again.want) again.spent.add(s); again.want = []; again.step = 0; return; }
    const chain = again;
    chain.timer = setTimeout(async () => {
      chain.timer = 0;
      // A load under way, or a finger on the map, comes first.
      if (busy.map || gesture || touches.size) return askAgain();
      if (state.tab !== 'map' || document.hidden) return;
      // A stock unfollowed since isn't brought back.
      const mine = state.market === 'mine';
      if (mine) chain.want = chain.want.filter(following);
      if (!chain.want.length) return askAgain();
      chain.step++;
      chain.timer = -1;   // out asking: nothing else starts meanwhile
      const parts = await chunks(chain.want, 100, part => api('quotes?symbols=' + encodeURIComponent(part.join(','))).then(listed)).catch(() => null);
      chain.timer = 0;
      // Another market, or another list, since.
      if (chain !== again) return;
      const numbers = (parts ? parts.got.flat() : []).filter(q => !mine || following(q.symbol));
      if (numbers.length) {
        const market = state.market, got = new Set(numbers.map(q => q.symbol));
        const members = market === 'mine' ? numbers.map(ownMember) : U[market].members.filter(m => got.has(m[0]));
        // Each takes the place of the square it had, and a new one goes where the market lists it.
        const all = new Map(tiles.map(t => [t.symbol, t]));
        for (const t of tilesFrom(members, numbers, market)) all.set(t.symbol, t);
        tiles = [...all.values()];
        if (market !== 'mine') {
          const place = new Map(U[market].members.map((m, i) => [m[0], i]));
          tiles.sort((a, b) => place.get(a.symbol) - place.get(b.symbol));
        }
        chain.want = L.absent(chain.want, [...got]);
        for (const x of got) chain.got.add(x);
        store.set(mapKey(market), tiles);
        update();
        renderPeek();
        // Their week and month too, which the moves already held don't cover.
        if (moveCache[market] || state.period === 'week' || state.period === 'month') loadMoves([...got]);
      }
      askAgain();
    }, wait);
  }

  // Squares the chain got back, left out of this answer, are kept like a failed batch's.
  function keepGot(asked, numbers, missed) {
    const by = new Set(numbers.map(q => q.symbol));
    for (const x of asked) if (again.got.has(x) && !by.has(x)) missed.add(x);
    return missed;
  }

  const ownMember = q => [q.symbol, q.name, q.type === 'CRYPTOCURRENCY' ? 'Crypto' : 'Stocks', EXCHANGES[q.exchange] || q.exchange || 'Stocks'];

  // Who's in a market, then their numbers in as few calls as the Worker allows.
  // The last map seen goes up straight away, and fresh prices follow.
  async function loadMarket(keep = false) {
    const id = ++loadId, market = state.market;
    last.map = Date.now();
    if (!keep) {
      dropAgain();
      let last = store.get(mapKey(market));
      // A list's map holds only what the list still does.
      if (market === 'mine' && Array.isArray(last)) last = last.filter(t => following(t?.symbol));
      cancelAnimationFrame(flying);
      if (Array.isArray(last) && last.length) { tiles = last; fresh = false; }
      view = { k: 1, x: 0, y: 0 };
      $('fitBtn').hidden = true;
      resize();
      if (tiles.length) relayout();
    }
    $('mapWait').hidden = tiles.length > 0;
    $('mapWait').textContent = 'Loading the market…';
    busy.map++;
    try {
      let members, numbers, missed = new Set(), asked = [];
      if (market === 'crypto') {
        // Wrapped and pegged coins are left out.
        // Yahoo tells some coins apart with a number: HYPE32196-USD is HYPE.
        const coin = q => q.symbol.replace(/\d+-USD$/, '-USD');
        numbers = listed(await api('crypto')).filter(q => /^[A-Z]{1,8}-USD$/.test(coin(q)) && !NOT_COINS.test(coin(q)));
        members = numbers.map(q => [q.symbol, q.name.replace(/ USD$/, ''), 'Crypto', 'Crypto', coin(q).replace('-USD', '')]);
      } else if (market === 'mine') {
        const own = asked = list().symbols.filter(x => !x.startsWith('^'));
        const parts = await chunks(own, 100, part => api('quotes?symbols=' + encodeURIComponent(part.join(','))).then(listed));
        numbers = parts.got.flat();
        missed = keepGot(own, numbers, parts.missed);
        members = numbers.map(ownMember);
        // A batch that failed keeps the squares it had.
        members.push(...tiles.filter(t => missed.has(t.symbol)).map(t => [t.symbol, t.name, t.sector, t.industry]));
      } else {
        members = U[market].members;
        asked = members.map(m => m[0]);
        const parts = await chunks(asked, 100, part => api('quotes?symbols=' + encodeURIComponent(part.join(','))).then(listed));
        numbers = parts.got.flat();
        missed = keepGot(asked, numbers, parts.missed);
      }
      // An answer with nobody in it is a load that failed: the squares on screen, and the saved ones, stay.
      if (!numbers.length && (market === 'crypto' || asked.length)) throw new Error('quotes');
      if (id !== loadId) return;
      tiles = tilesFrom(members, numbers, market, tiles, missed);
      fresh = true;
      behind.prices = false;
      mapStale();
      store.set(mapKey(market), tiles);
      if (keep) update();
      else relayout();
      // A square gone from the market takes its card, and Back's hold, with it.
      if (picked && !tiles.some(t => t.symbol === picked)) pick(null);
      renderPeek();
      $('mapWait').hidden = map.tiles.length > 0;
      if (!map.tiles.length) $('mapWait').textContent = market === 'mine' ? 'Follow some stocks to see them here.' : 'No prices for this market right now.';
      if (state.period === 'week' || state.period === 'month') loadMoves();
      // One answered after all is no longer given up on, and a new one missing starts the tries afresh.
      for (const q of numbers) again.spent.delete(q.symbol);
      const want = L.absent(asked, numbers.map(q => q.symbol), again.spent);
      if (want.some(x => !again.want.includes(x))) again.step = 0;
      again.want = want;
      askAgain();
    } catch {
      if (id !== loadId) return;
      behind.prices = true;
      mapStale();
      if (!tiles.length) { $('mapWait').hidden = false; $('mapWait').textContent = 'Can’t reach the market. Try again in a moment.'; }
    } finally { busy.map--; }
  }

  // The map is out of date when its prices couldn't be fetched, and while Week or Month is showing,
  // when those moves couldn't be. Back on Day or Year, fresh prices are all it needs.
  const behind = { prices: false, moves: false };
  function mapStale() { setStale('map', behind.prices || (behind.moves && (state.period === 'week' || state.period === 'month'))); }

  // The week's and month's moves take more calls, so they come only when asked for.
  // `only` asks for just those symbols, whatever is held: squares that came back late.
  async function loadMoves(only) {
    const market = state.market;
    const had = moveCache[market];
    if (!only && market !== 'mine' && had && Date.now() - had.at < 1800e3) return;
    const symbols = only || tiles.map(t => t.symbol);
    const parts = await chunks(symbols, 100, part => api('moves?symbols=' + encodeURIComponent(part.join(',')))).catch(() => null);
    const held = moveCache[market];
    // The late ones failing leaves what's held to be asked for whole on the next refresh.
    // All of them failing says so, like the prices failing: the header reads Offline, the figures held
    // stay, and the refresh asks again each minute.
    if (!parts) {
      if (held) held.at = 0;
      if (!only && market === state.market) { behind.moves = true; mapStale(); }
      return;
    }
    const all = Object.assign({}, held?.all, ...parts.got);
    // A batch that failed is asked for again on the next refresh.
    moveCache[market] = { at: parts.missed.size ? 0 : only ? held?.at || 0 : Date.now(), all };
    if (market !== state.market) return;
    if (!only) { behind.moves = false; mapStale(); }
    tiles = tiles.map(t => ({ ...t, ...(all[t.symbol] || {}) }));
    update();
    renderPeek();
  }

  // Another list is another map: the squares on screen belong to the list just left.
  function otherList() {
    if (state.market !== 'mine') return;
    loadId++;
    dropAgain();
    behind.moves = false;
    tiles = [];
    map = null;
    pick(null);
  }
  $('marketPick').addEventListener('change', () => {
    if ($('marketPick').value === state.market) return;
    state.market = $('marketPick').value;
    behind.moves = false;
    tiles = [];
    map = null;
    pick(null);
    ctx.clearRect(0, 0, size.w, size.h);
    save();
    renderMapTools();
    loadMarket();
  });
  $('periods').addEventListener('click', e => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    state.period = b.dataset.period;
    save();
    mapStale();
    renderMapTools();
    labelSectors();
    renderPeek();
    if (state.period === 'week' || state.period === 'month') loadMoves();
  });
  $('sizePick').addEventListener('change', () => {
    state.size = $('sizePick').value;
    cancelAnimationFrame(flying);
    save();
    renderMapTools();
    view = { k: 1, x: 0, y: 0 };
    $('fitBtn').hidden = true;
    relayout();
  });

  // ---- tabs ----
  function showTab(tab) {
    state.tab = tab;
    save();
    const onMap = tab === 'map';
    $('tabList').setAttribute('aria-selected', String(!onMap));
    $('tabMap').setAttribute('aria-selected', String(onMap));
    $('listView').hidden = onMap;
    $('mapView').hidden = !onMap;
    $('app').classList.toggle('wide', onMap);
    if (onMap) {
      renderMapTools();
      resize();
      if (!tiles.length) loadMarket();
      else if (due('map')) loadMarket(true);
      else askAgain();
      if (!store.get('seenMapHint')) $('mapHint').hidden = false;
    }
    else { if (again.timer > 0) { clearTimeout(again.timer); again.timer = 0; } renderList(); }
    renderMeta();
    tellBack();
  }
  $('tabList').addEventListener('click', () => showTab('list'));
  $('tabMap').addEventListener('click', () => showTab('map'));

  new ResizeObserver(() => { if (state.tab === 'map') resize(); }).observe(stage);
  if (document.fonts) document.fonts.ready.then(request);

  // Fresh prices while the screen is on, and on coming back to it: each minute
  // while a market on screen is open, each quarter hour while they're all shut
  // (and just after one is due to open), and each minute while offline, to notice
  // the signal coming back. An ask still out isn't asked again. A stock's page
  // also counts its pre-market and after-hours trading, which moves its price.
  const TRADING = { list: ['REGULAR'], map: ['REGULAR'], stock: ['REGULAR', 'PRE', 'POST'] };
  function due(part, every = 60e3) {
    if (busy[part]) return false;
    const symbols = part === 'list' ? list().symbols : part === 'stock' ? [open] : [];
    const states = part === 'map' ? tiles.map(t => t.state) : symbols.map(s => quotes[s]?.state);
    // The map's bells come from the list's lines, from markets in the map's time zones.
    const zones = part === 'map' ? new Set(tiles.map(t => t.tz).filter(Boolean)) : null;
    const bells = (part === 'map' ? Object.keys(sparks) : symbols)
      .filter(s => !zones?.size || zones.has(quotes[s]?.tz))
      .map(s => L.nextOpen(sparks[s]?.session, quotes[s]?.tz, last[part]));
    return L.due(Date.now(), last[part], stale[part] || states.some(s => TRADING[part].includes(s)), bells, every);
  }
  function refresh(every) {
    if (due('list', every)) refreshList();
    if (open && due('stock', every)) refreshStock(open);
    if (state.tab === 'map' && !gesture && !touches.size && due('map', every)) loadMarket(true);
  }
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(20000); askAgain(); } });

  // Focus rings on the pickers are for the keyboard, not for a finger.
  document.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.classList.add('kbd'); }, true);
  document.addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd'), true);

  // ---- Android app bridge (absent in a browser) ----
  function show(id) { if (!$(id).open) $(id).showModal(); tellBack(); }
  const openDialog = () => [...document.querySelectorAll('dialog[open]')].pop();
  function toApp(msg) {
    if (!app) return;
    try { app.postMessage(JSON.stringify(msg)); } catch {}
  }
  function haptic(kind = 'tap') { toApp({ type: 'haptic', kind }); }
  // Android Back closes whatever's open. After that it leaves the app.
  // On the map, a square's card is closed first.
  const mapPicked = () => state.tab === 'map' && !!picked;
  window.bourseBack = () => {
    // An open drop-down goes first.
    if (picking) { closePick(); return true; }
    const d = openDialog();
    if (d) { d.close(); return true; }
    if (mapPicked()) { pick(null); return true; }
    return false;
  };
  function tellBack() { toApp({ type: 'back', enabled: !!picking || !!openDialog() || mapPicked() }); }

  // ---- drop-downs ----
  // Each picker is a button beside its hidden <select>, which stays the source of truth: the menu is
  // made from the select's options each time it opens, and choosing a row sets the select and fires
  // the change the rest of the app listens for.
  const ROW_TICK = '<svg class="tick" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10.5 4 4 8-9"/></svg>';
  const rowIcon = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  // Rows that do something rather than choose, by the option's value: they have a picture and no tick.
  const ROW_ACTIONS = { listPick: { new: rowIcon('M12 5v14M5 12h14'), rename: rowIcon('m4 20 1-4.2L16.6 4.2a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.2 19 4 20ZM14.8 6l3.2 3.2') } };
  const pickMenu = $('pickMenu');
  let picking = null;   // the picker whose menu is open
  let pickedAt = 0;     // when it opened
  function openPick(trigger) {
    closePick();
    const select = $(trigger.dataset.pick);
    pickMenu.replaceChildren(...[...select.options].map(o => {
      const icon = ROW_ACTIONS[select.id]?.[o.value];
      const row = el('button', 'menu-row');
      row.type = 'button';
      row.dataset.value = o.value;
      row.setAttribute('role', icon ? 'menuitem' : 'menuitemradio');
      if (icon) row.innerHTML = icon;
      else row.setAttribute('aria-checked', String(o.value === select.value));
      row.append(el('span', '', o.textContent));
      if (!icon) row.insertAdjacentHTML('beforeend', ROW_TICK);
      return row;
    }));
    pickMenu.setAttribute('aria-label', select.getAttribute('aria-label'));
    // Under its picker, from the picker's left edge, or its right for one at the right of the screen;
    // above it when there's more room there than below (Size, at the foot of the map). Never off the
    // screen, and no taller than the room it has: the rest scrolls.
    pickMenu.style.cssText = '';
    pickMenu.hidden = false;
    const t = trigger.getBoundingClientRect(), W = document.documentElement.clientWidth, H = innerHeight;
    const w = pickMenu.offsetWidth, h = pickMenu.offsetHeight;
    const atRight = (t.left + t.right) / 2 > W / 2;
    const below = H - 12 - (t.bottom - 4), above = t.top + 4 - 12;
    const up = h > below && above > below;
    pickMenu.style.left = Math.max(12, Math.min(W - 12 - w, atRight ? t.right - w : t.left)) + 'px';
    pickMenu.style.top = (up ? Math.max(12, t.top + 4 - h) : t.bottom - 4) + 'px';
    pickMenu.style.maxHeight = (up ? above : below) + 'px';
    pickMenu.style.transformOrigin = `${up ? 'bottom' : 'top'} ${atRight ? 'right' : 'left'}`;
    picking = trigger;
    pickedAt = performance.now();
    trigger.setAttribute('aria-expanded', 'true');
    const at = pickMenu.querySelector('[aria-checked="true"]') || pickMenu.firstChild;
    if (at) { at.focus({ preventScroll: true }); at.scrollIntoView({ block: 'nearest' }); }
    tellBack();
  }
  // Focus goes back to the picker, so the keyboard carries on from where it was.
  function closePick() {
    if (!picking) return;
    const trigger = picking;
    picking = null;
    pickMenu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
    tellBack();
  }
  for (const b of document.querySelectorAll('[data-pick]')) {
    b.addEventListener('click', () => (picking === b ? closePick() : openPick(b)));
    b.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && picking !== b) { e.preventDefault(); openPick(b); } });
  }
  pickMenu.addEventListener('click', e => {
    const row = e.target.closest('.menu-row');
    if (!row || !picking) return;
    const select = $(picking.dataset.pick), value = row.dataset.value;
    closePick();
    // As with the phone's own picker, choosing what's already chosen changes nothing.
    if (value === select.value) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  pickMenu.addEventListener('keydown', e => {
    const rows = [...pickMenu.children], at = rows.indexOf(document.activeElement);
    const to = { ArrowDown: (at + 1) % rows.length, ArrowUp: (at - 1 + rows.length) % rows.length, Home: 0, End: rows.length - 1 }[e.key];
    if (to != null) { e.preventDefault(); rows[to].focus(); }
    else if (e.key === 'Tab') closePick();
  });
  // A tap anywhere else, Escape, the page scrolling or the screen changing shape puts it away.
  // Like the phone's own picker, that tap does nothing else: it doesn't open the stock under it, pick a
  // square on the map or press Edit. Only another picker takes it, and opens.
  // Its click comes after its pointerup, so the click is what ends it; with no click (a drag), the
  // next press does, or 400 ms.
  let swallow = false, swallowTimer = 0;
  document.addEventListener('pointerdown', e => {
    swallow = false;
    clearTimeout(swallowTimer);
    if (!picking || e.target.closest('#pickMenu') || e.target.closest('[data-pick]') === picking) return;
    closePick();
    if (e.target.closest('[data-pick]')) return;
    swallow = true;
    e.stopPropagation();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { if (swallow) swallowTimer = setTimeout(() => { swallow = false; }, 400); }, true);
  document.addEventListener('click', e => { if (swallow) { swallow = false; clearTimeout(swallowTimer); e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && picking) { e.preventDefault(); closePick(); } });
  // (Not the tail of a scroll that was still settling as the menu opened.)
  document.addEventListener('scroll', e => { if (picking && !pickMenu.contains(e.target) && performance.now() - pickedAt > 250) closePick(); }, true);
  addEventListener('resize', () => closePick());

  // selfUpdates is off until the app says otherwise: Play builds update through
  // the store, so there About has the version and nothing to check.
  let appVersion = '', selfUpdates = false, updateReady = false, versionTimer = 0, updateVersion = '', updateSize = 0;
  // About's first card: the version, as the app gives it (the website has none, and no row).
  function showVersion() {
    $('aboutVer').replaceChildren(el('span', '', 'Version'), el('span', '', appVersion));
    $('aboutVer').hidden = !appVersion;
  }
  // What a check found, beside Check for updates.
  function showNote(text) {
    clearTimeout(versionTimer);
    $('aboutNote').textContent = text;
  }
  // An update is waiting: the row says so, and there's a dot on the way to About.
  function showReady() {
    updateReady = true;
    $('aboutBtn').dataset.state = 'available';
    showNote('Available');
  }
  function showUpdate(m) {
    const setShown = (id, on) => { $(id).hidden = !on; };
    $('updateCard').hidden = false;
    if (m.state === 'available') {
      updateVersion = m.version || updateVersion;
      updateSize = m.size > 0 ? m.size : updateSize;
      const notes = Array.isArray(m.notes) ? m.notes.filter(n => typeof n === 'string' && n).slice(0, 5) : [];
      $('updateNotes').replaceChildren(...notes.map(n => el('li', '', n)));
      setShown('updateNotes', notes.length > 0);
    }
    const v = {
      available: { title: 'Update available', msg: '', actions: true, progress: false, go: 'Update' },
      downloading: { title: 'Downloading update', msg: '', actions: false, progress: true },
      installing: { title: 'Installing update', actions: false, progress: true, msg: 'Confirm on the next screen. The first time, Android asks you to allow installs from Bourse. Turn it on, then go back.' },
      failed: { title: 'Update didn’t finish', msg: m.message || 'Something went wrong. Try again.', actions: true, progress: false, go: 'Try again' },
    }[m.state];
    if (!v) return;
    $('updateTitle').textContent = v.title;
    $('updateSub').textContent = [`Bourse ${updateVersion}`, updateSize ? `${(updateSize / 1e6).toFixed(1)} MB` : ''].filter(Boolean).join(' · ');
    $('updateMsg').textContent = v.msg;
    setShown('updateMsg', !!v.msg);
    setShown('updateActions', v.actions);
    setShown('updateProgress', v.progress);
    if (v.go) $('updateGo').textContent = v.go;
    if (v.progress) {
      const p = m.state === 'installing' ? 100 : Math.round(Math.max(0, Math.min(1, m.progress || 0)) * 100);
      $('updateBar').style.width = p + '%';
      $('updatePct').textContent = p + '%';
    }
  }
  if (app) {
    app.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'info') {
        appVersion = m.version;
        selfUpdates = m.updates === true;
        showVersion();
        $('aboutCheck').hidden = !selfUpdates;
        const seen = store.get('seenVersion');
        store.set('seenVersion', appVersion);
        if (selfUpdates && !updateReady && seen && seen !== appVersion) {
          showNote(`Updated to v${appVersion}`);
          versionTimer = setTimeout(() => showNote(''), 4000);
        }
      } else if (m.type === 'updateStatus' && selfUpdates) {
        if (m.state === 'available') return showReady();
        showNote(m.state === 'latest' ? 'Up to date' : 'Couldn’t check');
        versionTimer = setTimeout(() => showNote(''), 2500);
      } else if (m.type === 'update' && selfUpdates) {
        if (m.state === 'available') showReady();
        showUpdate(m);
      }
    };
    $('updateGo').addEventListener('click', () => { showUpdate({ state: 'downloading', progress: 0 }); toApp({ type: 'installUpdate' }); });
    $('updateLater').addEventListener('click', () => { $('updateCard').hidden = true; });
    $('aboutCheck').addEventListener('click', () => {
      // The update's card is on the main screen, behind About.
      if (updateReady) { $('updateCard').hidden = false; $('aboutPage').close(); return; }
      showNote('Checking…');
      toApp({ type: 'checkUpdate' });
    });
  }

  // ---- About ----
  $('aboutBtn').addEventListener('click', () => show('aboutPage'));

  // ---- boot ----
  renderMeta();
  showTab(state.tab);
  refreshList();
  toApp({ type: 'hello' });
})();
