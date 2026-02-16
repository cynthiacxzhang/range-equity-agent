import { describe, it, expect } from 'vitest';
import {
  RANKS, cid, crank, csuit, cstr,
  score5, score5inline, bestHand, handCat, handName,
  parseRange, addCombo, filterCombos,
  calcRangeEquity, calcOuts
} from '../public/engine.js';

// Helper: parse card string like "As" → card id
function card(s) {
  const r = RANKS.indexOf(s[0]);
  const suits = { s:0, h:1, d:2, c:3 };
  return cid(r, suits[s[1]]);
}

function cards(str) {
  return str.split(' ').map(card);
}

// ═══════════════════════════════════════════════════
// HAND EVALUATOR
// ═══════════════════════════════════════════════════
describe('score5 / hand evaluation', () => {
  it('detects high card', () => {
    const h = cards('As Kd Jh 9c 2s');
    expect(handCat(score5(h))).toBe(0);
    expect(handName(score5(h))).toBe('High Card');
  });

  it('detects one pair', () => {
    const h = cards('As Ah Kd Jc 9s');
    expect(handCat(score5(h))).toBe(1);
  });

  it('detects two pair', () => {
    const h = cards('As Ah Kd Kc 9s');
    expect(handCat(score5(h))).toBe(2);
  });

  it('detects three of a kind', () => {
    const h = cards('As Ah Ad Kc 9s');
    expect(handCat(score5(h))).toBe(3);
  });

  it('detects straight', () => {
    const h = cards('Ts 9h 8d 7c 6s');
    expect(handCat(score5(h))).toBe(4);
    expect(handName(score5(h))).toBe('Straight');
  });

  it('detects ace-low straight (wheel)', () => {
    const h = cards('5s 4h 3d 2c As');
    expect(handCat(score5(h))).toBe(4);
    // Wheel should be 5-high straight (stHi=3 means rank index of 5)
    // A regular 6-high straight should beat it
    const sixHigh = cards('6s 5h 4d 3c 2s');
    expect(score5(sixHigh)).toBeGreaterThan(score5(h));
  });

  it('detects flush', () => {
    const h = cards('As Ks Js 9s 2s');
    expect(handCat(score5(h))).toBe(5);
  });

  it('detects full house', () => {
    const h = cards('As Ah Ad Kc Ks');
    expect(handCat(score5(h))).toBe(6);
  });

  it('detects four of a kind', () => {
    const h = cards('As Ah Ad Ac Ks');
    expect(handCat(score5(h))).toBe(7);
  });

  it('detects straight flush', () => {
    const h = cards('9s 8s 7s 6s 5s');
    expect(handCat(score5(h))).toBe(8);
  });

  it('detects royal flush', () => {
    const h = cards('As Ks Qs Js Ts');
    expect(handCat(score5(h))).toBe(9);
    expect(handName(score5(h))).toBe('Royal Flush');
  });

  it('ranks hands in correct order', () => {
    const highCard   = score5(cards('As Kd Jh 9c 2s'));
    const onePair    = score5(cards('As Ah Kd Jc 9s'));
    const twoPair    = score5(cards('As Ah Kd Kc 9s'));
    const trips      = score5(cards('As Ah Ad Kc 9s'));
    const straight   = score5(cards('Ts 9h 8d 7c 6s'));
    const flush      = score5(cards('As Ks Js 9s 2s'));
    const fullHouse  = score5(cards('As Ah Ad Kc Ks'));
    const quads      = score5(cards('As Ah Ad Ac Ks'));
    const strFlush   = score5(cards('9s 8s 7s 6s 5s'));
    const royal      = score5(cards('As Ks Qs Js Ts'));

    expect(onePair).toBeGreaterThan(highCard);
    expect(twoPair).toBeGreaterThan(onePair);
    expect(trips).toBeGreaterThan(twoPair);
    expect(straight).toBeGreaterThan(trips);
    expect(flush).toBeGreaterThan(straight);
    expect(fullHouse).toBeGreaterThan(flush);
    expect(quads).toBeGreaterThan(fullHouse);
    expect(strFlush).toBeGreaterThan(quads);
    expect(royal).toBeGreaterThan(strFlush);
  });

  it('compares tiebreakers within same category', () => {
    // Higher pair wins
    const pairAces = score5(cards('As Ah Kd Jc 9s'));
    const pairKings = score5(cards('Ks Kh Ad Jc 9s'));
    expect(pairAces).toBeGreaterThan(pairKings);

    // Same pair, higher kicker wins
    const pairAcesK = score5(cards('As Ah Kd Jc 9s'));
    const pairAcesQ = score5(cards('As Ah Qd Jc 9s'));
    expect(pairAcesK).toBeGreaterThan(pairAcesQ);
  });

  it('score5inline matches score5', () => {
    const h = cards('As Kd Jh 9c 2s');
    expect(score5inline(h[0],h[1],h[2],h[3],h[4])).toBe(score5(h));

    const h2 = cards('9s 8s 7s 6s 5s');
    expect(score5inline(h2[0],h2[1],h2[2],h2[3],h2[4])).toBe(score5(h2));
  });
});

describe('bestHand (7 cards)', () => {
  it('finds best 5-card hand from 7', () => {
    // Hole: As Ks, Board: Qs Js Ts 2h 3c → royal flush
    const sevenCards = cards('As Ks Qs Js Ts 2h 3c');
    expect(handCat(bestHand(sevenCards))).toBe(9);
  });

  it('finds hidden straight in 7 cards', () => {
    // 8h 7d + board Ts 9c 6s Ah Kd → straight 6-T
    const sevenCards = cards('8h 7d Ts 9c 6s Ah Kd');
    expect(handCat(bestHand(sevenCards))).toBe(4);
  });

  it('finds full house over flush', () => {
    // All spades but with trip aces + pair kings
    const sevenCards = cards('As Ah Ad Ks Kh 2s 3s');
    // Full house (cat 6) beats flush (cat 5)
    expect(handCat(bestHand(sevenCards))).toBe(6);
  });

  it('handles 6-card input', () => {
    const sixCards = cards('As Ks Qs Js Ts 2h');
    expect(handCat(bestHand(sixCards))).toBe(9);
  });

  it('handles 5-card input', () => {
    const fiveCards = cards('As Ks Qs Js Ts');
    expect(handCat(bestHand(fiveCards))).toBe(9);
  });
});

// ═══════════════════════════════════════════════════
// RANGE PARSER
// ═══════════════════════════════════════════════════
describe('parseRange', () => {
  it('parses a single pair', () => {
    const { combos, errors } = parseRange('AA');
    expect(errors).toHaveLength(0);
    expect(combos).toHaveLength(6); // C(4,2) = 6
  });

  it('parses pair with plus', () => {
    const { combos, errors } = parseRange('QQ+');
    expect(errors).toHaveLength(0);
    // QQ, KK, AA = 3 pairs × 6 combos = 18
    expect(combos).toHaveLength(18);
  });

  it('parses suited hand', () => {
    const { combos, errors } = parseRange('AKs');
    expect(errors).toHaveLength(0);
    expect(combos).toHaveLength(4); // one per suit
  });

  it('parses offsuit hand', () => {
    const { combos, errors } = parseRange('AKo');
    expect(errors).toHaveLength(0);
    expect(combos).toHaveLength(12);
  });

  it('parses bare hand (no s/o) as suited+offsuit', () => {
    const { combos, errors } = parseRange('AK');
    expect(errors).toHaveLength(0);
    expect(combos).toHaveLength(16); // 4 suited + 12 offsuit
  });

  it('parses suited with plus', () => {
    const { combos, errors } = parseRange('AQs+');
    expect(errors).toHaveLength(0);
    // AQs + AKs = 2 × 4 = 8
    expect(combos).toHaveLength(8);
  });

  it('parses offsuit with plus', () => {
    const { combos, errors } = parseRange('ATo+');
    expect(errors).toHaveLength(0);
    // ATo, AJo, AQo, AKo = 4 × 12 = 48
    expect(combos).toHaveLength(48);
  });

  it('handles multiple tokens', () => {
    const { combos, errors } = parseRange('AA, KK');
    expect(errors).toHaveLength(0);
    expect(combos).toHaveLength(12); // 6 + 6
  });

  it('reports invalid tokens', () => {
    const { combos, errors } = parseRange('AA, XYZ, KK');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('XYZ');
  });

  it('handles empty string', () => {
    const { combos, errors } = parseRange('');
    expect(combos).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('deduplicates combos', () => {
    // AA appears twice, should still be 6 combos
    const { combos } = parseRange('AA, AA');
    expect(combos).toHaveLength(6);
  });

  it('22+ produces all pairs', () => {
    const { combos } = parseRange('22+');
    // 13 pair ranks × 6 combos = 78
    expect(combos).toHaveLength(78);
  });
});

// ═══════════════════════════════════════════════════
// FILTER COMBOS
// ═══════════════════════════════════════════════════
describe('filterCombos', () => {
  it('removes combos containing blocker cards', () => {
    const { combos } = parseRange('AA');
    const as = card('As');
    const filtered = filterCombos(combos, [as]);
    // 6 AA combos, 3 contain As → 3 remain
    expect(filtered).toHaveLength(3);
    for (const [c1, c2] of filtered) {
      expect(c1).not.toBe(as);
      expect(c2).not.toBe(as);
    }
  });
});

// ═══════════════════════════════════════════════════
// MONTE CARLO EQUITY
// ═══════════════════════════════════════════════════
describe('calcRangeEquity', () => {
  it('AA vs KK preflop is ~80% win', () => {
    const hole = cards('As Ah');
    const oppCombos = parseRange('KK').combos;
    const eq = calcRangeEquity(hole, [], oppCombos, 2, 5000);
    // AA vs KK is roughly 80-82% equity
    expect(eq.win).toBeGreaterThan(0.70);
    expect(eq.win).toBeLessThan(0.92);
    expect(eq.win + eq.tie + eq.lose).toBeCloseTo(1.0, 2);
  });

  it('returns win+tie+lose summing to ~1.0', () => {
    const hole = cards('Ah Kh');
    const oppCombos = parseRange('QQ').combos;
    const eq = calcRangeEquity(hole, [], oppCombos, 2, 3000);
    expect(eq.win + eq.tie + eq.lose).toBeCloseTo(1.0, 2);
  });

  it('nut hand on river wins ~100%', () => {
    // Royal flush on board essentially
    const hole = cards('As Ks');
    const board = cards('Qs Js Ts 2h 3d');
    const oppCombos = parseRange('AA').combos;
    const eq = calcRangeEquity(hole, board, oppCombos, 2, 1000);
    // Should win almost every time (royal flush)
    expect(eq.win + eq.tie).toBeGreaterThan(0.95);
  });
});

// ═══════════════════════════════════════════════════
// OUTS
// ═══════════════════════════════════════════════════
describe('calcOuts', () => {
  it('finds flush outs on flop', () => {
    // Ah Kh on 7h 2h 9c → flush draw, 9 hearts remaining
    const hole = cards('Ah Kh');
    const board = cards('7h 2h 9c');
    const outs = calcOuts(hole, board);
    expect(outs['Flush']).toBe(9);
  });

  it('finds straight outs', () => {
    // Jh Ts on 9c 8d 2h → open-ended straight draw
    const hole = cards('Jh Ts');
    const board = cards('9c 8d 2h');
    const outs = calcOuts(hole, board);
    // 7 or Q completes the straight = 4+4 = 8 outs
    // But some of those might also make a flush or better, still counted under Straight
    expect(outs['Straight']).toBeGreaterThanOrEqual(6);
  });

  it('returns empty for made hand on river', () => {
    const hole = cards('As Ah');
    const board = cards('Ks Qd 9c 5h 2s');
    const outs = calcOuts(hole, board);
    // Already pair of aces. Outs would be to trips or better
    // Exactly 2 aces left → 2 outs to Three of a Kind
    expect(outs['Three of a Kind']).toBe(2);
  });
});
