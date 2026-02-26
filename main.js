// ─── MAIN APPLICATION ─────────────────────────────────────────────────────────
import { cardImageUrl, cardLabel, cardPower, buildDeck, shuffle, powerLabel } from './cards.js';
import {
  sleep, dealCardAnimation, flipCardUp, flipCardDown,
  revealCard, animateSwapIntoHand, slideCardBetween, staggerDeal, pulseCard
} from './animations.js';
import {
  createInitialGameState, createNextRoundState,
  computeNextTurn, computeRoundScores, addLog, fixArrays, getHelpText
} from './gameLogic.js';
import {
  db, ref, set, get, update, onValue, push, remove, off,
  gameRef, playersRef, chatRef, stateRef, hostRef, updateGame, broadcastEvent
} from './firebase.js';
import {
  makeCardEl, renderScoreStrip, renderOpponents, renderMyHand,
  renderDiscardPile, renderDrawnCard, renderRoundEnd, renderGameOver,
  showBanner, showToast, getCardEls, esc
} from './ui.js';

// ─── STATE ───────────────────────────────────────────────────────────────────
let myId = null, myName = '', roomCode = null;
let gameState = null, isHost = false;
let pendingAction = null;
const myKnownCards = new Map();
let lastEventId = null;
let dealAnimPlayed = false;

// ─── LOBBY ────────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('lobby').style.display = id === 'lobby' ? 'flex' : 'none';
  document.getElementById('game').style.display = id === 'game' ? 'flex' : 'none';
}

function setLoading(btn, loading) {
  if (loading) { btn.dataset.orig = btn.textContent; btn.classList.add('loading'); btn.disabled = true; }
  else { btn.textContent = btn.dataset.orig || btn.textContent; btn.classList.remove('loading'); btn.disabled = false; }
}

window.setName = function () {
  const n = document.getElementById('player-name-input').value.trim();
  if (!n) return;
  myName = n;
  document.getElementById('enter-name-box').style.display = 'none';
  document.getElementById('lobby-main').style.display = 'flex';
};

window.createRoom = async function () {
  const btn = event.currentTarget;
  setLoading(btn, true);
  try {
    const code = Array.from({ length: 4 },
      () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]
    ).join('');
    roomCode = code; isHost = true;
    await joinRoomWithCode(code);
  } catch (e) { setLoading(btn, false); alert('Failed to create room.'); }
};

window.joinRoom = async function () {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (code.length !== 4) return alert('Enter a 4-letter room code');
  const btn = document.querySelector('#lobby-main .btn-secondary');
  setLoading(btn, true);
  try {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) { setLoading(btn, false); return alert('Room not found'); }
    if (snap.val().state !== 'lobby') { setLoading(btn, false); return alert('Game already started'); }
    roomCode = code; isHost = false;
    await joinRoomWithCode(code);
  } catch (e) { setLoading(btn, false); alert('Failed to join.'); }
};

async function joinRoomWithCode(code) {
  const playerRef = push(ref(db, `rooms/${code}/players`));
  myId = playerRef.key;
  const snap = await get(ref(db, `rooms/${code}/players`));
  const count = Object.keys(snap.val() || {}).length;
  await set(playerRef, { name: myName, id: myId, score: 0 });
  if (count === 0) {
    await set(ref(db, `rooms/${code}/state`), 'lobby');
    await set(ref(db, `rooms/${code}/host`), myId);
  }
  document.getElementById('display-room-code').textContent = code;
  document.getElementById('lobby-main').style.display = 'none';
  document.getElementById('waiting-room').style.display = 'flex';
  listenLobby();
}

function listenLobby() {
  onValue(ref(db, `rooms/${roomCode}/players`), snap => {
    const arr = Object.values(snap.val() || {});
    document.getElementById('player-count').textContent = arr.length;
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    arr.forEach(p => {
      const div = document.createElement('div');
      div.className = 'player-item' + (p.id === myId ? ' me' : '');
      div.innerHTML = `<div class="player-dot"></div><span>${p.name}</span>
        ${p.id === arr[0]?.id ? '<span class="host-badge">HOST</span>' : ''}`;
      list.appendChild(div);
    });
    const sb = document.getElementById('start-btn');
    sb.disabled = arr.length < 2 || arr[0]?.id !== myId;
    sb.textContent = arr.length < 2
      ? 'Start Game (need 2+)'
      : `Start Game (${arr.length} players)`;
  });
  onValue(stateRef(roomCode), snap => {
    if (snap.val() === 'playing') { off(stateRef(roomCode)); initGame(); }
  });
}

window.leaveRoom = function () {
  if (roomCode && myId) remove(ref(db, `rooms/${roomCode}/players/${myId}`));
  location.reload();
};

window.startGame = async function () {
  if (!isHost) return;
  const btn = document.getElementById('start-btn');
  setLoading(btn, true);
  const snap = await get(ref(db, `rooms/${roomCode}/players`));
  const playerArr = Object.values(snap.val());
  const gs = createInitialGameState(playerArr);
  await set(ref(db, `rooms/${roomCode}`), {
    state: 'playing', players: snap.val(), host: myId, game: gs
  });
};

// ─── GAME INIT ────────────────────────────────────────────────────────────────
function initGame() {
  showScreen('game');

  onValue(gameRef(roomCode), snap => {
    if (!snap.exists()) return;
    const prev = gameState;
    gameState = snap.val();
    fixArrays(gameState);

    handleSharedEvent(gameState.event);

    if (!dealAnimPlayed && gameState.phase === 'initial-peek') {
      dealAnimPlayed = true;
      runDealingAnimation();
    } else {
      renderGame();
    }
  });

  onValue(chatRef(roomCode), snap => {
    if (!snap.exists()) return;
    const arr = Object.values(snap.val());
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    arr.slice(-80).forEach(m => {
      const div = document.createElement('div');
      div.className = 'chat-msg' + (m.id === myId ? ' me' : '') + (m.system ? ' system' : '');
      div.innerHTML = m.system
        ? `<span class="cbody">${m.text}</span>`
        : `<div class="cname">${m.name}</div><div class="cbody">${esc(m.text)}</div>`;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  });
}

// ─── DEALING ANIMATION ────────────────────────────────────────────────────────
async function runDealingAnimation() {
  const gs = gameState;
  // Render shell with all cards hidden
  renderGameShell(gs);
  await sleep(300);

  const deckEl = document.getElementById('deck-pile');
  const allPlayers = gs.playerOrder || [];

  // PHASE 1: Deal outer cards (pos 0 and 3) face-down to all players
  // Stagger: left card then right card, rotating through players
  for (const posIdx of [0, 3]) {
    for (let i = 0; i < allPlayers.length; i++) {
      const pid = allPlayers[i];
      const cardEls = getCardEls(pid, myId);
      const el = cardEls[posIdx];
      if (el) {
        el.style.opacity = '0';
        await dealCardAnimation(deckEl, el, 0);
        el.style.opacity = '1';
        el.style.animation = 'dealIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards';
      }
      await sleep(75);
    }
    await sleep(120);
  }

  await sleep(400);

  // PHASE 2: Deal inner cards (pos 1 and 2) to all players
  for (const posIdx of [1, 2]) {
    for (let i = 0; i < allPlayers.length; i++) {
      const pid = allPlayers[i];
      const cardEls = getCardEls(pid, myId);
      const el = cardEls[posIdx];
      if (el) {
        el.style.opacity = '0';
        await dealCardAnimation(deckEl, el, 0);
        el.style.opacity = '1';
        el.style.animation = 'dealIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards';
      }
      await sleep(75);
    }
    await sleep(120);
  }

  await sleep(500);

  // PHASE 3: Flip MY inner cards face-up for the peek
  const myHand = gs.hands?.[myId] || [];
  const myEls = getCardEls(myId, myId);

  // Flip card at position 1 face-up
  if (myEls[1] && myHand[1]) {
    const img = myEls[1].querySelector('.card-img');
    if (img) {
      myEls[1].style.transition = 'transform 0.3s';
      myEls[1].style.transform = 'rotateY(90deg)';
      await sleep(160);
      img.src = cardImageUrl(myHand[1]);
      myEls[1].style.transform = 'rotateY(0deg)';
      await sleep(320);
    }
  }

  await sleep(150);

  // Flip card at position 2 face-up
  if (myEls[2] && myHand[2]) {
    const img = myEls[2].querySelector('.card-img');
    if (img) {
      myEls[2].style.transition = 'transform 0.3s';
      myEls[2].style.transform = 'rotateY(90deg)';
      await sleep(160);
      img.src = cardImageUrl(myHand[2]);
      myEls[2].style.transform = 'rotateY(0deg)';
      await sleep(320);
    }
  }

  await sleep(300);

  // Show the peek overlay
  showPeekOverlay(myHand[1], myHand[2]);
  renderPeekWaiting(gs);
}

function renderGameShell(gs) {
  // Header
  document.getElementById('turn-label').textContent = 'Dealing cards...';
  document.getElementById('round-label').textContent = `Round ${gs.round || 1}`;
  document.getElementById('deck-count').textContent = (gs.deck || []).length;

  // Score strip
  renderScoreStrip(gs, myId);

  // Opponents (face down, no interactivity)
  const oppArea = document.getElementById('opponents-area');
  oppArea.innerHTML = '';
  (gs.playerOrder || []).filter(pid => pid !== myId).forEach(pid => {
    const zone = document.createElement('div');
    zone.className = 'opponent-zone';
    zone.dataset.pid = pid;
    const nameEl = document.createElement('div');
    nameEl.className = 'opponent-name';
    nameEl.textContent = gs.playerNames[pid];
    zone.appendChild(nameEl);
    const row = document.createElement('div');
    row.className = 'hand-row';
    const hand = gs.hands?.[pid] || [];
    hand.forEach(() => {
      const el = makeCardEl(null, { faceDown: true });
      el.classList.add('not-selectable');
      el.style.opacity = '0';
      row.appendChild(el);
    });
    zone.appendChild(row);
    oppArea.appendChild(zone);
  });

  // My cards (face down)
  const myCardsEl = document.getElementById('my-cards');
  myCardsEl.innerHTML = '';
  const myHand = gs.hands?.[myId] || [];
  myHand.forEach(() => {
    const el = makeCardEl(null, { faceDown: true });
    el.classList.add('not-selectable');
    el.style.opacity = '0';
    myCardsEl.appendChild(el);
  });
}

function showPeekOverlay(card1, card2) {
  const row = document.getElementById('peek-cards-row');
  row.innerHTML = '';
  [card1, card2].forEach((card, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'peek-card-wrapper';
    const lbl = document.createElement('div');
    lbl.className = 'peek-card-label';
    lbl.textContent = idx === 0 ? 'Card 2' : 'Card 3';
    const el = makeCardEl(card);
    el.classList.add('not-selectable');
    el.style.transform = 'scale(1.15)';
    wrapper.appendChild(lbl);
    wrapper.appendChild(el);
    row.appendChild(wrapper);
  });
  document.getElementById('peek-overlay').style.display = 'flex';
}

function renderPeekWaiting(gs) {
  // Show waiting list inside overlay
  let list = document.getElementById('peek-waiting-list');
  if (!list) {
    list = document.createElement('div');
    list.id = 'peek-waiting-list';
    list.className = 'peek-waiting-list';
    document.getElementById('peek-overlay').appendChild(list);
  }
  list.innerHTML = '';
  (gs.playerOrder || []).forEach(pid => {
    const ready = gs.peekReady?.[pid];
    const div = document.createElement('div');
    div.className = 'peek-waiting-item';
    div.innerHTML = `<div class="peek-waiting-dot ${ready ? 'ready' : 'waiting'}"></div>
      <span style="font-size:12px">${gs.playerNames[pid]}${pid === myId ? ' (you)' : ''}</span>
      ${ready ? '<span style="margin-left:auto;font-size:10px;color:var(--green);font-family:\'DM Mono\',monospace">READY</span>' : ''}`;
    list.appendChild(div);
  });
}

window.markReady = async function () {
  const btn = document.getElementById('peek-ready-btn');
  btn.disabled = true;
  btn.textContent = 'Waiting for others...';

  // Store memory of inner cards
  const gs = gameState;
  myKnownCards.set(1, gs.hands?.[myId]?.[1]);
  myKnownCards.set(2, gs.hands?.[myId]?.[2]);

  // Flip inner cards face-down in board
  const myEls = getCardEls(myId, myId);
  for (const pos of [1, 2]) {
    const el = myEls[pos];
    if (el) {
      el.style.transition = 'transform 0.28s';
      el.style.transform = 'rotateY(90deg)';
      await sleep(150);
      const img = el.querySelector('.card-img');
      if (img) img.src = 'https://deckofcardsapi.com/static/img/back.png';
      el.style.transform = 'rotateY(0deg)';
      await sleep(100);
    }
  }

  // Hide overlay
  document.getElementById('peek-overlay').style.display = 'none';

  // Signal ready
  await update(ref(db, `rooms/${roomCode}/game/peekReady`), { [myId]: true });

  // Check if all ready → host starts
  if (isHost) {
    const snap = await get(ref(db, `rooms/${roomCode}/game/peekReady`));
    const ready = snap.val() || {};
    if ((gameState.playerOrder || []).every(pid => ready[pid])) {
      await updateGame(roomCode, { phase: 'play' });
    }
  }

  renderGame();
};

// When peekReady changes, re-render waiting list
// (handled in main onValue callback via renderGame which checks peek overlay visibility)

// ─── SHARED EVENTS ────────────────────────────────────────────────────────────
function handleSharedEvent(event) {
  if (!event || event.id === lastEventId) return;
  lastEventId = event.id;
  const actorName = event.actorName || '?';
  const isMe = event.actorId === myId;

  if (event.type === 'peek') {
    showBanner(`👁  ${actorName} peeked at their card`, isMe ? `You saw it` : '');
  }
  if (event.type === 'spy') {
    const tn = event.targetName || '?';
    showBanner(`🔍  ${actorName} spied on ${tn}`, isMe ? `Card: ${event.cardLabel}` : '');
    // Show a brief flash on the opponent's card if we're another player
    if (!isMe) {
      const els = getCardEls(event.targetId, myId);
      const el = els[event.pos];
      if (el) { pulseCard(el, 'var(--blue)', 1800); }
    }
  }
  if (event.type === 'swap' || event.type === 'blindswap') {
    const tn = event.targetName || '?';
    showBanner(`🔄  ${actorName} swapped with ${tn}`, '');
    setTimeout(() => {
      [
        { pid: event.actorId, pos: event.myPos },
        { pid: event.targetId, pos: event.oppPos }
      ].forEach(({ pid, pos }) => {
        const els = getCardEls(pid, myId);
        if (els[pos]) {
          els[pos].classList.add('swap-target');
          setTimeout(() => els[pos]?.classList.remove('swap-target'), 1400);
        }
      });
    }, 100);
  }
  if (event.type === 'cabo') {
    showBanner(`🎯  ${actorName} called CABO!`, 'Everyone gets one more turn');
  }
}

const isMyTurn = () => gameState?.currentTurn === myId;

// ─── MAIN RENDER ─────────────────────────────────────────────────────────────
function renderGame() {
  if (!gameState) return;
  const gs = gameState;
  const myTurn = isMyTurn();
  const currentName = gs.playerNames?.[gs.currentTurn] || '?';

  // Header
  const tl = document.getElementById('turn-label');
  if (gs.phase === 'initial-peek') {
    tl.textContent = 'Peek at your cards';
    tl.style.color = 'var(--accent)';
    // Update waiting list if overlay is visible
    if (document.getElementById('peek-overlay').style.display !== 'none') {
      renderPeekWaiting(gs);
      // Check if all ready and it's the host
      if (isHost) {
        const allReady = (gs.playerOrder || []).every(pid => gs.peekReady?.[pid]);
        if (allReady) updateGame(roomCode, { phase: 'play' });
      }
    }
  } else {
    tl.textContent = myTurn ? '✦ Your Turn' : `${currentName}'s Turn`;
    tl.style.color = myTurn ? 'var(--accent2)' : 'var(--text)';
  }
  document.getElementById('round-label').textContent = `Round ${gs.round || 1}`;

  // CABO status
  document.getElementById('cabo-status').innerHTML = gs.caboCallerId
    ? `<span class="status-chip chip-cabo">CABO — ${gs.playerNames[gs.caboCallerId]}</span>`
    : '';

  // Score strip
  renderScoreStrip(gs, myId);

  // Opponents
  renderOpponents(gs, myId, myTurn ? pendingAction : null, handleOppCardClick);

  // Deck
  const deckEl = document.getElementById('deck-pile');
  document.getElementById('deck-count').textContent = (gs.deck || []).length;
  deckEl.style.opacity = (gs.deck || []).length === 0 ? '0.3' : '1';

  // Discard
  renderDiscardPile(gs);

  // Drawn card
  renderDrawnCard(gs, myId, pendingAction);

  // My hand
  renderMyHand(gs, myId, myKnownCards, myTurn ? pendingAction : null, handleMyCardClick);

  // My area highlight
  document.getElementById('my-area').className = 'my-area' + (myTurn ? ' my-turn' : '');
  document.getElementById('my-name-label').textContent = myName + ' (you)';

  // Help text
  document.getElementById('help-text').textContent = getHelpText(gs, myId, pendingAction);

  // CABO button
  document.getElementById('cabo-btn').disabled =
    !myTurn || !!gs.caboCallerId || gs.phase !== 'play' || !!gs.drawnCard || !!pendingAction;

  // Log
  const logPanel = document.getElementById('log-panel');
  logPanel.innerHTML = '';
  (gs.log || []).slice(-5).reverse().forEach(e => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = e;
    logPanel.appendChild(div);
  });

  if (gs.phase === 'round-end') showRoundEndModal();
  if (gs.phase === 'game-over' && !document.getElementById('game-over-modal').classList.contains('open')) {
    renderGameOver(gs.scores, gs.playerNames, gs.playerOrder);
  }
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
window.drawFromDeck = async function () {
  if (!isMyTurn() || gameState.phase !== 'play' || gameState.drawnCard || pendingAction) return;
  const gs = gameState;
  if (!gs.deck?.length) return;
  const deck = [...gs.deck];
  const drawn = deck.shift();
  await updateGame(roomCode, {
    deck, drawnCard: drawn,
    log: addLog(gs.log, `<span class="lname">${myName}</span> drew a card`)
  });
};

// ─── DISCARD DRAWN CARD ────────────────────────────────────────────────────────
window.discardDrawnCard = async function () {
  if (!isMyTurn() || !gameState.drawnCard) return;
  const gs = gameState;
  const lbl = cardLabel(gs.drawnCard);
  const updates = {
    drawnCard: null,
    discard: [...(gs.discard || []), gs.drawnCard],
    log: addLog(gs.log, `<span class="lname">${myName}</span> discarded ${lbl}${gs.drawnCard.suit}`)
  };
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);
};

// ─── USE POWER ────────────────────────────────────────────────────────────────
window.usePower = function () {
  if (!isMyTurn() || !gameState.drawnCard) return;
  const power = cardPower(gameState.drawnCard);
  if (!power) return;
  const stepMap = { peek: 'pick', spy: 'pick-opp', blindswap: 'pick-mine', peekswap: 'pick-opp', kingswap: 'pick-opp' };
  pendingAction = { type: power, drawnCard: gameState.drawnCard, step: stepMap[power] };
  renderGame();
};

// ─── HANDLE CARD CLICKS ───────────────────────────────────────────────────────
function handleMyCardClick(pos, card) {
  const gs = gameState;
  const pa = pendingAction;

  if (gs.drawnCard && !pa) {
    swapWithMyCard(pos);
    return;
  }
  if (!pa) return;

  if (pa.type === 'peek' && pa.step === 'pick') { doPeekReveal(pos, card); return; }
  if (pa.type === 'blindswap' && pa.step === 'pick-mine') {
    pendingAction = { ...pa, myPos: pos, step: 'pick-opp' };
    renderGame(); return;
  }
  if (pa.type === 'peekswap' && pa.step === 'pick-mine') { doPeekswapPickMine(pos); return; }
  if (pa.type === 'kingswap' && pa.step === 'pick-mine') { doKingswapPickMine(pos); return; }
}

function handleOppCardClick(oppId, pos) {
  const pa = pendingAction;
  if (!pa) return;
  if (pa.type === 'spy' && pa.step === 'pick-opp') { doSpyReveal(oppId, pos); return; }
  if (pa.type === 'peekswap' && pa.step === 'pick-opp') { doPeekswapPickOpp(oppId, pos); return; }
  if (pa.type === 'kingswap' && pa.step === 'pick-opp') { doKingswapPickOpp(oppId, pos); return; }
  if (pa.type === 'kingswap' && pa.step === 'pick-opp-swap') { doKingswapSwap(oppId, pos); return; }
  if (pa.type === 'blindswap' && pa.step === 'pick-opp') { doBlindswapFinish(oppId, pos); return; }
}

// ─── SWAP WITH MY CARD (keep drawn card) ─────────────────────────────────────
async function swapWithMyCard(pos) {
  if (!isMyTurn() || !gameState.drawnCard) return;
  const gs = gameState;
  const myHand = [...gs.hands[myId]];
  const oldCard = myHand[pos];
  const newCard = gs.drawnCard;
  myHand[pos] = newCard;

  const updates = {
    drawnCard: null,
    discard: [...(gs.discard || []), oldCard],
    [`hands/${myId}`]: myHand,
    log: addLog(gs.log, `<span class="lname">${myName}</span> swapped ${cardLabel(newCard)}${newCard.suit} into position ${pos + 1}`)
  };
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);

  // Animation: drawn card -> hand slot, old card -> discard pile
  await sleep(80);
  const drawnEl = document.querySelector('#drawn-card-display .card-slot');
  const handEls = getCardEls(myId, myId);
  const discardEl = document.querySelector('#discard-pile-display .card-slot') || document.querySelector('#discard-pile-display');

  if (drawnEl && handEls[pos] && discardEl) {
    await animateSwapIntoHand({
      drawnCardEl: drawnEl,
      handSlotEl: handEls[pos],
      discardPileEl: discardEl,
      drawnImgUrl: cardImageUrl(newCard),
      oldImgUrl: cardImageUrl(oldCard)
    });
  }

  // After swap: show the new card face-up in hand for 3s
  myKnownCards.set(pos, newCard);
  renderGame();

  await sleep(120);
  const freshHandEls = getCardEls(myId, myId);
  const el = freshHandEls[pos];
  if (el) {
    await flipCardUp(el, cardImageUrl(newCard));
    await sleep(3000);
    await flipCardDown(el);
    myKnownCards.delete(pos);
    renderGame();
  }
}

// ─── PEEK OWN (7/8) ──────────────────────────────────────────────────────────
function doPeekReveal(pos, card) {
  myKnownCards.set(pos, card);
  const gs = gameState;
  const dc = pendingAction.drawnCard;
  const lbl = cardLabel(card);

  broadcastEvent(roomCode, {
    type: 'peek', actorId: myId, actorName: myName,
    pos, cardLabel: `${lbl}${card.suit}`
  });
  showToast(`Card ${pos + 1}: ${lbl}${card.suit} = ${card.value}pts`, 3000);

  const updates = {
    drawnCard: null,
    discard: [...(gs.discard || []), dc],
    log: addLog(gs.log, `<span class="lname">${myName}</span> peeked at their own card`)
  };
  pendingAction = null;
  Object.assign(updates, computeNextTurn(gs));
  updateGame(roomCode, updates);

  renderGame();
  sleep(120).then(async () => {
    const el = getCardEls(myId, myId)[pos];
    if (el) {
      await flipCardUp(el, cardImageUrl(card));
      await sleep(3000);
      await flipCardDown(el);
      myKnownCards.delete(pos);
      renderGame();
    }
  });
}

// ─── SPY (9/10) ──────────────────────────────────────────────────────────────
function doSpyReveal(oppId, oppPos) {
  const gs = gameState;
  const card = gs.hands[oppId][oppPos];
  const lbl = cardLabel(card);
  const opName = gs.playerNames[oppId];
  const dc = pendingAction.drawnCard;
  pendingAction = { ...pendingAction, step: 'revealed', oppId, oppPos };
  renderGame();
  showToast(`${opName} Card ${oppPos + 1}: ${lbl}${card.suit} = ${card.value}pts`, 3000);
  broadcastEvent(roomCode, {
    type: 'spy', actorId: myId, actorName: myName,
    targetId: oppId, targetName: opName,
    pos: oppPos, cardLabel: `${lbl}${card.suit}`
  });

  // Show the opponent's card face-up briefly for me only
  sleep(100).then(async () => {
    const oppEls = getCardEls(oppId, myId);
    const el = oppEls[oppPos];
    if (el) {
      await flipCardUp(el, cardImageUrl(card));
      await sleep(2800);
      await flipCardDown(el);
    }
  });

  setTimeout(async () => {
    const updates = {
      drawnCard: null,
      discard: [...(gameState.discard || []), dc],
      log: addLog(gameState.log, `<span class="lname">${myName}</span> spied on ${opName}`)
    };
    pendingAction = null;
    Object.assign(updates, computeNextTurn(gameState));
    await updateGame(roomCode, updates);
  }, 3200);
}

// ─── BLIND SWAP (J) ──────────────────────────────────────────────────────────
async function doBlindswapFinish(oppId, oppPos) {
  const gs = gameState;
  const myHand = [...gs.hands[myId]];
  const oppHand = [...gs.hands[oppId]];
  const myPos = pendingAction.myPos;
  const dc = pendingAction.drawnCard;
  [myHand[myPos], oppHand[oppPos]] = [oppHand[oppPos], myHand[myPos]];
  myKnownCards.delete(myPos);
  const opName = gs.playerNames[oppId];

  broadcastEvent(roomCode, {
    type: 'blindswap', actorId: myId, actorName: myName,
    targetId: oppId, targetName: opName, myPos, oppPos
  });

  const updates = {
    drawnCard: null, discard: [...(gs.discard || []), dc],
    [`hands/${myId}`]: myHand, [`hands/${oppId}`]: oppHand,
    log: addLog(gs.log, `<span class="lname">${myName}</span> blind-swapped with ${opName}`)
  };
  pendingAction = null;
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);
}

// ─── PEEK+SWAP (Q) ────────────────────────────────────────────────────────────
function doPeekswapPickOpp(oppId, oppPos) {
  const gs = gameState;
  const card = gs.hands[oppId][oppPos];
  const lbl = cardLabel(card);
  const opName = gs.playerNames[oppId];
  pendingAction = { ...pendingAction, step: 'peek-done', oppId, oppPos };
  broadcastEvent(roomCode, {
    type: 'spy', actorId: myId, actorName: myName,
    targetId: oppId, targetName: opName,
    pos: oppPos, cardLabel: `${lbl}${card.suit}`
  });
  showToast(`${opName} Card ${oppPos + 1}: ${lbl}${card.suit} — pick your card to swap`, 3000);

  // Show opp card briefly
  sleep(100).then(async () => {
    const el = getCardEls(oppId, myId)[oppPos];
    if (el) { await flipCardUp(el, cardImageUrl(card)); }
  });

  renderGame();
  setTimeout(() => {
    // Flip back and move to pick-mine
    const el = getCardEls(oppId, myId)[oppPos];
    if (el) flipCardDown(el);
    if (pendingAction) { pendingAction.step = 'pick-mine'; renderGame(); }
  }, 2500);
}

async function doPeekswapPickMine(myPos) {
  const gs = gameState;
  const myHand = [...gs.hands[myId]];
  const oppHand = [...gs.hands[pendingAction.oppId]];
  const oppPos = pendingAction.oppPos;
  const oppCard = oppHand[oppPos];
  const dc = pendingAction.drawnCard;
  [myHand[myPos], oppHand[oppPos]] = [oppHand[oppPos], myHand[myPos]];
  myKnownCards.set(myPos, oppCard);
  const opName = gs.playerNames[pendingAction.oppId];
  broadcastEvent(roomCode, {
    type: 'swap', actorId: myId, actorName: myName,
    targetId: pendingAction.oppId, targetName: opName, myPos, oppPos
  });
  const updates = {
    drawnCard: null, discard: [...(gs.discard || []), dc],
    [`hands/${myId}`]: myHand, [`hands/${pendingAction.oppId}`]: oppHand,
    log: addLog(gs.log, `<span class="lname">${myName}</span> peeked & swapped with ${opName}`)
  };
  pendingAction = null;
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);
}

// ─── KING SWAP (K) ────────────────────────────────────────────────────────────
function doKingswapPickOpp(oppId, oppPos) {
  const gs = gameState;
  const card = gs.hands[oppId][oppPos];
  const lbl = cardLabel(card);
  const opName = gs.playerNames[oppId];
  pendingAction = { ...pendingAction, step: 'peek-done', oppId, oppPos };
  broadcastEvent(roomCode, {
    type: 'spy', actorId: myId, actorName: myName,
    targetId: oppId, targetName: opName,
    pos: oppPos, cardLabel: `${lbl}${card.suit}`
  });
  showToast(`${opName} Card ${oppPos + 1}: ${lbl}${card.suit} — now pick your card`, 3000);

  sleep(100).then(async () => {
    const el = getCardEls(oppId, myId)[oppPos];
    if (el) { await flipCardUp(el, cardImageUrl(card)); }
  });
  renderGame();
  setTimeout(() => {
    const el = getCardEls(oppId, myId)[oppPos];
    if (el) flipCardDown(el);
    if (pendingAction) { pendingAction.step = 'pick-mine'; renderGame(); }
  }, 2500);
}

function doKingswapPickMine(pos) {
  const gs = gameState;
  const myCard = gs.hands[myId][pos];
  const lbl = cardLabel(myCard);
  pendingAction = { ...pendingAction, step: 'peek-mine', myPos: pos };
  myKnownCards.set(pos, myCard);
  broadcastEvent(roomCode, {
    type: 'peek', actorId: myId, actorName: myName,
    pos, cardLabel: `${lbl}${myCard.suit}`
  });
  showToast(`Your Card ${pos + 1}: ${lbl}${myCard.suit} — pick opponent card to swap`, 3000);

  sleep(100).then(async () => {
    const el = getCardEls(myId, myId)[pos];
    if (el) { await flipCardUp(el, cardImageUrl(myCard)); }
  });
  renderGame();
  setTimeout(() => {
    myKnownCards.delete(pos);
    const el = getCardEls(myId, myId)[pos];
    if (el) flipCardDown(el);
    if (pendingAction) { pendingAction.step = 'pick-opp-swap'; renderGame(); }
  }, 2500);
}

async function doKingswapSwap(oppId, oppPos) {
  const gs = gameState;
  const myHand = [...gs.hands[myId]];
  const oppHand = [...gs.hands[oppId]];
  const myPos = pendingAction.myPos;
  const oppCard = oppHand[oppPos];
  const dc = pendingAction.drawnCard;
  [myHand[myPos], oppHand[oppPos]] = [oppHand[oppPos], myHand[myPos]];
  myKnownCards.set(myPos, oppCard);
  const opName = gs.playerNames[oppId];
  broadcastEvent(roomCode, {
    type: 'swap', actorId: myId, actorName: myName,
    targetId: oppId, targetName: opName, myPos, oppPos
  });
  const updates = {
    drawnCard: null, discard: [...(gs.discard || []), dc],
    [`hands/${myId}`]: myHand, [`hands/${oppId}`]: oppHand,
    log: addLog(gs.log, `<span class="lname">${myName}</span> used King Swap with ${opName}`)
  };
  pendingAction = null;
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);
}

// ─── CABO ─────────────────────────────────────────────────────────────────────
window.callCabo = async function () {
  if (!isMyTurn() || gameState.caboCallerId || gameState.phase !== 'play' || pendingAction) return;
  const gs = gameState;
  const lastTurns = {};
  gs.playerOrder.forEach(pid => { if (pid !== myId) lastTurns[pid] = 1; });
  broadcastEvent(roomCode, { type: 'cabo', actorId: myId, actorName: myName });
  const updates = {
    caboCallerId: myId, lastTurns,
    log: addLog(gs.log, `<span class="lname">${myName}</span> <span style="color:var(--accent)">called CABO! 🎯</span>`)
  };
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);
};

// ─── ROUND END ────────────────────────────────────────────────────────────────
function showRoundEndModal() {
  if (document.getElementById('round-modal').classList.contains('open')) return;
  const gs = gameState;
  const { scored, newScores, gameOver } = computeRoundScores(gs);
  renderRoundEnd(gs, scored, newScores, isHost);
  if (isHost) {
    updateGame(roomCode, {
      scores: newScores,
      phase: gameOver ? 'game-over' : 'round-end'
    });
  }
}

window.nextRound = async function () {
  if (!isHost) return;
  const gs = createNextRoundState(gameState);
  await set(ref(db, `rooms/${roomCode}/game`), gs);
  myKnownCards.clear();
  pendingAction = null;
  lastEventId = null;
  dealAnimPlayed = false;
  document.getElementById('round-modal').classList.remove('open');
  document.getElementById('peek-overlay').style.display = 'none';
};

window.closeRoundModal = function () {
  document.getElementById('round-modal').classList.remove('open');
};
window.playAgain = function () { location.reload(); };

// ─── CHAT ─────────────────────────────────────────────────────────────────────
window.sendChat = async function () {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !roomCode) return;
  input.value = '';
  await set(push(ref(db, `rooms/${roomCode}/chat`)), {
    id: myId, name: myName, text, ts: Date.now()
  });
};

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
document.getElementById('player-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.setName();
});
document.getElementById('join-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.joinRoom();
});
document.getElementById('join-code-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.sendChat();
});

// Boot
setTimeout(() => {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('lobby').style.display = 'flex';
}, 600);
