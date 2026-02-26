// ─── CARD UTILITIES ───────────────────────────────────────────────────────────
// Uses https://deckofcardsapi.com/static/img/ for card images

const FACE_MAP = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K', 0: 'JOKER'
};
const SUIT_MAP = {
  '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C', '★': 'JOKER'
};

export function cardImageUrl(card) {
  if (!card) return 'https://deckofcardsapi.com/static/img/back.png';
  if (card.suit === '★') return 'https://deckofcardsapi.com/static/img/X1.png';
  const face = card.face ?? card.value;
  const rank = FACE_MAP[face] ?? String(face);
  const suit = SUIT_MAP[card.suit] ?? 'S';
  return `https://deckofcardsapi.com/static/img/${rank}${suit}.png`;
}

export function cardLabel(card) {
  if (!card) return '?';
  const f = card.face ?? card.value;
  if (!f || card.suit === '★') return '★';
  if (f === 1) return 'A';
  if (f === 11) return 'J';
  if (f === 12) return 'Q';
  if (f === 13) return 'K';
  return String(f);
}

export function cardPower(card) {
  if (!card) return null;
  const f = card.face ?? card.value;
  if (f === 7 || f === 8) return 'peek';
  if (f === 9 || f === 10) return 'spy';
  if (f === 11) return 'blindswap';
  if (f === 12) return 'peekswap';
  if (f === 13) return 'kingswap';
  return null;
}

export function cardPoints(card) {
  if (!card) return 0;
  return card.value ?? 0;
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
  deck.push({ face: 0, suit: '★', value: 0 });
  deck.push({ face: 0, suit: '★', value: 0 });
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
    peek: '👁 Peek Own',
    spy: '🔍 Spy Opp.',
    blindswap: '🔄 Blind Swap',
    peekswap: '👁🔄 Peek+Swap',
    kingswap: '👑 King Swap'
  }[power] ?? '';
}
