// Bourse's pure logic: number formats, chart maths and the market map's layout and
// colours. No DOM, so it runs in the page and under `node --test`.
(function (root) {
  const dash = '–';

  function price(n, currency) {
    if (n == null || Number.isNaN(n)) return dash;
    // A coin worth a fraction of a cent still needs its digits.
    if (n !== 0 && Math.abs(n) < 0.01) return n.toLocaleString('en-AU', { maximumSignificantDigits: 4 });
    const digits = Math.abs(n) >= 1 || n === 0 ? 2 : 4;
    const text = n.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return currency === 'crypto' ? `$${text}` : text;
  }
  const signed = (n, text) => (n > 0 ? '+' : n < 0 ? '−' : '') + text;
  const change = n => (n == null || Number.isNaN(n) ? dash : signed(n, price(Math.abs(n))));
  const percent = n => (n == null || Number.isNaN(n) ? dash : signed(n, `${Math.abs(n).toFixed(2)}%`));

  // 5,001,541,320,704 is 5.00T.
  const UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  function big(n) {
    if (n == null || Number.isNaN(n)) return dash;
    const a = Math.abs(n);
    for (let i = 0; i < UNITS.length; i++) {
      const [size, mark] = UNITS[i], digits = a / size >= 100 ? 1 : 2;
      if (a < size) continue;
      // Just under the next unit rounds up into it: 999.96M is 1.00B, not 1000.0M.
      if (i && +(a / size).toFixed(digits) >= 1000) return `${(n / UNITS[i - 1][0]).toFixed(2)}${UNITS[i - 1][1]}`;
      return `${(n / size).toFixed(digits)}${mark}`;
    }
    return Math.round(a) >= 1000 ? `${(n / 1e3).toFixed(2)}K` : String(Math.round(n));
  }

  const direction = n => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

  // Where a value sits between two others, from 0 to 1, for the range bars.
  function rangeAt(value, low, high) {
    if (value == null || low == null || high == null || high <= low) return null;
    return Math.max(0, Math.min(1, (value - low) / (high - low)));
  }

  // How a group did overall: bigger companies count for more, as in an index.
  function weightedMove(list, moveOf, sizeOf) {
    let sum = 0, weight = 0;
    for (const t of list) {
      const m = moveOf(t), w = sizeOf(t);
      if (m == null || Number.isNaN(m) || !(w > 0)) continue;
      sum += m * w;
      weight += w;
    }
    return weight ? sum / weight : null;
  }

  function breadth(list, moveOf) {
    let up = 0, down = 0;
    for (const t of list) {
      const m = moveOf(t);
      if (m > 0) up++;
      else if (m < 0) down++;
    }
    return { up, down };
  }

  // Moves a symbol to a new place in a list, for dragging rows.
  function moved(list, from, to) {
    const out = [...list];
    out.splice(to, 0, ...out.splice(from, 1));
    return out;
  }

  // What the state of a market reads as.
  function marketState(state) {
    return { REGULAR: 'Open', PRE: 'Pre-market', PREPRE: 'Closed', POST: 'After hours', POSTPOST: 'Closed', CLOSED: 'Closed' }[state] || '';
  }

  // Sorting a list: 'manual' keeps the player's own order.
  function sorted(symbols, quotes, by, nameOf = s => s) {
    if (by === 'manual') return symbols;
    const q = s => quotes[s] || {};
    const value = { name: nameOf, change: s => -(q(s).change ?? -Infinity), pct: s => -(q(s).pct ?? -Infinity), cap: s => -(q(s).cap ?? -Infinity) }[by];
    return [...symbols].sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0));
  }

  // ---- charts ----

  // A line through values in a box, with `base` (the day's opening reference) kept in view.
  function line(values, width, height, base, pad = 3) {
    const all = base == null ? values : [...values, base];
    const lo = Math.min(...all), hi = Math.max(...all);
    const span = hi - lo || 1;
    const y = v => pad + (height - pad * 2) * (1 - (v - lo) / span);
    const x = i => (values.length < 2 ? 0 : (i / (values.length - 1)) * width);
    return { y, x, points: values.map((v, i) => [x(i), y(v)]) };
  }
  const pathOf = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

  // The move between two points on a chart, for comparing with two fingers.
  function between(a, b) {
    const [from, to] = a[0] <= b[0] ? [a, b] : [b, a];
    return { from, to, change: to[1] - from[1], pct: (to[1] / from[1] - 1) * 100 };
  }

  // ---- the market map ----

  // Squarified treemap: fills a box with rectangles whose areas match `value`,
  // keeping them as close to square as the numbers allow.
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total || w <= 0 || h <= 0) return [];
    const scale = (w * h) / total;
    const rest = [...items].sort((a, b) => b.value - a.value).map(item => ({ item, area: item.value * scale }));
    const out = [];
    let box = { x, y, w, h };
    const worst = (row, side) => {
      const sum = row.reduce((s, r) => s + r.area, 0);
      let max = 0, min = Infinity;
      for (const r of row) { max = Math.max(max, r.area); min = Math.min(min, r.area); }
      return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    };
    while (rest.length) {
      const side = Math.min(box.w, box.h);
      const row = [rest[0]];
      let i = 1;
      while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
      rest.splice(0, row.length);
      const sum = row.reduce((s, r) => s + r.area, 0);
      if (box.w >= box.h) {
        const cw = sum / box.h;
        let cy = box.y;
        for (const r of row) { const ch = r.area / cw; out.push({ item: r.item, x: box.x, y: cy, w: cw, h: ch }); cy += ch; }
        box = { x: box.x + cw, y: box.y, w: box.w - cw, h: box.h };
      } else {
        const ch = sum / box.w;
        let cx = box.x;
        for (const r of row) { const cw = r.area / ch; out.push({ item: r.item, x: cx, y: box.y, w: cw, h: ch }); cx += cw; }
        box = { x: box.x, y: box.y + ch, w: box.w, h: box.h - ch };
      }
    }
    return out;
  }

  const groupBy = (list, key) => {
    const groups = new Map();
    for (const t of list) (groups.get(t[key]) || groups.set(t[key], []).get(t[key])).push(t);
    return [...groups].map(([name, tiles]) => ({ name, tiles, value: tiles.reduce((s, t) => s + t.value, 0) }));
  };

  // Lays a market out: sectors, then industries, then stocks. `tiles` carry a
  // `value` for their size. Headers take a strip off the top of each group.
  function layoutMap(tiles, width, height, { sectorHead = 14, industryHead = 9, gap = 1 } = {}) {
    const live = tiles.filter(t => t.value > 0);
    const out = { tiles: [], sectors: [], industries: [], width, height };
    for (const s of squarify(groupBy(live, 'sector'), 0, 0, width, height)) {
      const sector = { name: s.item.name, x: s.x, y: s.y, w: s.w, h: s.h };
      out.sectors.push(sector);
      // A sector too thin for a heading gives the room to its stocks.
      sector.head = s.h >= sectorHead * 2 ? sectorHead : 0;
      const inner = { x: s.x + gap, y: s.y + sector.head, w: Math.max(1, s.w - gap * 2), h: Math.max(1, s.h - sector.head - gap) };
      const groups = groupBy(s.item.tiles, 'industry');
      for (const g of squarify(groups, inner.x, inner.y, inner.w, inner.h)) {
        // A lone industry, or one too small for a heading, gives the space to its stocks.
        const headed = groups.length > 1 && g.h > industryHead * 2.5 && g.w > 20;
        const top = headed ? industryHead : 0;
        if (headed) out.industries.push({ name: g.item.name, sector: s.item.name, x: g.x, y: g.y, w: g.w, h: top });
        for (const t of squarify(g.item.tiles, g.x + gap / 2, g.y + top + gap / 2, Math.max(.5, g.w - gap), Math.max(.5, g.h - top - gap))) {
          // Never nothing, or a stock could never be tapped.
          out.tiles.push({ ...t.item, x: t.x, y: t.y, w: Math.max(.3, t.w - gap / 2), h: Math.max(.3, t.h - gap / 2) });
        }
      }
    }
    return out;
  }

  // How far a colour goes for each period: a 3% day is as strong as a 40% year.
  const SPREAD = { day: 3, week: 6, month: 10, year: 40 };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  // The map is dark in both themes, so white text reads on every square.
  const FLAT = [62, 68, 80], UP = [44, 206, 92], DOWN = [240, 54, 58], BLANK = [40, 46, 54];
  function heat(pct, period) {
    if (pct == null || Number.isNaN(pct)) return BLANK;
    const t = Math.min(1, Math.abs(pct) / SPREAD[period]) ** 0.8;
    return mix(FLAT, pct >= 0 ? UP : DOWN, t);
  }
  // A heading's band: its group's colour, sunk towards the background.
  const band = (colour, depth = 0.5) => mix(colour, [14, 20, 18], depth);

  // The biggest text that fits a square: the symbol with its move under it, or
  // just the symbol on a square too small for both, or nothing.
  const SMALLEST = 4.5, LARGEST = 24;
  function tileText(label, move, w, h) {
    const across = text => (w - 3) / (Math.max(text.length, 2) * 0.62);
    const two = Math.min(LARGEST, across(label), across(move) / 0.86, (h - 2) / 2.05);
    if (two >= SMALLEST) return { size: two, moveSize: two * 0.86, both: true };
    const one = Math.min(LARGEST, across(label), (h - 2) / 1.1);
    return one >= SMALLEST ? { size: one, both: false } : null;
  }

  // Keeps a pan and zoom on the map: never smaller than the whole, never off its edge.
  function clampView(view, width, height, maxZoom = 40) {
    const k = Math.max(1, Math.min(maxZoom, view.k));
    return { k, x: Math.min(0, Math.max(width - width * k, view.x)), y: Math.min(0, Math.max(height - height * k, view.y)) };
  }
  // The view after zooming by `factor` around a point on screen.
  function zoomAt(view, factor, px, py, width, height) {
    const k = Math.max(1, Math.min(40, view.k * factor));
    const f = k / view.k;
    return clampView({ k, x: px - (px - view.x) * f, y: py - (py - view.y) * f }, width, height);
  }
  // The view that fills the screen with a box.
  function viewOf(box, width, height) {
    const k = Math.min(width / box.w, height / box.h);
    return clampView({ k, x: -box.x * k + (width - box.w * k) / 2, y: -box.y * k + (height - box.h * k) / 2 }, width, height);
  }

  const lib = { price, change, percent, big, direction, rangeAt, weightedMove, breadth, moved, marketState, sorted, line, pathOf, between, squarify, layoutMap, heat, band, tileText, clampView, zoomAt, viewOf, SPREAD };
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.BourseLib = lib;
})(this);
