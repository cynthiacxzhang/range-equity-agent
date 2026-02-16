// ═══════════════════════════════════════════════════
// CARD ENGINE
// card = rank*4 + suit  (rank 0-12=2..A, suit 0-3=s/h/d/c)
// ═══════════════════════════════════════════════════
export const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const SUITS = ['s','h','d','c'];
export const SUIT_SYM = { s:'♠', h:'♥', d:'♦', c:'♣' };
export const HAND_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];

export const cid = (r, s) => r*4+s;
export const crank = c => c>>2;
export const csuit = c => c&3;
export const cstr = c => RANKS[crank(c)] + SUITS[csuit(c)];

// ═══════════════════════════════════════════════════
// HAND EVALUATOR
// ═══════════════════════════════════════════════════
export function bestHand(cards) {
  const n = cards.length;
  let best = -1;
  for (let a=0;a<n-4;a++) for (let b=a+1;b<n-3;b++) for (let c=b+1;c<n-2;c++)
    for (let d=c+1;d<n-1;d++) for (let e=d+1;e<n;e++) {
      const s = score5([cards[a],cards[b],cards[c],cards[d],cards[e]]);
      if (s > best) best = s;
    }
  return best;
}

export function score5(h) {
  const rs = h.map(crank).sort((a,b)=>b-a);
  const ss = h.map(csuit);
  const rc = new Array(13).fill(0);
  for (const r of rs) rc[r]++;
  const isF = ss.every(s=>s===ss[0]);
  let isSt=false, stHi=-1;
  const u = [...new Set(rs)].sort((a,b)=>b-a);
  if (u.length===5) {
    if (u[0]-u[4]===4) { isSt=true; stHi=u[0]; }
    if (String(u)==='12,3,2,1,0') { isSt=true; stHi=3; }
  }
  const grps = [];
  for (let r=12;r>=0;r--) if(rc[r]>0) grps.push([rc[r],r]);
  grps.sort((a,b)=>b[0]-a[0]||b[1]-a[1]);
  const cat = (() => {
    if (isF && isSt) return stHi===12 ? 9 : 8;
    if (grps[0][0]===4) return 7;
    if (grps[0][0]===3 && grps[1]?.[0]===2) return 6;
    if (isF) return 5;
    if (isSt) return 4;
    if (grps[0][0]===3) return 3;
    if (grps[0][0]===2 && grps[1]?.[0]===2) return 2;
    if (grps[0][0]===2) return 1;
    return 0;
  })();
  let tb = isSt ? stHi : 0;
  if (!isSt) for (const g of grps) tb = tb*13 + g[1];
  return cat*1e8 + tb;
}

export const handCat = s => Math.floor(s/1e8);
export const handName = s => HAND_NAMES[Math.min(handCat(s),9)];

// ═══════════════════════════════════════════════════
// RANGE PARSER
// ═══════════════════════════════════════════════════
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
      if (!offsuit) { // suited
        for (let s=0;s<4;s++) addCombo(cid(hi,s), cid(lr,s), out);
      }
      if (!suited) { // offsuit
        for (let s1=0;s1<4;s1++) for (let s2=0;s2<4;s2++) {
          if (s1!==s2) addCombo(cid(hi,s1), cid(lr,s2), out);
        }
      }
    }
  }
}

export function addCombo(c1, c2, out) {
  const key = c1<c2 ? `${c1},${c2}` : `${c2},${c1}`;
  out.add(key);
}

export function filterCombos(combos, blockers) {
  const blocked = new Set(blockers);
  return combos.filter(([c1,c2]) => !blocked.has(c1) && !blocked.has(c2));
}

// ═══════════════════════════════════════════════════
// RANGE EQUITY (Monte Carlo)
// ═══════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════
// OUTS
// ═══════════════════════════════════════════════════
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
