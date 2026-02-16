import {
  bestHand, handName, calcRangeEquity, calcOuts, filterCombos
} from './engine.js';

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'calc-equity') {
    const { hole, board, oppCombos, numPlayers, iterations } = payload;

    // Run in chunks so we can report progress
    const CHUNK = 2000;
    let wins = 0, ties = 0, losses = 0;
    let done = 0;

    const knownSet = new Set([...hole, ...board]);
    const available = [];
    for (let i = 0; i < 52; i++) if (!knownSet.has(i)) available.push(i);
    const needed = 5 - board.length;
    const extraOpps = numPlayers - 2;

    while (done < iterations) {
      const batch = Math.min(CHUNK, iterations - done);

      for (let iter = 0; iter < batch; iter++) {
        const validOpp = filterCombos(oppCombos, [...knownSet]);
        if (!validOpp.length) { wins++; done++; continue; }
        const oppHole = validOpp[(Math.random() * validOpp.length) | 0];

        const used = new Set([...knownSet, ...oppHole]);
        const d = available.filter(c => !used.has(c));
        for (let i = d.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [d[i], d[j]] = [d[j], d[i]];
        }

        let idx = 0;
        const fullBoard = [...board];
        for (let i = 0; i < needed; i++) fullBoard.push(d[idx++]);

        const myScore = bestHand([...hole, ...fullBoard]);
        const oppScore = bestHand([...oppHole, ...fullBoard]);

        let bestExtra = -1;
        for (let p = 0; p < extraOpps; p++) {
          const eh = [d[idx++], d[idx++]];
          const es = bestHand([...eh, ...fullBoard]);
          if (es > bestExtra) bestExtra = es;
        }

        const maxOpp = Math.max(oppScore, bestExtra);
        if (myScore > maxOpp) wins++;
        else if (myScore === maxOpp) ties++;
        else losses++;
      }

      done += batch;

      // Send progress update
      self.postMessage({
        type: 'progress',
        done,
        total: iterations,
        partial: {
          win: wins / done,
          tie: ties / done,
          lose: losses / done
        }
      });
    }

    // Final result
    const eq = { win: wins / iterations, tie: ties / iterations, lose: losses / iterations };

    // Also compute outs and hand name on the worker
    const all = [...hole, ...board];
    const myHandName = all.length >= 5 ? handName(bestHand(all)) : '(incomplete board)';
    const outs = (board.length > 0 && board.length < 5) ? calcOuts(hole, board) : {};

    self.postMessage({
      type: 'result',
      eq,
      myHandName,
      outs,
      iterations
    });
  }
};
