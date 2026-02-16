import {
  RANKS, SUITS, SUIT_SYM, HAND_NAMES,
  cid, crank, csuit, cstr,
  bestHand, score5, handName,
  parseRange, addCombo, filterCombos,
  calcRangeEquity, calcOuts
} from './engine.js';

// ═══════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════
const S = {
  hand: [null,null],
  board: [null,null,null,null,null],
  players: 2,
  currentSlot: null,
  pickerSuit: null,
  activeTab: 'manual',
  gridState: {},
  lastAIRange: null
};

function getKnownCards() {
  return [...S.hand,...S.board].filter(c=>c!==null);
}

// ═══════════════════════════════════════════════════
// RANGE INPUT
// ═══════════════════════════════════════════════════
function onRangeInput() {
  const str = document.getElementById('range-input').value;
  const {combos, errors} = parseRange(str);
  const errEl = document.getElementById('range-error');
  if (errors.length) {
    errEl.style.display = 'block';
    errEl.textContent = `Unknown tokens: ${errors.join(', ')}`;
  } else {
    errEl.style.display = 'none';
  }
  document.getElementById('combo-count-manual').textContent = combos.length + ' combos';
  syncGridFromText();
}

function setRange(str) {
  document.getElementById('range-input').value = str;
  onRangeInput();
}

function getRangeCombos() {
  if (S.activeTab === 'grid') {
    return getGridCombos();
  }
  const str = document.getElementById('range-input').value;
  const {combos} = parseRange(str);
  return combos;
}

// ═══════════════════════════════════════════════════
// RANGE GRID (13x13 hand matrix)
// ═══════════════════════════════════════════════════
const GRID_RANKS = [...RANKS].reverse();

function initRangeGrid() {
  const grid = document.getElementById('range-grid');
  grid.innerHTML = '';
  for (let ri=0;ri<13;ri++) {
    for (let ci=0;ci<13;ci++) {
      const r1idx = 12-ri;
      const r2idx = 12-ci;
      const hi = Math.max(r1idx,r2idx);
      const lo = Math.min(r1idx,r2idx);
      const cell = document.createElement('div');
      cell.className = 'rg-cell';

      let label, type;
      if (ri===ci) { label=RANKS[r1idx]+RANKS[r2idx]; type='p'; }
      else if (ri>ci) { label=RANKS[hi]+RANKS[lo]+'o'; type='o'; }
      else { label=RANKS[hi]+RANKS[lo]+'s'; type='s'; }

      cell.textContent = label;
      cell.dataset.hi = hi;
      cell.dataset.lo = lo;
      cell.dataset.type = type;
      cell.dataset.key = `${hi},${lo},${type}`;
      cell.onclick = () => toggleGridCell(cell);
      grid.appendChild(cell);
    }
  }
}

function toggleGridCell(cell) {
  const key = cell.dataset.key;
  const active = S.gridState[key];
  S.gridState[key] = active ? null : true;
  updateGridCell(cell);
  const combos = getGridCombos();
  document.getElementById('combo-count-grid').textContent = combos.length + ' combos';
}

function updateGridCell(cell) {
  const key = cell.dataset.key;
  const type = cell.dataset.type;
  const active = S.gridState[key];
  cell.classList.remove('active-pair','active-suited','active-offsuit');
  if (active) {
    if (type==='p') cell.classList.add('active-pair');
    else if (type==='s') cell.classList.add('active-suited');
    else cell.classList.add('active-offsuit');
  }
}

function getGridCombos() {
  const out = new Set();
  for (const [key, active] of Object.entries(S.gridState)) {
    if (!active) continue;
    const [hi,lo,type] = key.split(',');
    const hir=parseInt(hi), lor=parseInt(lo);
    if (type==='p') {
      for (let s1=0;s1<4;s1++) for (let s2=s1+1;s2<4;s2++)
        addCombo(cid(hir,s1),cid(hir,s2),out);
    } else if (type==='s') {
      for (let s=0;s<4;s++) addCombo(cid(hir,s),cid(lor,s),out);
    } else {
      for (let s1=0;s1<4;s1++) for (let s2=0;s2<4;s2++)
        if (s1!==s2) addCombo(cid(hir,s1),cid(lor,s2),out);
    }
  }
  return [...out].map(k=>k.split(',').map(Number));
}

function syncGridFromText() {
  S.gridState = {};
  const str = document.getElementById('range-input').value;
  const {combos} = parseRange(str);
  for (const [c1,c2] of combos) {
    const r1=crank(c1), r2=crank(c2), s1=csuit(c1), s2=csuit(c2);
    const hi=Math.max(r1,r2), lo=Math.min(r1,r2);
    let type;
    if (hi===lo) type='p';
    else if (s1===s2) type='s';
    else type='o';
    S.gridState[`${hi},${lo},${type}`] = true;
  }
  document.querySelectorAll('.rg-cell').forEach(cell => updateGridCell(cell));
  document.getElementById('combo-count-grid').textContent = combos.length + ' combos';
}

// ═══════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════
function switchTab(name, btn) {
  S.activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
}

// ═══════════════════════════════════════════════════
// AI RANGE TRANSLATOR
// ═══════════════════════════════════════════════════
async function translateRange() {
  const desc = document.getElementById('ai-range-input').value.trim();
  if (!desc) return;
  const btn = document.getElementById('ai-translate-btn');
  const resEl = document.getElementById('ai-range-result');
  btn.disabled = true;
  btn.textContent = '...';
  resEl.style.display = 'block';
  document.getElementById('ai-range-text').textContent = 'Generating...';
  document.getElementById('ai-range-reasoning').textContent = '';

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'translate-range',
        description: desc
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    S.lastAIRange = data.range;
    document.getElementById('ai-range-text').textContent = data.range;
    document.getElementById('ai-range-reasoning').textContent = data.reasoning || '';
    const {errors} = parseRange(data.range);
    if (errors.length) {
      document.getElementById('ai-range-reasoning').textContent += ` (${errors.length} tokens unrecognized — will be skipped)`;
    }
  } catch(e) {
    document.getElementById('ai-range-text').textContent = 'Failed: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = '→ Generate';
}

function applyAIRange() {
  if (!S.lastAIRange) return;
  setRange(S.lastAIRange);
  document.querySelectorAll('.tab-btn')[0].click();
}

// ═══════════════════════════════════════════════════
// CARD PICKER
// ═══════════════════════════════════════════════════
function openPicker(el) {
  S.currentSlot = el;
  S.pickerSuit = null;
  document.querySelectorAll('.suit-btn').forEach(b=>b.classList.remove('selected'));
  buildRankGrid();
  document.getElementById('overlay').classList.add('open');
}

function overlayClick(e) {
  if (e.target===document.getElementById('overlay')) closeOverlay();
}

function closeOverlay() {
  document.getElementById('overlay').classList.remove('open');
}

function pickSuit(btn) {
  document.querySelectorAll('.suit-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  S.pickerSuit = btn.dataset.suit;
  buildRankGrid();
}

function buildRankGrid() {
  const grid = document.getElementById('rank-grid');
  const used = new Set(getKnownCards());
  grid.innerHTML = '';
  for (let r=12;r>=0;r--) {
    const btn = document.createElement('button');
    btn.className = 'rank-btn';
    btn.textContent = RANKS[r];
    if (!S.pickerSuit) {
      btn.classList.add('no-suit');
    } else {
      const c = cid(r, SUITS.indexOf(S.pickerSuit));
      if (used.has(c)) btn.classList.add('taken');
      else btn.onclick = () => commitCard(r);
    }
    grid.appendChild(btn);
  }
}

function commitCard(rank) {
  if (!S.currentSlot || !S.pickerSuit) return;
  const c = cid(rank, SUITS.indexOf(S.pickerSuit));
  const g = S.currentSlot.dataset.group;
  const i = parseInt(S.currentSlot.dataset.index);
  if (g==='hand') S.hand[i]=c; else S.board[i]=c;
  renderSlot(S.currentSlot, c);
  closeOverlay();
  updateStreet();
}

function removeCard() {
  if (!S.currentSlot) return;
  const g = S.currentSlot.dataset.group;
  const i = parseInt(S.currentSlot.dataset.index);
  if (g==='hand') S.hand[i]=null; else S.board[i]=null;
  renderSlot(S.currentSlot, null);
  closeOverlay();
  updateStreet();
}

function renderSlot(el, c) {
  if (c===null) {
    el.classList.remove('filled','c-red','c-black');
    el.innerHTML = '<span class="plus-icon">+</span>';
    return;
  }
  const s = csuit(c);
  const isRed = s===1||s===2;
  el.classList.add('filled');
  el.classList.toggle('c-red', isRed);
  el.classList.toggle('c-black', !isRed);
  el.innerHTML = `<div class="card-inner"><span class="c-rank">${RANKS[crank(c)]}</span><span class="c-suit">${SUIT_SYM[SUITS[s]]}</span></div>`;
}

function clearBoard() {
  S.board = [null,null,null,null,null];
  document.querySelectorAll('[data-group="community"]').forEach(el=>renderSlot(el,null));
  updateStreet();
}

function updateStreet() {
  const n = S.board.filter(c=>c!==null).length;
  const labels = {0:'Pre-flop',3:'Flop',4:'Turn',5:'River'};
  const key = n>=3 ? (n>=5?5:n) : 0;
  document.getElementById('street-badge').textContent = labels[key]||'Pre-flop';
}

// ═══════════════════════════════════════════════════
// PLAYERS
// ═══════════════════════════════════════════════════
function adjPlayers(d) {
  S.players = Math.max(2,Math.min(9,S.players+d));
  document.getElementById('player-count').textContent = S.players;
  const desc = ['','','Heads-up','3-way','4-handed','5-handed','6-handed','7-handed','8-handed','9-handed'];
  document.getElementById('player-desc').textContent = desc[S.players]||`${S.players} players`;
}

// ═══════════════════════════════════════════════════
// CALCULATE
// ═══════════════════════════════════════════════════
function calculate() {
  const hole = S.hand.filter(c=>c!==null);
  if (hole.length < 2) { alert('Select both hole cards.'); return; }

  const oppCombos = getRangeCombos();
  if (oppCombos.length === 0) { alert('Enter an opponent range first.'); return; }

  const board = S.board.filter(c=>c!==null);
  const btn = document.getElementById('calc-btn');
  btn.disabled = true;
  btn.textContent = 'Simulating...';

  setTimeout(() => {
    const iters = board.length >= 4 ? 30000 : 15000;
    const eq = calcRangeEquity(hole, board, oppCombos, S.players, iters);

    document.getElementById('bar-win').style.width = (eq.win*100)+'%';
    document.getElementById('bar-win').textContent = eq.win > 0.12 ? (eq.win*100).toFixed(1)+'%' : '';
    document.getElementById('bar-tie').style.width = (eq.tie*100)+'%';
    document.getElementById('bar-lose').style.width = (eq.lose*100)+'%';

    document.getElementById('stat-win').textContent = (eq.win*100).toFixed(1)+'%';
    document.getElementById('stat-tie').textContent = (eq.tie*100).toFixed(1)+'%';
    document.getElementById('stat-lose').textContent = (eq.lose*100).toFixed(1)+'%';
    document.getElementById('sim-label').textContent = iters.toLocaleString()+' sims · '+oppCombos.length+' opp combos';

    const all = [...hole,...board];
    document.getElementById('my-hand-name').textContent = all.length >= 5 ? handName(bestHand(all)) : '(incomplete board)';
    document.getElementById('my-hand-sub').textContent = hole.map(cstr).join(' ') + (board.length ? ' on '+board.map(cstr).join(' ') : '');

    const outsEl = document.getElementById('outs-badge');
    const outsList = document.getElementById('outs-list');
    if (board.length > 0 && board.length < 5) {
      const outs = calcOuts(hole, board);
      const total = Object.values(outs).reduce((a,b)=>a+b,0);
      outsEl.textContent = total + ' outs';
      const remaining = 52 - hole.length - board.length;
      let html = '<div class="outs-list">';
      for (const [n,cnt] of Object.entries(outs).sort((a,b)=>b[1]-a[1])) {
        html += `<div class="out-item"><span class="out-name">${n}</span><span class="out-val">${cnt} (${(cnt/remaining*100).toFixed(1)}%)</span></div>`;
      }
      html += '</div>';
      outsList.innerHTML = html;
    } else {
      outsEl.textContent = '';
      outsList.innerHTML = '';
    }

    document.getElementById('results-panel').classList.add('visible');
    document.getElementById('ai-text').classList.remove('visible');
    document.getElementById('ai-text').textContent = '';
    document.getElementById('ai-analysis-btn').disabled = false;
    document.getElementById('ai-analysis-btn').textContent = '✦ Get Strategic Analysis';

    btn.disabled = false;
    btn.textContent = 'Calculate Equity →';
  }, 30);
}

// ═══════════════════════════════════════════════════
// AI STRATEGIC ANALYSIS
// ═══════════════════════════════════════════════════
async function getAnalysis() {
  const btn = document.getElementById('ai-analysis-btn');
  const out = document.getElementById('ai-text');
  btn.disabled = true;
  btn.textContent = '✦ Analyzing...';
  out.textContent = 'Thinking...';
  out.classList.add('visible','thinking');

  const hole = S.hand.filter(c=>c!==null);
  const board = S.board.filter(c=>c!==null);
  const oppRange = document.getElementById('range-input').value || '[grid selection]';
  const win = document.getElementById('stat-win').textContent;
  const tie = document.getElementById('stat-tie').textContent;
  const outs = board.length < 5 ? calcOuts(hole, board) : {};
  const totalOuts = Object.values(outs).reduce((a,b)=>a+b,0);
  const handN = board.length >= 5 ? handName(bestHand([...hole,...board])) : '(incomplete board)';
  const street = ['Pre-flop','Pre-flop','Pre-flop','Flop','Turn','River'][board.length];

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'analyze',
        hand: hole.map(cstr).join(' '),
        board: board.length ? board.map(cstr).join(' ') : 'none (pre-flop)',
        street,
        handName: handN,
        winPct: win,
        tiePct: tie,
        oppRange,
        outs: totalOuts,
        outsDetail: Object.entries(outs).map(([k,v])=>`${v} to ${k}`).join(', ') || 'none',
        players: S.players
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    out.classList.remove('thinking');
    out.textContent = data.analysis;
    btn.textContent = '✦ Re-analyze';
    btn.disabled = false;
  } catch(e) {
    out.classList.remove('thinking');
    out.textContent = 'Analysis failed: ' + e.message;
    btn.textContent = '✦ Try Again';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════
// PRESETS
// ═══════════════════════════════════════════════════
const PRESETS = {
  'utg-tight': 'AA, KK, QQ, JJ, TT, AKs, AKo',
  'utg-standard': '99+, AJs+, AQo+, KQs',
  'co-open': '77+, ATs+, AJo+, KQs, KJs+, QJs',
  'btn-wide': '55+, A8s+, ATo+, KTs+, KJo+, QTs+, JTs, T9s',
  'btn-very-wide': '22+, A2s+, A5o+, K9s+, KJo+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+',
  '3bet-tight': 'JJ+, AKs, AKo',
  'any-two': '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s, 32o'
};

// ═══════════════════════════════════════════════════
// WIRE UP DOM EVENTS
// ═══════════════════════════════════════════════════
function init() {
  // Range input
  document.getElementById('range-input').addEventListener('input', onRangeInput);

  // Presets
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => setRange(PRESETS[btn.dataset.preset]));
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
  });

  // Card slots
  document.querySelectorAll('.card-slot').forEach(el => {
    el.addEventListener('click', () => openPicker(el));
  });

  // Suit buttons
  document.querySelectorAll('.suit-btn').forEach(btn => {
    btn.addEventListener('click', () => pickSuit(btn));
  });

  // Clear board
  document.getElementById('clear-board-btn').addEventListener('click', clearBoard);

  // Players
  document.getElementById('players-minus').addEventListener('click', () => adjPlayers(-1));
  document.getElementById('players-plus').addEventListener('click', () => adjPlayers(1));

  // Calculate
  document.getElementById('calc-btn').addEventListener('click', calculate);

  // Overlay
  document.getElementById('overlay').addEventListener('click', overlayClick);
  document.getElementById('picker-remove').addEventListener('click', removeCard);
  document.getElementById('picker-cancel').addEventListener('click', closeOverlay);

  // AI
  document.getElementById('ai-translate-btn').addEventListener('click', translateRange);
  document.getElementById('ai-range-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') translateRange();
  });
  document.getElementById('apply-ai-range').addEventListener('click', applyAIRange);
  document.getElementById('ai-analysis-btn').addEventListener('click', getAnalysis);

  // Init
  initRangeGrid();
  adjPlayers(0);
  updateStreet();
}

document.addEventListener('DOMContentLoaded', init);
