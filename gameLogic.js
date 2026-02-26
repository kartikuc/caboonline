// ─── GAME LOGIC ───────────────────────────────────────────────────────────────
import { buildDeck, shuffle, cardPower, cardLabel } from './cards.js';

export function createInitialGameState(playerArr) {
  const deck = shuffle(buildDeck());
  const hands = {};
  playerArr.forEach(p => {
    hands[p.id] = [deck.shift(), deck.shift(), deck.shift(), deck.shift()];
  });
  const discard = deck.shift();
  return {
    deck,
    discard: [discard],
    hands,
    playerOrder: playerArr.map(p => p.id),
    playerNames: Object.fromEntries(playerArr.map(p => [p.id, p.name])),
    scores: Object.fromEntries(playerArr.map(p => [p.id, 0])),
    currentTurn: playerArr[0].id,
    caboCallerId: null,
    lastTurns: {},
    phase: 'initial-peek',
    drawnCard: null,
    round: 1,
    log: [],
    event: null,
    peekReady: {}
  };
}

export function createNextRoundState(gs) {
  const deck = shuffle(buildDeck());
  const hands = {};
  gs.playerOrder.forEach(pid => {
    hands[pid] = [deck.shift(), deck.shift(), deck.shift(), deck.shift()];
  });
  const discard = deck.shift();
  return {
    ...gs,
    deck,
    discard: [discard],
    hands,
    caboCallerId: null,
    lastTurns: {},
    phase: 'initial-peek',
    drawnCard: null,
    round: (gs.round || 1) + 1,
    log: [],
    event: null,
    peekReady: {}
  };
}

export function computeNextTurn(gs) {
  const order = gs.playerOrder;
  const nextPid = order[(order.indexOf(gs.currentTurn) + 1) % order.length];

  if (gs.caboCallerId) {
    const lt = { ...(gs.lastTurns || {}) };
    if (lt[gs.currentTurn] !== undefined) lt[gs.currentTurn]--;
    const allDone = order
      .filter(pid => pid !== gs.caboCallerId)
      .every(pid => !lt[pid] || lt[pid] <= 0);
    if (allDone) return { currentTurn: nextPid, phase: 'round-end', lastTurns: lt };
    return { currentTurn: nextPid, lastTurns: lt };
  }
  return { currentTurn: nextPid };
}

export function computeRoundScores(gs) {
  const results = gs.playerOrder.map(pid => {
    const hand = gs.hands[pid] || [];
    const total = hand.reduce((s, c) => s + (c?.value ?? 0), 0);
    return { pid, name: gs.playerNames[pid], hand, total };
  }).sort((a, b) => a.total - b.total);

  const lowest = results[0].total;
  const cabo = gs.caboCallerId;

  const scored = results.map(r => {
    let pts = r.total;
    if (r.pid === cabo) pts = r.total === lowest ? 0 : r.total + 10;
    return { ...r, pts };
  });

  const newScores = { ...(gs.scores || {}) };
  scored.forEach(r => { newScores[r.pid] = (newScores[r.pid] || 0) + r.pts; });

  const gameOver = Object.values(newScores).some(s => s >= 100);
  return { scored, newScores, gameOver };
}

export function addLog(existing, entry) {
  const logs = [...(existing || [])];
  logs.push(entry);
  if (logs.length > 25) logs.shift();
  return logs;
}

export function fixArrays(gs) {
  if (!gs) return;
  if (gs.deck && !Array.isArray(gs.deck)) gs.deck = Object.values(gs.deck);
  if (gs.playerOrder && !Array.isArray(gs.playerOrder)) gs.playerOrder = Object.values(gs.playerOrder);
  if (gs.discard && !Array.isArray(gs.discard)) gs.discard = Object.values(gs.discard);
  if (gs.log && !Array.isArray(gs.log)) gs.log = Object.values(gs.log);
  (gs.playerOrder || []).forEach(pid => {
    if (gs.hands?.[pid] && !Array.isArray(gs.hands[pid]))
      gs.hands[pid] = Object.values(gs.hands[pid]);
  });
}

export function getHelpText(gs, myId, pendingAction) {
  const myTurn = gs.currentTurn === myId;
  const currentName = gs.playerNames?.[gs.currentTurn] || '?';

  if (gs.phase === 'initial-peek') return 'Peek at your two inner cards, then click Ready when memorized';
  if (!myTurn) return `Waiting for ${currentName}...`;

  const pa = pendingAction;
  if (!gs.drawnCard && !pa) return 'Draw a card from the deck, or call CABO!';
  if (gs.drawnCard && !pa) return 'Discard the drawn card, or click one of your cards to swap it in';

  const map = {
    'peek:pick': '👁  Click one of YOUR cards to peek at it',
    'spy:pick-opp': '🔍  Click an OPPONENT\'S card to spy on it',
    'spy:revealed': '🔍  Spied! Ending turn...',
    'blindswap:pick-mine': '🔄  Pick YOUR card for blind swap',
    'blindswap:pick-opp': '🔄  Now pick OPPONENT\'S card to swap with',
    'peekswap:pick-opp': '👁🔄  Pick OPPONENT\'S card to peek at first',
    'peekswap:peek-done': '👁🔄  Saw their card — pick YOUR card to swap out',
    'peekswap:pick-mine': '👁🔄  Click YOUR card to swap out',
    'kingswap:pick-opp': '👑  Pick OPPONENT\'S card to peek at',
    'kingswap:peek-done': '👑  Now pick YOUR card to peek at',
    'kingswap:pick-mine': '👑  Click YOUR card to peek at it',
    'kingswap:peek-mine': '👑  Now pick OPPONENT\'S card to swap with',
    'kingswap:pick-opp-swap': '👑  Pick OPPONENT\'S card to complete the swap',
  };

  return map[`${pa?.type}:${pa?.step}`] || '';
}
