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
  async function api(path) {
    const res = await fetch(API + path);
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
  let editing = false;

  // ---- the list ----
  const SORTS = { manual: 'My order', name: 'Name', pct: '% change', change: 'Price change', cap: 'Market cap' };
  const INDEXES = { '^AXJO': 'ASX 200', '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^FTSE': 'FTSE 100', '^N225': 'Nikkei 225' };
  const shortName = s => INDEXES[s] || s.replace(/\.AX$/, '').replace(/-USD$/, '');

  function metricText(q) {
    if (!q) return '–';
    if (state.metric === 'cap') return L.big(q.cap);
    return state.metric === 'pct' ? L.percent(q.pct) : L.change(q.change);
  }

  // Yahoo's previous close doesn't always match its own change, and the change is
  // what the headline shows, so the line has to start from there.
  const prevClose = (q, fallback) => (q?.price != null && q?.change != null ? q.price - q.change : fallback);

  function sparkOf(symbol, q) {
    const box = svg('svg', { class: 'spark', viewBox: '0 0 76 34', 'aria-hidden': 'true' });
    const s = sparks[symbol];
    if (!s?.close || s.close.length < 2) return box;
    const prev = prevClose(q, s.prev);
    const l = L.line(s.close, 76, 34, prev);
    if (prev != null) box.append(svg('path', { class: 'base', d: `M0 ${l.y(prev).toFixed(1)}H76` }));
    box.append(svg('path', { class: L.direction(q?.change), d: L.pathOf(l.points) }));
    return box;
  }

  const GRIP = '<svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1 1h16M1 6h16M1 11h16"/></svg>';
  const MINUS = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 6h8"/></svg>';
  // An index has no company name worth repeating, so it says where it's from.
  const PLACES = { '^AXJO': 'Australia', '^GSPC': 'United States', '^IXIC': 'United States', '^DJI': 'United States', '^FTSE': 'United Kingdom', '^N225': 'Japan' };
  const subtitle = (symbol, q) => PLACES[symbol] || q?.name || ' ';

  function renderLists() {
    const chips = state.lists.map((l, i) => {
      const b = el('button', 'market', l.name);
      b.type = 'button';
      b.dataset.list = i;
      b.setAttribute('aria-pressed', String(i === state.at));
      return b;
    });
    const more = el('button', 'market add-list', '+');
    more.type = 'button';
    more.dataset.addList = '1';
    more.setAttribute('aria-label', 'New list');
    $('lists').replaceChildren(...chips, more);
  }

  function renderList() {
    renderLists();
    $('sortBtn').textContent = editing && state.lists.length > 1 ? 'Delete this list' : `Sort: ${SORTS[state.sort]}`;
    $('editBtn').textContent = editing ? 'Done' : 'Edit';
    const order = editing ? list().symbols : L.sorted(list().symbols, quotes, state.sort, shortName);
    if (!order.length) return $('rows').replaceChildren(el('p', 'empty', 'Nothing here yet. Search for a stock to follow it.'));
    $('rows').replaceChildren(...order.map(symbol => {
      const q = quotes[symbol];
      const row = el('div', editing ? 'row editing' : 'row');
      row.dataset.symbol = symbol;
      const who = el('div', 'who');
      who.append(el('b', '', shortName(symbol)), el('small', '', subtitle(symbol, q)));
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
      open.setAttribute('aria-label', `${shortName(symbol)}, ${L.price(q?.price)}, ${L.percent(q?.pct)}`);
      const nums = el('div', 'nums');
      const pill = el('button', 'pill ' + (state.metric === 'cap' ? '' : L.direction(q?.change)), metricText(q));
      pill.type = 'button';
      pill.dataset.metric = '1';
      nums.append(el('p', '', L.price(q?.price)), pill);
      row.append(open, who, sparkOf(symbol, q), nums);
      return row;
    }));
  }

  function renderMeta(text) {
    const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long' }).format(new Date());
    if (text) return ($('meta').textContent = text);
    if (state.tab === 'map' && tiles.length) {
      const { up, down } = L.breadth(tiles, moveOf);
      $('meta').textContent = [`${up} up · ${down} down`, L.marketState(tiles[0].state)].filter(Boolean).join(' · ');
      return;
    }
    const lead = quotes[list().symbols[0]];
    $('meta').textContent = [date, lead ? L.marketState(lead.state) : ''].filter(Boolean).join(' · ');
  }

  async function chunks(symbols, size, fetchPart) {
    const parts = [];
    for (let i = 0; i < symbols.length; i += size) parts.push(symbols.slice(i, i + size));
    return Promise.all(parts.map(fetchPart));
  }

  let lastRefresh = 0;
  async function refreshList() {
    lastRefresh = Date.now();
    const symbols = list().symbols;
    if (!symbols.length) return renderList();
    try {
      const joined = encodeURIComponent(symbols.join(','));
      const [fresh, lines] = await Promise.all([api('quotes?symbols=' + joined), api('sparks?symbols=' + joined).catch(() => ({}))]);
      for (const q of fresh) quotes[q.symbol] = q;
      Object.assign(sparks, lines);
      const all = new Set(state.lists.flatMap(l => l.symbols));
      store.set('quotes', Object.fromEntries([...all].filter(x => quotes[x]).map(x => [x, quotes[x]])));
      store.set('sparks', Object.fromEntries([...all].filter(x => sparks[x]).map(x => [x, sparks[x]])));
      renderMeta();
      if (state.tab === 'list' && !editing) renderList();
    } catch { renderMeta('Offline, showing last prices'); }
  }

  $('rows').addEventListener('click', e => {
    if (e.target.closest('[data-metric]')) {
      state.metric = { pct: 'change', change: 'cap', cap: 'pct' }[state.metric];
      save();
      return renderList();
    }
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      setSymbols(list().symbols.filter(x => x !== drop.dataset.drop));
      return renderList();
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
    const { from, to } = lifted;
    lifted = null;
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

  let sureTimer = 0;
  function unsure() { clearTimeout(sureTimer); delete $('sortBtn').dataset.sure; }

  $('lists').addEventListener('click', e => {
    unsure();
    if (e.target.closest('[data-add-list]')) {
      $('nameBox').value = '';
      show('nameList');
      return;
    }
    const b = e.target.closest('[data-list]');
    if (!b || Number(b.dataset.list) === state.at) return;
    state.at = Number(b.dataset.list);
    editing = false;
    save();
    renderList();
    refreshList();
  });
  $('nameForm').addEventListener('submit', () => {
    const name = $('nameBox').value.trim();
    if (!name) return;
    state.lists.push({ name, symbols: [] });
    state.at = state.lists.length - 1;
    save();
    renderList();
  });
  $('nameList').addEventListener('click', e => { if (e.target.closest('[data-cancel]')) $('nameList').close(); });

  $('sortBtn').addEventListener('click', () => {
    if (editing && state.lists.length > 1) {
      // Two taps, so a stray one can't lose a list.
      if ($('sortBtn').dataset.sure !== '1') {
        $('sortBtn').dataset.sure = '1';
        $('sortBtn').textContent = `Tap again to delete ${list().name}`;
        sureTimer = setTimeout(() => { unsure(); if (editing) renderList(); }, 3000);
        return;
      }
      unsure();
      state.lists.splice(state.at, 1);
      state.at = 0;
      editing = false;
      save();
      renderList();
      return refreshList();
    }
    if (editing) return;
    const order = Object.keys(SORTS);
    state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
    save();
    renderList();
  });
  $('editBtn').addEventListener('click', () => { unsure(); editing = !editing; renderList(); });

  // ---- one stock ----
  const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'ALL'];
  let open = null;       // the symbol on screen
  let plot = null;       // the chart on screen: its points and scale
  let range = '1D';

  function renderFollow() {
    $('followBtn').textContent = following(open) ? 'Following' : 'Follow';
  }

  function renderHeadline(q) {
    $('stockPrice').textContent = q ? L.price(q.price) : '–';
    $('stockCurrency').textContent = q?.currency || '';
    const move = $('stockMove');
    move.textContent = q ? `${L.change(q.change)} (${L.percent(q.pct)})` : '';
    move.className = 'big-move ' + L.direction(q?.change);
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
    const fixed = n => (n == null ? '–' : n.toFixed(2));
    const pairs = [
      ['Open', L.price(q?.open)], ['Prev close', L.price(prevClose(q, q?.prev))],
      ['Volume', L.big(q?.volume)], ['Avg volume', L.big(q?.avgVolume)], ['Market cap', L.big(q?.cap)], ['P/E', fixed(q?.pe)],
      ['EPS', fixed(q?.eps)], ['Yield', q?.yield == null || Number.isNaN(q.yield) ? '–' : `${q.yield.toFixed(2)}%`],
    ];
    $('stats').replaceChildren(...pairs.map(([k, v]) => { const s = el('div', 'stat'); s.append(el('span', '', k), el('b', '', v)); return s; }));
    const e = $('earnings');
    const coming = q?.earnings && q.earnings * 1000 > Date.now();
    e.hidden = !coming;
    if (coming) {
      const line = el('span', '', `Next earnings: ${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }).format(q.earnings * 1000)}${q.earningsEstimate ? ' (estimate)' : ''}`);
      e.replaceChildren(line);
      if (app) {
        const add = el('button', 'tool', 'Add to calendar');
        add.type = 'button';
        add.addEventListener('click', () => toApp({ type: 'calendar', title: `${shortName(q.symbol)} earnings`, time: q.earnings * 1000 }));
        e.append(add);
      }
    }
  }

  // An open stock keeps its price and the day's line current, like the list,
  // though never while a finger is reading the chart.
  async function refreshStock(symbol) {
    let fresh;
    try { [fresh] = await api('quotes?symbols=' + encodeURIComponent(symbol)); } catch { return; }
    if (!fresh || open !== symbol) return;
    quotes[symbol] = fresh;
    renderHeadline(fresh);
    renderStats(fresh);
    if (range === '1D' && !fingers.size) drawChart();
  }

  async function openStock(symbol) {
    open = symbol;
    range = '1D';
    plot = null;
    fingers.clear();
    renderScrub();
    $('chart').querySelector('.chart-note')?.remove();
    const q = quotes[symbol];
    $('stockSymbol').textContent = shortName(symbol);
    $('stockName').textContent = q?.name || '';
    $('chartSvg').replaceChildren();
    $('about').hidden = true;
    $('newsBox').hidden = true;
    renderFollow();
    renderHeadline(q);
    renderStats(q);
    renderRanges();
    show('stock');
    drawChart();
    try {
      const [fresh] = await api('quotes?symbols=' + encodeURIComponent(symbol));
      if (fresh && open === symbol) {
        quotes[symbol] = fresh;
        $('stockName').textContent = fresh.name;
        renderHeadline(fresh);
        renderStats(fresh);
        // A stock not seen before has no change yet, and the day's line starts from it.
        if (!q && range === '1D') drawChart();
      }
    } catch {}
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
        link.append(el('b', '', n.title), el('small', '', `${n.source} · ${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(n.time * 1000)}`));
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
      s.replaceChildren();
      box.append(el('p', 'chart-note', data ? 'No prices for this range' : 'Can’t load the chart'));
      return;
    }
    const values = data.points.map(p => p[1]);
    const hi = Math.max(...values), lo = Math.min(...values);
    // Room for the high and low beside the line, however many digits they have.
    const right = W - Math.max(46, Math.max(L.price(hi).length, L.price(lo).length) * 5.6 + 10);
    const prev = wanted === '1D' ? prevClose(quotes[symbol], data.prev) : null;
    const base = wanted === '1D' ? prev ?? values[0] : values[0];
    const l = L.line(values, right, bottom, prev, 16);
    const way = L.direction(values[values.length - 1] - base);
    const d = L.pathOf(l.points);
    const parts = [];
    parts.push(svg('path', { class: `under ${way}`, d: `${d}L${right} ${bottom}L0 ${bottom}Z` }));
    if (prev != null) parts.push(svg('path', { class: 'base', d: `M0 ${l.y(prev).toFixed(1)}H${right}` }));
    parts.push(svg('path', { class: `plot ${way}`, d }));
    const label = (text, x, y, anchor) => {
      const t = svg('text', { class: 'scale', x, y, 'text-anchor': anchor });
      t.textContent = text;
      parts.push(t);
    };
    for (const v of [hi, lo]) label(L.price(v), W, l.y(v) + 4, 'end');
    const axis = new Intl.DateTimeFormat('en-AU', { timeZone: data.tz, ...(wanted === '1D' ? { hour: 'numeric', minute: '2-digit' } : wanted === '1W' ? { weekday: 'short', day: 'numeric' } : ['1M', '3M', '6M', 'YTD', '1Y'].includes(wanted) ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' }) });
    label(axis.format(data.points[0][0] * 1000), 0, H - 3, 'start');
    label(axis.format(data.points[data.points.length - 1][0] * 1000), right, H - 3, 'end');
    const marks = svg('g');
    parts.push(marks);
    s.replaceChildren(...parts);
    plot = { points: data.points, l, marks, right, bottom, tz: data.tz, range: wanted };
  }

  // One finger reads a point; two compare the points under them.
  const fingers = new Map();
  function pointAt(clientX) {
    const box = $('chart').getBoundingClientRect();
    const i = Math.round(Math.max(0, Math.min(1, (clientX - box.left) / plot.right)) * (plot.points.length - 1));
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
      read.textContent = `${when(m.from[0])} to ${when(m.to[0])}: ${L.change(m.change)} (${L.percent(m.pct)})`;
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
    $('found').replaceChildren();
    show('find');
    $('findBox').focus();
  });
  $('findBox').addEventListener('input', () => {
    clearTimeout(findTimer);
    const q = $('findBox').value.trim();
    if (!q) return $('found').replaceChildren();
    findTimer = setTimeout(async () => {
      let hits;
      try { hits = await api('search?q=' + encodeURIComponent(q)); } catch { hits = null; }
      if ($('findBox').value.trim() !== q) return;
      if (!hits) return $('found').replaceChildren(el('p', 'empty', 'Can’t reach the market.'));
      if (!hits.length) return $('found').replaceChildren(el('p', 'empty', 'Nothing by that name.'));
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
    }, 220);
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
  $('stock').addEventListener('close', () => { open = null; plot = null; });

  // ---- the market map ----
  const MARKETS = { sp500: U.sp500.name, asx: U.asx.name, ndx: U.ndx.name, dow: U.dow.name, world: U.world.name, crypto: 'Crypto', mine: 'My list' };
  const SECTORS = { 'Information Technology': 'Technology', 'Communication Services': 'Communication', 'Consumer Discretionary': 'Discretionary', 'Consumer Staples': 'Staples', 'Health Care': 'Health', 'Real Estate': 'Property' };
  // The same coin again, or pegged to a dollar: neither says anything on a heat map.
  const NOT_COINS = /^(WBTC|BTCB|CBBTC|WETH|WBETH|STETH|WSTETH|WEETH|RETH|AETHWETH|DAI|XAUT|PAXG|[A-Z]*USD[A-Z0-9]?)-USD$/;
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
  function relayout() {
    mixed = state.market === 'mine' && (tiles.some(t => !t.cap) || new Set(tiles.map(t => t.currency)).size > 1);
    map = L.layoutMap(tiles.map(t => ({ ...t, value: sizeOf(t) })), size.w, size.h);
    labelSectors();
  }

  // Each sector's heading says how it did, and the header how the market did.
  function labelSectors() {
    if (!map) return;
    const moved = list => L.heat(L.weightedMove(list, moveOf, t => t.cap || 1), state.period);
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
    size = { w: box.width, h: box.height };
    view = L.clampView(view, size.w, size.h);
    if (tiles.length) relayout();
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
      fit(g.text || g.name, (left + right) / 2, y + (g.h ?? 14) * k / 2, right - left - 4);
    };
    const industryFont = Math.min(13, 9 * k * .74);
    for (const g of map.industries) if (seen(g.x * k + ox, g.y * k + oy, g.w * k, g.h * k)) heading(g, industryFont, 400);
    const sectorFont = Math.min(15, 14 * k * .72);
    for (const s of map.sectors) if (s.head && seen(s.x * k + ox, s.y * k + oy, s.w * k, 14 * k)) heading({ ...s, h: 14 }, sectorFont, 600);

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
    return { x, y: y - 8, w: Math.max(...members.map(t => t.x + t.w)) - x, h: Math.max(...members.map(t => t.y + t.h)) - y + 8 };
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
  });

  function renderLegend() {
    const spread = L.SPREAD[state.period];
    const steps = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1].map(s => s * spread);
    $('legend').replaceChildren(...steps.map(v => {
      const c = L.heat(v, state.period);
      const s = el('span', '', `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : +Math.abs(v).toFixed(1)}%`);
      s.style.background = `rgb(${c})`;
      s.style.color = '#fff';
      return s;
    }));
  }

  function renderMapTools() {
    $('markets').replaceChildren(...Object.entries(MARKETS).map(([id, name]) => {
      const b = el('button', 'market', name);
      b.type = 'button';
      b.dataset.market = id;
      b.setAttribute('aria-pressed', String(id === state.market));
      return b;
    }));
    $('periods').replaceChildren(...Object.entries(PERIODS).map(([id, name]) => {
      const b = el('button', '', name);
      b.type = 'button';
      b.dataset.period = id;
      b.setAttribute('aria-pressed', String(id === state.period));
      return b;
    }));
    $('sizeBtn').textContent = `Size: ${SIZES[state.size]}`;
    $('sizeBtn').hidden = !!U[state.market]?.equal;
    renderLegend();
  }

  function tilesFrom(members, numbers, market) {
    const by = new Map(numbers.map(q => [q.symbol, q]));
    return members.filter(m => by.has(m[0])).map(([symbol, name, sector, industry, label]) => {
      const q = by.get(symbol);
      return { symbol, label: label || symbol.replace(/\.AX$/, '').replace(/-USD$/, ''), name, sector, industry, price: q.price, pct: q.pct, year: q.year, cap: q.cap, volume: q.volume, state: q.state, type: q.type, currency: q.currency, ...(moveCache[market]?.all[symbol] || {}) };
    });
  }

  // Who's in a market, then their numbers in as few calls as the Worker allows.
  // The last map seen goes up straight away, and fresh prices follow.
  async function loadMarket(keep = false) {
    const id = ++loadId, market = state.market;
    if (!keep) {
      const last = store.get('map.' + market);
      cancelAnimationFrame(flying);
      if (Array.isArray(last) && last.length) tiles = last;
      view = { k: 1, x: 0, y: 0 };
      $('fitBtn').hidden = true;
      resize();
      if (tiles.length) relayout();
    }
    $('mapWait').hidden = tiles.length > 0;
    $('mapWait').textContent = 'Loading the market…';
    try {
      let members, numbers;
      if (market === 'crypto') {
        // Wrapped and pegged coins are left out.
        // Yahoo tells some coins apart with a number: HYPE32196-USD is HYPE.
        const coin = q => q.symbol.replace(/\d+-USD$/, '-USD');
        numbers = (await api('crypto')).filter(q => /^[A-Z]{1,8}-USD$/.test(coin(q)) && !NOT_COINS.test(coin(q)));
        members = numbers.map(q => [q.symbol, q.name.replace(/ USD$/, ''), 'Crypto', 'Crypto', coin(q).replace('-USD', '')]);
      } else if (market === 'mine') {
        const own = list().symbols.filter(x => !x.startsWith('^'));
        numbers = own.length ? await api('quotes?symbols=' + encodeURIComponent(own.join(','))) : [];
        members = numbers.map(q => [q.symbol, q.name, q.type === 'CRYPTOCURRENCY' ? 'Crypto' : 'Stocks', q.exchange || 'Stocks']);
      } else {
        members = U[market].members;
        const parts = await chunks(members.map(m => m[0]), 100, part => api('quotes?symbols=' + encodeURIComponent(part.join(','))));
        numbers = parts.flat();
      }
      if (id !== loadId) return;
      tiles = tilesFrom(members, numbers, market);
      store.set('map.' + market, tiles);
      relayout();
      renderPeek();
      $('mapWait').hidden = map.tiles.length > 0;
      if (!map.tiles.length) $('mapWait').textContent = market === 'mine' ? 'Follow some stocks to see them here.' : 'No prices for this market right now.';
      if (state.period === 'week' || state.period === 'month') loadMoves();
    } catch {
      if (id !== loadId) return;
      if (tiles.length) renderMeta('Offline, showing last prices');
      else { $('mapWait').hidden = false; $('mapWait').textContent = 'Can’t reach the market. Try again in a moment.'; }
    }
  }

  // The week's and month's moves take more calls, so they come only when asked for.
  async function loadMoves() {
    const market = state.market;
    const had = moveCache[market];
    if (market !== 'mine' && had && Date.now() - had.at < 1800e3) return;
    const symbols = tiles.map(t => t.symbol);
    const parts = await chunks(symbols, 100, part => api('moves?symbols=' + encodeURIComponent(part.join(',')))).catch(() => []);
    const all = Object.assign({}, ...parts);
    if (!parts.length) return;
    moveCache[market] = { at: Date.now(), all };
    if (market !== state.market) return;
    tiles = tiles.map(t => ({ ...t, ...(all[t.symbol] || {}) }));
    relayout();
    renderPeek();
  }

  $('markets').addEventListener('click', e => {
    const b = e.target.closest('[data-market]');
    if (!b || b.dataset.market === state.market) return;
    state.market = b.dataset.market;
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
  $('sizeBtn').addEventListener('click', () => {
    const order = Object.keys(SIZES);
    state.size = order[(order.indexOf(state.size) + 1) % order.length];
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
      if (!store.get('seenMapHint')) $('mapHint').hidden = false;
    }
    else renderList();
    renderMeta();
  }
  $('tabList').addEventListener('click', () => showTab('list'));
  $('tabMap').addEventListener('click', () => showTab('map'));

  new ResizeObserver(() => { if (state.tab === 'map') resize(); }).observe(stage);
  if (document.fonts) document.fonts.ready.then(request);

  // Fresh prices while the screen is on, and on coming back to it.
  function refresh() {
    refreshList();
    if (open) refreshStock(open);
    if (state.tab === 'map' && !gesture && !touches.size) loadMarket(true);
  }
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastRefresh > 20000) refresh();
  });

  // ---- Android app bridge (absent in a browser) ----
  function show(id) { if (!$(id).open) $(id).showModal(); tellBack(); }
  const openDialog = () => [...document.querySelectorAll('dialog[open]')].pop();
  function toApp(msg) {
    if (!app) return;
    try { app.postMessage(JSON.stringify(msg)); } catch {}
  }
  function haptic(kind = 'tap') { toApp({ type: 'haptic', kind }); }
  // Android Back closes whatever's open. After that it leaves the app.
  window.bourseBack = () => {
    const d = openDialog();
    if (d) { d.close(); return true; }
    return false;
  };
  function tellBack() { toApp({ type: 'back', enabled: !!openDialog() }); }

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
