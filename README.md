# Range Equity

A Texas Hold'em equity calculator that runs Monte Carlo simulations in the browser. Pick your hole cards, set an opponent range, and see your win/tie/lose percentages in real time.

**Live demo:** [cynthiacxzhang.github.io/range-equity-agent](https://cynthiacxzhang.github.io/range-equity-agent/)

## What it does

- **Range-vs-range equity** — Monte Carlo sim runs in a web worker so the UI stays responsive. Progress bar updates live as chunks complete.
- **Opponent range input** — Type notation like `AA, AKs, JJ+` in the manual tab, click cells in the 13x13 hand matrix, or describe the opponent in plain English and let Claude generate the range.
- **Pot odds / EV calculator** — Enter pot size and bet to call, get pot odds, required equity, EV of calling, and a +EV/−EV decision badge.
- **Outs calculator** — On flop/turn, shows how many cards improve your hand and what they improve to.
- **Save/load ranges** — Save custom ranges to localStorage with a name. They persist across sessions.
- **AI strategic analysis** — Sends your hand, board, equity, and opponent range to Claude for a GTO-style breakdown (requires API key).

## Running locally

```
npm install
npm start
```

Open http://localhost:3000. The equity calculator, pot odds, and saved ranges all work without an API key. For AI features (range translator + strategic analysis), copy `.env.example` to `.env` and add your Anthropic API key.

## Stack

Vanilla JS, no frameworks. Express serves the static files and proxies AI requests. The Monte Carlo engine and hand evaluator are pure JS running in a web worker.

## Tests

```
npm test
```
