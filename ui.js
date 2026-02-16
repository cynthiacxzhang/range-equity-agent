import {
  RANKS, SUITS, SUIT_SYM, HAND_NAMES,
  cid, crank, csuit, cstr,
  bestHand, handName,
  parseRange, addCombo,
  calcOuts
} from './engine.js';

// lazy-load the web worker so the sim doesn't block the UI thread
let worker = null;

function getWorker() {
  if (!worker) {
    worker = new Worker('./worker.js', { type: 'module' });
  }
  return worker;
}

// everything the UI needs to track lives here
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

// fires on every keystroke in the range textarea, validates and syncs the grid
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

// the 13x13 grid where you click to toggle hands on/off
// diagonal = pairs, upper-right = suited, lower-left = offsuit
const GRID_RANKS = [...RANKS].reverse();

// builds the whole grid of 169 cells on page load
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

// turns whatever's selected on the grid into actual [card, card] combos
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

// when you type in the text box, update the grid to match
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

// manual / grid / ai tab switching
function switchTab(name, btn) {
  S.activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
}

// sends a plain-english description to the backend and gets a range back
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

// takes the AI-generated range and puts it in the manual text box
function applyAIRange() {
  if (!S.lastAIRange) return;
  setRange(S.lastAIRange);
  document.querySelectorAll('.tab-btn')[0].click();
}

// the modal where you pick suit then rank to select a card
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

// rebuilds the rank buttons, graying out cards already in use
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

// user picked a card, put it in the slot and close the picker
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

// renders a card slot as either empty (+) or a filled card with rank/suit
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

// figures out if we're on pre-flop/flop/turn/river based on board cards
function updateStreet() {
  const n = S.board.filter(c=>c!==null).length;
  const labels = {0:'Pre-flop',3:'Flop',4:'Turn',5:'River'};
  const key = n>=3 ? (n>=5?5:n) : 0;
  document.getElementById('street-badge').textContent = labels[key]||'Pre-flop';
}

// +/- buttons for player count, clamped between 2 and 9
function adjPlayers(d) {
  S.players = Math.max(2,Math.min(9,S.players+d));
  document.getElementById('player-count').textContent = S.players;
  const desc = ['','','Heads-up','3-way','4-handed','5-handed','6-handed','7-handed','8-handed','9-handed'];
  document.getElementById('player-desc').textContent = desc[S.players]||`${S.players} players`;
}

// kicks off the monte carlo sim in the web worker
// shows live progress on the equity bar as chunks come back
function calculate() {
  const hole = S.hand.filter(c=>c!==null);
  if (hole.length < 2) { alert('Select both hole cards.'); return; }

  const oppCombos = getRangeCombos();
  if (oppCombos.length === 0) { alert('Enter an opponent range first.'); return; }

  const board = S.board.filter(c=>c!==null);
  const btn = document.getElementById('calc-btn');
  btn.disabled = true;

  const iters = board.length >= 4 ? 50000 : 25000;
  btn.textContent = `Simulating 0/${(iters/1000).toFixed(0)}k...`;

  // Show results panel immediately with placeholder
  document.getElementById('results-panel').classList.add('visible');
  document.getElementById('pot-odds-panel').classList.add('visible');
  document.getElementById('ai-text').classList.remove('visible');
  document.getElementById('ai-text').textContent = '';

  const w = getWorker();

  w.onmessage = (e) => {
    const { type } = e.data;

    if (type === 'progress') {
      const { done, total, partial } = e.data;
      const pct = ((done/total)*100)|0;
      btn.textContent = `Simulating ${(done/1000).toFixed(0)}k/${(total/1000).toFixed(0)}k...`;

      // Update bars with partial results for live feel
      document.getElementById('bar-win').style.width = (partial.win*100)+'%';
      document.getElementById('bar-win').textContent = partial.win > 0.12 ? (partial.win*100).toFixed(1)+'%' : '';
      document.getElementById('bar-tie').style.width = (partial.tie*100)+'%';
      document.getElementById('bar-lose').style.width = (partial.lose*100)+'%';

      document.getElementById('stat-win').textContent = (partial.win*100).toFixed(1)+'%';
      document.getElementById('stat-tie').textContent = (partial.tie*100).toFixed(1)+'%';
      document.getElementById('stat-lose').textContent = (partial.lose*100).toFixed(1)+'%';
    }

    if (type === 'result') {
      const { eq, myHandName, outs, iterations } = e.data;

      // Final bar update
      document.getElementById('bar-win').style.width = (eq.win*100)+'%';
      document.getElementById('bar-win').textContent = eq.win > 0.12 ? (eq.win*100).toFixed(1)+'%' : '';
      document.getElementById('bar-tie').style.width = (eq.tie*100)+'%';
      document.getElementById('bar-lose').style.width = (eq.lose*100)+'%';

      document.getElementById('stat-win').textContent = (eq.win*100).toFixed(1)+'%';
      document.getElementById('stat-tie').textContent = (eq.tie*100).toFixed(1)+'%';
      document.getElementById('stat-lose').textContent = (eq.lose*100).toFixed(1)+'%';
      document.getElementById('sim-label').textContent = iterations.toLocaleString()+' sims · '+oppCombos.length+' opp combos';

      document.getElementById('my-hand-name').textContent = myHandName;
      document.getElementById('my-hand-sub').textContent = hole.map(cstr).join(' ') + (board.length ? ' on '+board.map(cstr).join(' ') : '');

      // Outs
      const outsEl = document.getElementById('outs-badge');
      const outsList = document.getElementById('outs-list');
      if (Object.keys(outs).length > 0) {
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

      document.getElementById('ai-analysis-btn').disabled = false;
      document.getElementById('ai-analysis-btn').textContent = '✦ Get Strategic Analysis';

      updatePotOdds();

      btn.disabled = false;
      btn.textContent = 'Calculate Equity →';
    }
  };

  w.postMessage({
    type: 'calc-equity',
    payload: { hole, board, oppCombos, numPlayers: S.players, iterations: iters }
  });
}

// sends current hand/board/equity to the backend for a GTO-style analysis
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

// recalculates pot odds and expected value whenever you change the inputs
// reads win/lose from the equity results so it stays in sync
function updatePotOdds() {
  const potSize = parseFloat(document.getElementById('pot-size').value);
  const betToCall = parseFloat(document.getElementById('bet-to-call').value);
  const resultsEl = document.getElementById('pot-odds-results');

  if (!potSize || !betToCall || potSize <= 0 || betToCall <= 0) {
    resultsEl.style.display = 'none';
    return;
  }

  const winText = document.getElementById('stat-win').textContent;
  const loseText = document.getElementById('stat-lose').textContent;
  const winPct = parseFloat(winText) / 100;
  const losePct = parseFloat(loseText) / 100;

  if (isNaN(winPct) || isNaN(losePct)) {
    resultsEl.style.display = 'none';
    return;
  }

  const potOdds = betToCall / (potSize + betToCall);
  const evCall = (winPct * (potSize + betToCall)) - (losePct * betToCall);
  const isPositiveEV = winPct > potOdds;

  // Pot odds as ratio (e.g. 2:1)
  const ratioLeft = ((potSize + betToCall) / betToCall).toFixed(1);

  document.getElementById('pot-odds-pct').textContent = (potOdds * 100).toFixed(1) + '%';
  document.getElementById('required-equity').textContent = (potOdds * 100).toFixed(1) + '%';
  document.getElementById('ev-call').textContent = (evCall >= 0 ? '+' : '') + evCall.toFixed(2);
  document.getElementById('ev-call').style.color = evCall >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('pot-odds-ratio').textContent = `Ratio: ${ratioLeft} : 1 · You need ${(potOdds * 100).toFixed(1)}% equity to break even`;

  const badge = document.getElementById('decision-badge');
  if (isPositiveEV) {
    badge.className = 'decision-badge ev-positive';
    badge.textContent = '+EV Call';
  } else {
    badge.className = 'decision-badge ev-negative';
    badge.textContent = '−EV Fold';
  }

  resultsEl.style.display = 'block';
}

// saved ranges live in localStorage so they persist across sessions
function getSavedRanges() {
  try {
    return JSON.parse(localStorage.getItem('poker-saved-ranges')) || [];
  } catch { return []; }
}

function saveSavedRanges(ranges) {
  localStorage.setItem('poker-saved-ranges', JSON.stringify(ranges));
}

// prompts for a name then stashes the current range text
function saveRange() {
  const range = document.getElementById('range-input').value.trim();
  if (!range) { alert('Enter a range first.'); return; }
  const name = prompt('Name this range:');
  if (!name) return;
  const ranges = getSavedRanges();
  ranges.push({ name, range, timestamp: Date.now() });
  saveSavedRanges(ranges);
  loadSavedRanges();
}

// basic html escape so saved range names don't accidentally inject anything
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// renders the saved ranges list with load/delete buttons
function loadSavedRanges() {
  const ranges = getSavedRanges();
  const list = document.getElementById('saved-ranges-list');
  if (ranges.length === 0) {
    list.innerHTML = '<div style="font-size:0.62rem;color:var(--text3);padding:4px 0;">No saved ranges yet.</div>';
    return;
  }
  list.innerHTML = ranges.map((r, i) =>
    `<div class="saved-range-item">
      <span class="sr-name">${escHtml(r.name)}</span>
      <span class="sr-preview">${escHtml(r.range)}</span>
      <button class="sr-load" data-sr-index="${i}">Load</button>
      <button class="sr-delete" data-sr-index="${i}">×</button>
    </div>`
  ).join('');

  list.querySelectorAll('.sr-load').forEach(btn => {
    btn.addEventListener('click', () => applySavedRange(parseInt(btn.dataset.srIndex)));
  });
  list.querySelectorAll('.sr-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteSavedRange(parseInt(btn.dataset.srIndex)));
  });
}

function applySavedRange(index) {
  const ranges = getSavedRanges();
  if (ranges[index]) setRange(ranges[index].range);
}

function deleteSavedRange(index) {
  const ranges = getSavedRanges();
  ranges.splice(index, 1);
  saveSavedRanges(ranges);
  loadSavedRanges();
}

// common opening ranges people actually use
const PRESETS = {
  'utg-tight': 'AA, KK, QQ, JJ, TT, AKs, AKo',
  'utg-standard': '99+, AJs+, AQo+, KQs',
  'co-open': '77+, ATs+, AJo+, KQs, KJs+, QJs',
  'btn-wide': '55+, A8s+, ATo+, KTs+, KJo+, QTs+, JTs, T9s',
  'btn-very-wide': '22+, A2s+, A5o+, K9s+, KJo+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+',
  '3bet-tight': 'JJ+, AKs, AKo',
  'any-two': '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s, 32o'
};

// hooks up all the click/input handlers and initializes everything
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

  // Pot odds inputs
  document.getElementById('pot-size').addEventListener('input', updatePotOdds);
  document.getElementById('bet-to-call').addEventListener('input', updatePotOdds);

  // Save/load ranges
  document.getElementById('save-range-btn').addEventListener('click', saveRange);
  loadSavedRanges();

  // Init
  initRangeGrid();
  adjPlayers(0);
  updateStreet();
}

document.addEventListener('DOMContentLoaded', init);
