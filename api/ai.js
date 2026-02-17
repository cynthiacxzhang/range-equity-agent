const API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });
  }

  const { type } = req.body;
  let prompt;

  if (type === 'translate-range') {
    const { description } = req.body;
    prompt = `You are a poker range expert. Convert this player description into a precise hand range.

Description: "${description}"

Return ONLY valid JSON in this exact format, nothing else:
{
  "range": "AA, KK, QQ, AKs, AKo",
  "reasoning": "One sentence explaining the range."
}

Range notation rules:
- Pairs: AA, KK, 99, 22 etc
- Suited: AKs, AQs, KQs etc
- Offsuit: AKo, AQo, KQo etc
- Plus suffix: 99+ means 99,TT,JJ,QQ,KK,AA. AJs+ means AJs,AQs,AKs
- Valid ranks: 2,3,4,5,6,7,8,9,T,J,Q,K,A
- Only include hands that make strategic sense for the description.`;
  } else if (type === 'analyze') {
    const { hand, board, street, handName, winPct, tiePct, oppRange, outs, outsDetail, players } = req.body;
    prompt = `You are a GTO-aware poker coach. Be specific, strategic, and concise (4-5 sentences max).

Situation:
- My hand: ${hand}
- Board: ${board}
- Street: ${street}
- My made hand: ${handName}
- My equity vs opponent range: Win ${winPct}, Tie ${tiePct}
- Opponent's range: ${oppRange}
- Outs to improve: ${outs} (${outsDetail})
- Players: ${players}

Analyze: (1) How does my hand interact with their range? (2) What's my range advantage or disadvantage on this board texture? (3) Concrete action recommendation with sizing rationale. Reference their specific range.`;
  } else {
    return res.status(400).json({ error: 'Unknown request type' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(response.status).json({ error: data.error.message });
    }

    const text = data.content?.map(b => b.text || '').join('') || '';

    if (type === 'translate-range') {
      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return res.json({ range: parsed.range, reasoning: parsed.reasoning });
    } else {
      return res.json({ analysis: text });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
