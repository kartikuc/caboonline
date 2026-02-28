// ─── CARD UTILITIES ───────────────────────────────────────────────────────────
// Uses https://deckofcardsapi.com/static/img/ for card images
// API rank format: A, 2-9, 0 (for 10), J, Q, K
// API suit format: S, H, D, C

export function cardImageUrl(card) {
  if (!card) return 'https://deckofcardsapi.com/static/img/back.png';
  if (card.suit === '★') return 'https://deckofcardsapi.com/static/img/back.png';

  // Firebase can return face/value as strings — always coerce to number
  const face = Number(card.face ?? card.value ?? 0);

  const SUIT_MAP = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
  const suit = SUIT_MAP[card.suit];
  if (!suit) return 'https://deckofcardsapi.com/static/img/back.png';

  // deckofcardsapi uses '0' for 10, 'A' for Ace, J/Q/K for face cards
  let rank;
  if (face === 1)  rank = 'A';
  else if (face === 10) rank = '0';  // ← critical: 10 = '0' in this API
  else if (face === 11) rank = 'J';
  else if (face === 12) rank = 'Q';
  else if (face === 13) rank = 'K';
  else rank = String(face);

  return `https://deckofcardsapi.com/static/img/${rank}${suit}.png`;
}

export function cardLabel(card) {
  if (!card) return '?';
  const f = Number(card.face ?? card.value ?? 0);
  if (f === 0 || card.suit === '★') return '★';
  if (f === 1)  return 'A';
  if (f === 11) return 'J';
  if (f === 12) return 'Q';
  if (f === 13) return 'K';
  return String(f);
}

export function cardPower(card) {
  if (!card) return null;
  const f = Number(card.face ?? card.value ?? 0);
  if (f === 7 || f === 8)  return 'peek';
  if (f === 9 || f === 10) return 'spy';
  if (f === 11) return 'blindswap';
  if (f === 12) return 'peekswap';
  if (f === 13) return 'kingswap';
  return null;
}

export function cardPoints(card) {
  if (!card) return 0;
  return Number(card.value ?? 0);
}

export function buildDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const deck = [];
  for (let f = 1; f <= 13; f++) {
    for (const s of suits) {
      const value = (f === 13 && s === '♠') ? 0 : f;
      deck.push({ face: f, suit: s, value });
    }
  }
  return deck;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function powerLabel(power) {
  return {
    peek:      '👁 Peek Own',
    spy:       '🔍 Spy Opp.',
    blindswap: '🔄 Blind Swap',
    peekswap:  '👁🔄 Peek+Swap',
    kingswap:  '👑 King Swap'
  }[power] ?? '';
}
