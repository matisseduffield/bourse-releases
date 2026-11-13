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
  // A date or time where a price traded, so the header and a stock agree.
  function inZone(q, opts) {
    const say = timeZone => new Intl.DateTimeFormat('en-AU', { timeZone, ...opts }).format(q.time * 1000);
    try { return say(q.tz); } catch { return say(undefined); }
  }
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
    return state.metric === 'pct' ? L.percent(q.pct) : L.change(q.change, q.price);
  }

  // Yahoo's previous close doesn't always match its own change, and the change is
  // what the headline shows, so the line has to start from there.
  const prevClose = (q, fallback) => (q?.price != null && q?.change != null ? q.price - q.change : fallback);

  function sparkOf(symbol, q) {
    const box = svg('svg', { class: 'spark', viewBox: '0 0 76 34', 'aria-hidden': 'true' });
    const s = sparks[symbol];
    if (!s?.close || s.close.length < 2) return box;
    const prev = prevClose(q, s.prev);
    const l = L.line(s.close, 76, 34, prev, 3, L.across(s.times, s.session));
    if (prev != null) box.append(svg('path', { class: 'base', d: `M0 ${l.y(prev).toFixed(1)}H76` }));
    box.append(svg('path', { class: L.direction(q?.change), d: L.pathOf(l.points) }));
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
    name(open, `${shortName(symbol)}, ${L.price(q?.price)}, ${old ? `last price ${old}` : L.percent(q?.pct)}`);
    put(who.lastChild, subtitle(symbol, q));
    row.replaceChild(sparkOf(symbol, q), spark);
    put(nums.firstChild, L.price(q?.price));
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
      const ask = route => chunks(symbols, 100, part => api(`${route}?symbols=` + encodeURIComponent(part.join(','))));
      const [parts, lines] = await Promise.all([ask('quotes'), ask('sparks').catch(() => ({ got: [] }))]);
      const fresh = parts.got.flat();
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
    lifted = { id: e.pointerId, row, all, from: all.indexOf(row), to: all.indexOf(row), y: e.clientY, h: row.getBoundingClientRect().height };
  });
  $('rows').addEventListener('pointermove', e => {
    if (!lifted || e.pointerId !== lifted.id) return;
    const { row, all, from, h } = lifted;
    const dy = e.clientY - lifted.y;
    row.style.transform = `translateY(${dy}px)`;
    const to = Math.max(0, Math.min(all.length - 1, from + Math.round(dy / h)));
    lifted.to = to;
    all.forEach((r, i) => {
      if (r === row) return;
      const shift = i > from && i <= to ? -h : i < from && i >= to ? h : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });
  function dropRow(e) {
    if (!lifted || e.pointerId !== lifted.id) return;
    const { from, to, all } = lifted;
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

  // Follow is the thing to do, so it's in ink; Following is only a state.
  function renderFollow() {
    $('followBtn').textContent = following(open) ? 'Following' : 'Follow';
    $('followBtn').classList.toggle('ink', !following(open));
  }

  function renderHeadline(q) {
    $('stockPrice').textContent = q ? L.price(q.price) : '–';
    $('stockCurrency').textContent = q?.currency || '';
    const move = $('stockMove');
    // The figure follows the chart: the day's move on 1D, and on a longer
    // range the move from that chart's first price, named so it isn't mistaken for today's.
    const far = q && rangeBase && rangeBase.symbol === open && rangeBase.range === range ? L.moveOver(rangeBase.base, q.price) : null;
    const m = far || (q ? { change: q.change, pct: q.pct } : null);
    move.replaceChildren(...(m ? [`${L.change(m.change, q.price)} (${L.percent(m.pct)})`, ...(far ? [el('span', 'move-span', L.spanName(range))] : [])] : []));
    move.className = 'big-move ' + L.direction(m?.change);
    // A saved price that couldn't be refreshed says when it's from, not whether its market is open.
    if (q && !current(q, 'stock')) { $('stockAfter').textContent = q.time ? `Last price, ${inZone(q, { day: 'numeric', month: 'short' })} ${inZone(q, { hour: 'numeric', minute: '2-digit' })}` : ''; return; }
    const extra = q?.state?.startsWith('POST') ? q.post : q?.state?.startsWith('PRE') ? q.pre : null;
    const label = q?.state?.startsWith('POST') ? 'After hours' : 'Pre-market';
    $('stockAfter').textContent = extra?.price != null ? `${label}: ${L.price(extra.price)} (${L.percent(extra.pct)})` : `${L.marketState(q?.state)}${q?.delay ? `, delayed ${q.delay} min` : ''}`;
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
      ends.append(el('span', '', L.price(low)), el('span', '', L.price(high)));
      wrap.append(line, ends);
      row.append(el('span', '', label), wrap);
      return row;
    };
    $('bands').replaceChildren(...[bar('Today', q?.low, q?.high), bar('52 weeks', q?.low52, q?.high52)].filter(Boolean));
    const fixed = n => (n == null || Number.isNaN(n) ? '–' : n.toFixed(2));
    const coming = q?.earnings && q.earnings * 1000 > Date.now();
    const day = coming ? L.dayIn(q.earnings, q.tz) : null;
    const pairs = [
      ['Open', L.price(q?.open)], ['Prev close', L.price(prevClose(q, q?.prev))],
      ['Volume', L.big(q?.volume)], ['Avg volume', L.big(q?.avgVolume)], ['Market cap', L.big(q?.cap)], ['P/E', fixed(q?.pe)],
      ['EPS', fixed(q?.eps)], ['Yield', q?.yield == null || Number.isNaN(q.yield) ? '–' : `${q.yield.toFixed(2)}%`],
      ['Earnings', day ? `${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(day)}${q.earningsEstimate ? ' est.' : ''}` : '–'],
    ];
    // A figure Yahoo doesn't have, like an index's P/E, is left out rather than shown as a dash.
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
  function renderMiss(missing) {
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
    fingers.clear();
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
      } else if (open === symbol && !quotes[symbol]) renderMiss(true);
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

  // Dates are the exchange's own, or Friday's close reads as Saturday in Sydney.
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
    if (!data || data.points.length < 2) {
      plot = null;
      rangeBase = null;
      renderHeadline(quotes[symbol]);
      s.replaceChildren();
      box.append(el('p', 'chart-note', data ? 'No prices for this range' : 'Can’t load the chart'));
      return;
    }
    const values = data.points.map(p => p[1]);
    const hi = Math.max(...values), lo = Math.min(...values);
    rangeBase = wanted === '1D' ? null : { symbol, range: wanted, base: values[0] };
    renderHeadline(quotes[symbol]);
    // Room for the high and low beside the line, however many digits they have.
    const right = W - Math.max(46, Math.max(L.price(hi).length, L.price(lo).length) * 5.6 + 10);
    const prev = wanted === '1D' ? prevClose(quotes[symbol], data.prev) : null;
    const base = wanted === '1D' ? prev ?? values[0] : values[0];
    // A day still trading fills only its share of the width.
    const at = wanted === '1D' ? L.across(data.points.map(p => p[0]), data.session) : null;
    const l = L.line(values, right, bottom, prev, 16, at);
    const way = L.direction(values[values.length - 1] - base);
    const d = L.pathOf(l.points);
    const first = l.points[0][0], last = l.points[l.points.length - 1][0];
    const parts = [];
    parts.push(svg('path', { class: `under ${way}`, d: `${d}L${last.toFixed(1)} ${bottom}L${first.toFixed(1)} ${bottom}Z` }));
    if (prev != null) parts.push(svg('path', { class: 'base', d: `M0 ${l.y(prev).toFixed(1)}H${right}` }));
    parts.push(svg('path', { class: `plot ${way}`, d }));
    const label = (text, x, y, anchor) => {
      const t = svg('text', { class: 'scale', x, y, 'text-anchor': anchor });
      t.textContent = text;
      parts.push(t);
    };
    for (const v of [hi, lo]) label(L.price(v), W, l.y(v) + 4, 'end');
    const axis = new Intl.DateTimeFormat('en-AU', { timeZone: data.tz, ...(wanted === '1D' ? { hour: 'numeric', minute: '2-digit' } : wanted === '1W' ? { weekday: 'short', day: 'numeric' } : ['1M', '6M', '1Y'].includes(wanted) ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' }) });
    const [from, to] = at ? data.session : [data.points[0][0], data.points[data.points.length - 1][0]];
    label(axis.format(from * 1000), 0, H - 3, 'start');
    label(axis.format(to * 1000), right, H - 3, 'end');
    const marks = svg('g');
    parts.push(marks);
    s.replaceChildren(...parts);
    plot = { points: data.points, l, marks, right, bottom, tz: data.tz, range: wanted };
  }

  // One finger reads a point; two compare the points under them.
  const fingers = new Map();
  function pointAt(clientX) {
    const x = clientX - $('chart').getBoundingClientRect().left;
    // The nearest point to the finger: points aren't evenly spaced on a day still trading.
    let i = 0;
    plot.l.points.forEach(([px], j) => { if (Math.abs(px - x) < Math.abs(plot.l.points[i][0] - x)) i = j; });
    return { i, x: plot.l.points[i][0], y: plot.l.points[i][1], p: plot.points[i] };
  }
  function renderScrub() {
    if (!plot) { $('readout').hidden = true; return; }
    const at = [...fingers.values()].slice(0, 2).map(pointAt);
    const read = $('readout');
    plot.marks.replaceChildren();
    read.hidden = !at.length;
    for (const m of at) {
      plot.marks.append(svg('path', { class: 'mark', d: `M${m.x.toFixed(1)} 0V${plot.bottom}` }), svg('circle', { class: 'dot', cx: m.x, cy: m.y, r: 3.5 }));
    }
    if (at.length === 1) read.textContent = `${when(at[0].p[0])}: ${L.price(at[0].p[1])}`;
    if (at.length === 2) {
      const m = L.between(at[0].p, at[1].p);
      const [a, b] = at[0].x < at[1].x ? at : [at[1], at[0]];
      plot.marks.prepend(svg('rect', { class: 'band', x: a.x, y: 0, width: b.x - a.x, height: plot.bottom }));
      read.textContent = `${when(m.from[0])} to ${when(m.to[0])}: ${L.change(m.change, m.to[1])} (${L.percent(m.pct)})`;
    }
  }
  const chartBox = $('chart');
  chartBox.addEventListener('pointerdown', e => {
    if (!plot) return;
    chartBox.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, e.clientX);
    renderScrub();
  });
  chartBox.addEventListener('pointermove', e => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, e.clientX);
    renderScrub();
  });
  for (const type of ['pointerup', 'pointercancel']) chartBox.addEventListener(type, e => {
    fingers.delete(e.pointerId);
    renderScrub();
  });

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
  const PLUS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 2v12M2 8h12"/></svg>';
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
  function relayout() {
    laidFresh = fresh;
    mixed = state.market === 'mine' && (tiles.some(t => !t.cap) || new Set(tiles.map(t => t.currency)).size > 1);
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
      // A square half off the screen keeps its name on the half that shows.
      const cx = (Math.max(x, 0) + Math.min(x + w, W)) / 2, cy = (Math.max(y, 0) + Math.min(y + h, H)) / 2;
      ctx.font = `600 ${text.size}px "Hanken Grotesk", sans-serif`;
      if (!text.both) { ctx.fillText(t.label, cx, cy); continue; }
      ctx.fillText(t.label, cx, cy - text.size * .52);
      ctx.font = `400 ${text.moveSize}px "Hanken Grotesk", sans-serif`;
      ctx.fillText(t.moveText, cx, cy + text.size * .56);
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
    $('peekPrice').textContent = L.price(t.price);
    const line = $('peekMove');
    line.textContent = [L.percent(move), PERIODS[state.period].toLowerCase(), t.cap ? `· ${L.big(t.cap)}` : ''].filter(Boolean).join(' ');
    line.className = L.direction(move);
  }
  function pick(symbol) {
    if (symbol) haptic();
    picked = symbol;
    renderPeek();
    request();
    tellBack();
    // Said once per pick, not on every refresh of the card.
    $('mapSay').textContent = picked ? `${$('peekSymbol').textContent}, ${$('peekName').textContent}, ${$('peekPrice').textContent}, ${$('peekMove').textContent}` : '';
  }
  $('peek').addEventListener('click', () => { if (picked) openStock(picked); });

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
    if (found.tile) return pick(found.tile.symbol);
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
      s.style.color = '#fff';
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
    $('sizeWrap').hidden = !!U[state.market]?.equal;
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

  // Who's in a market, then their numbers in as few calls as the Worker allows.
  // The last map seen goes up straight away, and fresh prices follow.
  async function loadMarket(keep = false) {
    const id = ++loadId, market = state.market;
    last.map = Date.now();
    if (!keep) {
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
      let members, numbers, missed = new Set();
      if (market === 'crypto') {
        // Wrapped and pegged coins are left out.
        // Yahoo tells some coins apart with a number: HYPE32196-USD is HYPE.
        const coin = q => q.symbol.replace(/\d+-USD$/, '-USD');
        numbers = (await api('crypto')).filter(q => /^[A-Z]{1,8}-USD$/.test(coin(q)) && !NOT_COINS.test(coin(q)));
        members = numbers.map(q => [q.symbol, q.name.replace(/ USD$/, ''), 'Crypto', 'Crypto', coin(q).replace('-USD', '')]);
      } else if (market === 'mine') {
        const own = list().symbols.filter(x => !x.startsWith('^'));
        const parts = await chunks(own, 100, part => api('quotes?symbols=' + encodeURIComponent(part.join(','))));
        numbers = parts.got.flat();
        missed = parts.missed;
        members = numbers.map(q => [q.symbol, q.name, q.type === 'CRYPTOCURRENCY' ? 'Crypto' : 'Stocks', EXCHANGES[q.exchange] || q.exchange || 'Stocks']);
        // A batch that failed keeps the squares it had.
        members.push(...tiles.filter(t => missed.has(t.symbol)).map(t => [t.symbol, t.name, t.sector, t.industry]));
      } else {
        members = U[market].members;
        const parts = await chunks(members.map(m => m[0]), 100, part => api('quotes?symbols=' + encodeURIComponent(part.join(','))));
        numbers = parts.got.flat();
        missed = parts.missed;
      }
      if (id !== loadId) return;
      tiles = tilesFrom(members, numbers, market, tiles, missed);
      fresh = true;
      setStale('map', false);
      store.set(mapKey(market), tiles);
      if (keep) update();
      else relayout();
      // A square gone from the market takes its card, and Back's hold, with it.
      if (picked && !tiles.some(t => t.symbol === picked)) pick(null);
      renderPeek();
      $('mapWait').hidden = map.tiles.length > 0;
      if (!map.tiles.length) $('mapWait').textContent = market === 'mine' ? 'Follow some stocks to see them here.' : 'No prices for this market right now.';
      if (state.period === 'week' || state.period === 'month') loadMoves();
    } catch {
      if (id !== loadId) return;
      setStale('map', true);
      if (!tiles.length) { $('mapWait').hidden = false; $('mapWait').textContent = 'Can’t reach the market. Try again in a moment.'; }
    } finally { busy.map--; }
  }

  // The week's and month's moves take more calls, so they come only when asked for.
  async function loadMoves() {
    const market = state.market;
    const had = moveCache[market];
    if (market !== 'mine' && had && Date.now() - had.at < 1800e3) return;
    const symbols = tiles.map(t => t.symbol);
    const parts = await chunks(symbols, 100, part => api('moves?symbols=' + encodeURIComponent(part.join(',')))).catch(() => null);
    if (!parts) return;
    const all = Object.assign({}, had?.all, ...parts.got);
    // A batch that failed is asked for again on the next refresh.
    moveCache[market] = { at: parts.missed.size ? 0 : Date.now(), all };
    if (market !== state.market) return;
    tiles = tiles.map(t => ({ ...t, ...(all[t.symbol] || {}) }));
    update();
    renderPeek();
  }

  // Another list is another map: the squares on screen belong to the list just left.
  function otherList() {
    if (state.market !== 'mine') return;
    tiles = [];
    map = null;
    pick(null);
  }
  $('marketPick').addEventListener('change', () => {
    if ($('marketPick').value === state.market) return;
    state.market = $('marketPick').value;
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
      if (!store.get('seenMapHint')) $('mapHint').hidden = false;
    }
    else renderList();
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(20000); });

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
    const d = openDialog();
    if (d) { d.close(); return true; }
    if (mapPicked()) { pick(null); return true; }
    return false;
  };
  function tellBack() { toApp({ type: 'back', enabled: !!openDialog() || mapPicked() }); }

  // selfUpdates is off until the app says otherwise: Play builds update through
  // the store, so there the version is a plain label with nothing to tap.
  let appVersion = '', selfUpdates = false, updateReady = false, versionTimer = 0, updateVersion = '', updateSize = 0;
  function showVersion(text, st) {
    clearTimeout(versionTimer);
    $('version').hidden = false;
    $('version').textContent = text;
    $('version').dataset.state = st || '';
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
        $('version').disabled = !selfUpdates;
        if (!selfUpdates) $('version').removeAttribute('title');
        const seen = store.get('seenVersion');
        store.set('seenVersion', appVersion);
        if (selfUpdates && !updateReady && seen && seen !== appVersion) {
          showVersion(`Updated to v${appVersion}`, 'available');
          versionTimer = setTimeout(() => showVersion(`v${appVersion}`), 4000);
        } else if (!updateReady) showVersion(`v${appVersion}`);
      } else if (m.type === 'updateStatus' && selfUpdates) {
        if (m.state === 'available') { updateReady = true; return showVersion('Update available', 'available'); }
        showVersion(m.state === 'latest' ? 'Up to date' : 'Couldn’t check');
        versionTimer = setTimeout(() => showVersion(`v${appVersion}`), 2500);
      } else if (m.type === 'update' && selfUpdates) {
        if (m.state === 'available') { updateReady = true; showVersion('Update available', 'available'); }
        showUpdate(m);
      }
    };
    $('updateGo').addEventListener('click', () => { showUpdate({ state: 'downloading', progress: 0 }); toApp({ type: 'installUpdate' }); });
    $('updateLater').addEventListener('click', () => { $('updateCard').hidden = true; });
    $('version').addEventListener('click', () => {
      if (updateReady) { $('updateCard').hidden = false; return; }
      showVersion('Checking…');
      toApp({ type: 'checkUpdate' });
    });
  }

  // ---- boot ----
  renderMeta();
  showTab(state.tab);
  refreshList();
  toApp({ type: 'hello' });
})();
