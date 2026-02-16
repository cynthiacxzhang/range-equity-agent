// each card is just a number: rank*4 + suit
// rank goes 0-12 (2 through A), suit 0-3 (s/h/d/c)
export const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const SUITS = ['s','h','d','c'];
export const SUIT_SYM = { s:'♠', h:'♥', d:'♦', c:'♣' };
export const HAND_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];

export const cid = (r, s) => r*4+s;
export const crank = c => c>>2;
export const csuit = c => c&3;
export const cstr = c => RANKS[crank(c)] + SUITS[csuit(c)];

// precompute every way to pick 5 cards from n cards
// we flatten the indices so the hot loop can just stride by 5
function precomputeCombos(n) {
  const result = [];
  for (let a=0;a<n-4;a++) for (let b=a+1;b<n-3;b++) for (let c=b+1;c<n-2;c++)
    for (let d=c+1;d<n-1;d++) for (let e=d+1;e<n;e++)
      result.push(a, b, c, d, e);
  return result;
}

const COMBOS_5 = precomputeCombos(5); // 1 combo × 5 = 5 entries
const COMBOS_6 = precomputeCombos(6); // 6 combos × 5 = 30 entries
const COMBOS_7 = precomputeCombos(7); // 21 combos × 5 = 105 entries

// hand evaluator - this is the hottest function in the whole app
// reuses typed arrays so we don't trash the GC during monte carlo
const _rc = new Int8Array(13);
const _rs = new Int8Array(5);
const _ss = new Int8Array(5);

// scores a 5-card hand as a single number: category*1e8 + tiebreaker
// higher number = better hand, so you can just compare with >
export function score5inline(c0, c1, c2, c3, c4) {
  // Extract ranks and suits directly
  const r0 = c0>>2, r1 = c1>>2, r2 = c2>>2, r3 = c3>>2, r4 = c4>>2;
  const s0 = c0&3,  s1 = c1&3,  s2 = c2&3,  s3 = c3&3,  s4 = c4&3;

  // Sort ranks descending (insertion sort on 5 elements)
  _rs[0]=r0; _rs[1]=r1; _rs[2]=r2; _rs[3]=r3; _rs[4]=r4;
  for (let i=1;i<5;i++) {
    const v = _rs[i];
    let j = i-1;
    while (j>=0 && _rs[j]<v) { _rs[j+1]=_rs[j]; j--; }
    _rs[j+1] = v;
  }

  // Count ranks
  _rc.fill(0);
  _rc[r0]++; _rc[r1]++; _rc[r2]++; _rc[r3]++; _rc[r4]++;

  // Flush check
  const isF = s0===s1 && s1===s2 && s2===s3 && s3===s4;

  // Straight check
  let isSt = false, stHi = -1;
  // Check if all 5 ranks are unique
  const allUnique = _rs[0]!==_rs[1] && _rs[1]!==_rs[2] && _rs[2]!==_rs[3] && _rs[3]!==_rs[4];
  if (allUnique) {
    if (_rs[0]-_rs[4]===4) { isSt=true; stHi=_rs[0]; }
    // Wheel: A-5-4-3-2 → sorted = [12,3,2,1,0]
    else if (_rs[0]===12 && _rs[1]===3 && _rs[2]===2 && _rs[3]===1 && _rs[4]===0) {
      isSt=true; stHi=3;
    }
  }

  // Build groups sorted by count desc, then rank desc
  // Max 5 groups for high card, usually fewer
  let g0c=0,g0r=0, g1c=0,g1r=0, g2c=0,g2r=0, g3c=0,g3r=0, g4c=0,g4r=0;
  let gn=0;
  for (let r=12;r>=0;r--) {
    if (_rc[r]===0) continue;
    switch(gn) {
      case 0: g0c=_rc[r]; g0r=r; break;
      case 1: g1c=_rc[r]; g1r=r; break;
      case 2: g2c=_rc[r]; g2r=r; break;
      case 3: g3c=_rc[r]; g3r=r; break;
      case 4: g4c=_rc[r]; g4r=r; break;
    }
    gn++;
  }
  // Sort groups by count desc, then rank desc (bubble sort on <=5 items)
  // Pack into array for sorting
  let gc = [g0c,g1c,g2c,g3c,g4c];
  let gr = [g0r,g1r,g2r,g3r,g4r];
  for (let i=0;i<gn-1;i++) {
    for (let j=i+1;j<gn;j++) {
      if (gc[j]>gc[i] || (gc[j]===gc[i] && gr[j]>gr[i])) {
        let tc=gc[i]; gc[i]=gc[j]; gc[j]=tc;
        let tr=gr[i]; gr[i]=gr[j]; gr[j]=tr;
      }
    }
  }

  // Categorize
  let cat;
  if (isF && isSt) cat = stHi===12 ? 9 : 8;
  else if (gc[0]===4) cat = 7;
  else if (gc[0]===3 && gn>=2 && gc[1]===2) cat = 6;
  else if (isF) cat = 5;
  else if (isSt) cat = 4;
  else if (gc[0]===3) cat = 3;
  else if (gc[0]===2 && gn>=2 && gc[1]===2) cat = 2;
  else if (gc[0]===2) cat = 1;
  else cat = 0;

  // Tiebreaker
  let tb;
  if (isSt) {
    tb = stHi;
  } else {
    tb = 0;
    for (let i=0;i<gn;i++) tb = tb*13 + gr[i];
  }
  return cat*1e8 + tb;
}

// same thing but takes an array instead of 5 args
export function score5(h) {
  return score5inline(h[0], h[1], h[2], h[3], h[4]);
}

// tries every 5-card combo from your cards and returns the best score
export function bestHand(cards) {
  const n = cards.length;
  let combos;
  if (n===7) combos = COMBOS_7;
  else if (n===6) combos = COMBOS_6;
  else if (n===5) return score5inline(cards[0],cards[1],cards[2],cards[3],cards[4]);
  else combos = precomputeCombos(n);

  let best = -1;
  for (let i=0; i<combos.length; i+=5) {
    const s = score5inline(
      cards[combos[i]], cards[combos[i+1]], cards[combos[i+2]],
      cards[combos[i+3]], cards[combos[i+4]]
    );
    if (s > best) best = s;
  }
  return best;
}

export const handCat = s => Math.floor(s/1e8);
export const handName = s => HAND_NAMES[Math.min(handCat(s),9)];

// takes a string like "AA, AKs, JJ+" and turns it into actual card combos
export function parseRange(str) {
  if (!str.trim()) return { combos: [], errors: [] };
  const tokens = str.toUpperCase().split(/[\s,]+/).filter(Boolean);
  const combos = new Set();
  const errors = [];

  for (const raw of tokens) {
    try {
      expandToken(raw, combos);
    } catch(e) {
      errors.push(raw);
    }
  }
  return { combos: [...combos].map(k => k.split(',').map(Number)), errors };
}

// handles one token like "AKs" or "JJ+" and expands it into all the card pairs
function expandToken(token, out) {
  const plus = token.endsWith('+');
  const t = plus ? token.slice(0,-1) : token;
  const suited = t.endsWith('S');
  const offsuit = t.endsWith('O');
  const body = (suited||offsuit) ? t.slice(0,-1) : t;

  if (body.length !== 2) throw new Error('bad token');

  const r1 = RANKS.indexOf(body[0]);
  const r2 = RANKS.indexOf(body[1]);
  if (r1 < 0 || r2 < 0) throw new Error('bad rank');

  const hi = Math.max(r1,r2);
  const lo = Math.min(r1,r2);
  const isPair = hi === lo;

  if (isPair) {
    const start = lo;
    const end = plus ? 12 : lo;
    for (let r = start; r <= end; r++) {
      for (let s1=0;s1<4;s1++) for (let s2=s1+1;s2<4;s2++) {
        addCombo(cid(r,s1), cid(r,s2), out);
      }
    }
  } else {
    const startLo = lo;
    const endLo = plus ? hi-1 : lo;
    for (let lr = startLo; lr <= endLo; lr++) {
      if (!offsuit) {
        for (let s=0;s<4;s++) addCombo(cid(hi,s), cid(lr,s), out);
      }
      if (!suited) {
        for (let s1=0;s1<4;s1++) for (let s2=0;s2<4;s2++) {
          if (s1!==s2) addCombo(cid(hi,s1), cid(lr,s2), out);
        }
      }
    }
  }
}

// always stores the smaller card first so we don't get duplicates
export function addCombo(c1, c2, out) {
  const key = c1<c2 ? `${c1},${c2}` : `${c2},${c1}`;
  out.add(key);
}

// removes any combos that conflict with cards already on the board/in hand
export function filterCombos(combos, blockers) {
  const blocked = new Set(blockers);
  return combos.filter(([c1,c2]) => !blocked.has(c1) && !blocked.has(c2));
}

// the main monte carlo sim - randomly deals out the rest of the board
// thousands of times and counts how often we win/tie/lose
// this version is for tests and fallback, the worker uses its own copy
export function calcRangeEquity(myHole, communityCards, opponentCombos, numPlayers, iterations=10000) {
  const knownSet = new Set([...myHole, ...communityCards]);
  const available = [];
  for (let i=0;i<52;i++) if (!knownSet.has(i)) available.push(i);

  const needed = 5 - communityCards.length;
  const extraOpps = numPlayers - 2;

  let wins=0, ties=0, losses=0;

  for (let iter=0; iter<iterations; iter++) {
    const validOpp = filterCombos(opponentCombos, [...knownSet]);
    if (!validOpp.length) { wins++; continue; }
    const oppHole = validOpp[(Math.random()*validOpp.length)|0];

    const used = new Set([...knownSet, ...oppHole]);
    const d = available.filter(c => !used.has(c));
    for (let i=d.length-1;i>0;i--) {
      const j=(Math.random()*(i+1))|0; [d[i],d[j]]=[d[j],d[i]];
    }

    let idx=0;
    const board = [...communityCards];
    for (let i=0;i<needed;i++) board.push(d[idx++]);

    const myScore = bestHand([...myHole, ...board]);
    const oppScore = bestHand([...oppHole, ...board]);

    let bestExtra = -1;
    for (let p=0;p<extraOpps;p++) {
      const eh = [d[idx++], d[idx++]];
      const es = bestHand([...eh, ...board]);
      if (es > bestExtra) bestExtra = es;
    }

    const maxOpp = Math.max(oppScore, bestExtra);
    if (myScore > maxOpp) wins++;
    else if (myScore === maxOpp) ties++;
    else losses++;
  }
  return { win:wins/iterations, tie:ties/iterations, lose:losses/iterations };
}

// checks every remaining card in the deck to see which ones improve our hand
// returns something like { "Flush": 9, "Straight": 4 }
export function calcOuts(myHole, board) {
  const known = new Set([...myHole, ...board]);
  const cur = Math.floor(bestHand([...myHole,...board])/1e8);
  const result = {};
  for (let c=0;c<52;c++) {
    if (known.has(c)) continue;
    const test = [...myHole,...board,c];
    const cat = Math.floor(bestHand(test)/1e8);
    if (cat > cur) {
      const n = HAND_NAMES[cat];
      result[n] = (result[n]||0)+1;
    }
  }
  return result;
}
