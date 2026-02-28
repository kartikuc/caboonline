// ─── MAIN APPLICATION ─────────────────────────────────────────────────────────
import { cardImageUrl, cardLabel, cardPower, buildDeck, shuffle, powerLabel } from './cards.js';
import {
  sleep, dealCardAnimation, flipCardUp, flipCardDown,
  revealCard, animateSwapIntoHand, slideCardBetween, staggerDeal, pulseCard
} from './animations.js';
import {
  createInitialGameState, createNextRoundState,
  computeNextTurn, computeRoundScores, addLog, fixArrays, getHelpText,
  addonDiscardFaceValue
} from './gameLogic.js';
import {
  db, ref, set, get, update, onValue, push, remove, off,
  gameRef, playersRef, chatRef, stateRef, hostRef, updateGame, broadcastEvent
} from './firebase.js';
import {
  makeCardEl, renderScoreStrip, renderOpponents, renderMyHand,
  renderDiscardPile, renderDrawnCard, renderRoundEnd, renderGameOver,
  showBanner, showToast, getCardEls, esc,
  renderAddonDiscardButtons, clearAddonDiscardButtons
} from './ui.js';

// ─── STATE ───────────────────────────────────────────────────────────────────
let myId = null, myName = '', roomCode = null;
let gameState = null, isHost = false;
let pendingAction = null;
const myKnownCards = new Map();
let lastEventId = null;
let dealAnimPlayed = false;
let renderingPaused = false;

// ─── ADDON DISCARD STATE ─────────────────────────────────────────────────────
let addonDiscardWindowOpen = false;
let addonDiscardCountdownTimer = null;

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

    // Handle addon discard window open/close
    const ad = gameState.addonDiscard;
    if (ad?.active && !ad?.claimedBy && !addonDiscardWindowOpen) {
      openAddonDiscardWindow(gameState);
    } else if ((!ad?.active || ad?.claimedBy) && addonDiscardWindowOpen) {
      closeAddonDiscardWindow();
    }

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

  // Pause renderGame for the entire dealing + peek sequence
  // so Firebase onValue updates don't wipe our DOM mid-animation
  renderingPaused = true;

  // Render shell with all cards hidden
  renderGameShell(gs);
  await sleep(300);

  const deckEl = document.getElementById('deck-pile');
  const allPlayers = gs.playerOrder || [];

  // PHASE 1: Deal outer cards (pos 0 and 3) face-down to all players
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

  // PHASE 2: Deal inner cards (pos 1 and 2) to all players face-down
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

  // PHASE 3: Flip MY inner cards face-up so the player can peek
  const myHand = gs.hands?.[myId] || [];
  const myCardsEl = document.getElementById('my-cards');
  const myCardEls = [...myCardsEl.querySelectorAll('.card-slot')];

  for (const pos of [1, 2]) {
    const el = myCardEls[pos];
    const card = myHand[pos];
    if (!el || !card) continue;
    const img = el.querySelector('.card-img');
    el.style.transition = 'transform 0.3s';
    el.style.transform = 'rotateY(90deg)';
    await sleep(160);
    if (img) img.src = cardImageUrl(card);
    el.style.transform = 'rotateY(0deg)';
    await sleep(340);
    if (pos === 1) await sleep(150);
  }

  await sleep(300);

  // Show peek overlay
  showPeekOverlay(myHand[1], myHand[2]);
  renderPeekWaiting(gs);
  // Release render pause — peek overlay is showing, game phase still 'initial-peek'
  // renderGame will now run normally but won't show cards face-up (myKnownCards is empty)
  renderingPaused = false;
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

  const gs = gameState;
  const card1 = gs.hands?.[myId]?.[1];
  const card2 = gs.hands?.[myId]?.[2];

  // Hide overlay
  document.getElementById('peek-overlay').style.display = 'none';

  // Pause re-renders for the duration of the flip animation
  renderingPaused = true;

  // Grab card elements fresh from DOM (the dealing anim left them face-up)
  const myCardsEl = document.getElementById('my-cards');
  const cardEls = [...myCardsEl.querySelectorAll('.card-slot')];

  for (const [pos, card] of [[1, card1], [2, card2]]) {
    const el = cardEls[pos];
    if (!el) continue;
    const img = el.querySelector('.card-img');

    // Make sure face is visible before flipping (in case it wasn't already)
    if (img && card) img.src = cardImageUrl(card);
    await sleep(60);

    el.style.transition = 'transform 0.32s ease';
    el.style.transform = 'rotateY(90deg)';
    await sleep(180);

    // Swap image at the midpoint
    if (img) img.src = 'https://deckofcardsapi.com/static/img/back.png';
    el.style.transform = 'rotateY(0deg)';
    await sleep(240);
  }

  // Re-enable renders — cards render face-down correctly (myKnownCards not set)
  renderingPaused = false;

  // Signal Firebase — the onValue loop will detect all-ready and host starts game
  await update(ref(db, `rooms/${roomCode}/game/peekReady`), { [myId]: true });
};

// When peekReady changes, re-render waiting list
// (handled in main onValue callback via renderGame which checks peek overlay visibility)


// ─── ACTION STATUS BOX ────────────────────────────────────────────────────────
function setActionStatus(title, body, step = '') {
  const box = document.getElementById('action-status-box');
  const titleEl = document.getElementById('asb-title');
  const bodyEl = document.getElementById('asb-body');
  if (!box) return;
  if (!title && !body) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  titleEl.textContent = title || 'ACTION';
  bodyEl.innerHTML = body + (step ? `<span class="asb-step">${step}</span>` : '');
}

function clearActionStatus() {
  const box = document.getElementById('action-status-box');
  if (box) box.style.display = 'none';
}

// ─── SHARED EVENTS ────────────────────────────────────────────────────────────
function handleSharedEvent(event) {
  if (!event || event.id === lastEventId) return;
  lastEventId = event.id;
  const actorName = event.actorName || '?';
  const isMe = event.actorId === myId;

  if (event.type === 'peek') {
    showBanner(`👁  ${actorName} peeked at their card`, isMe ? `You saw it` : '');
    setActionStatus('PEEK', `<span class="asb-name">${actorName}</span> peeked at their own card`, isMe ? `Card ${event.pos + 1}: ${event.cardLabel}` : '');
    setTimeout(clearActionStatus, 5500);
  }
  if (event.type === 'spy') {
    const tn = event.targetName || '?';
    showBanner(`🔍  ${actorName} spied on ${tn}`, isMe ? `Card: ${event.cardLabel}` : '');
    setActionStatus('SPY', `<span class="asb-name">${actorName}</span> spied on <span class="asb-action">${tn}</span>`, isMe ? `Card ${event.pos + 1}: ${event.cardLabel}` : 'Card revealed to spy only');
    setTimeout(clearActionStatus, 5500);
    if (!isMe) {
      const els = getCardEls(event.targetId, myId);
      const el = els[event.pos];
      if (el) { pulseCard(el, 'var(--blue)', 1800); }
    }
  }
  if (event.type === 'swap' || event.type === 'blindswap') {
    const tn = event.targetName || '?';
    const label = event.type === 'blindswap' ? 'BLIND SWAP' : 'SWAP';
    showBanner(`🔄  ${actorName} swapped with ${tn}`, '');
    setActionStatus(label, `<span class="asb-name">${actorName}</span> swapped with <span class="asb-action">${tn}</span>`);
    setTimeout(clearActionStatus, 3000);
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
    setActionStatus('CABO!', `<span class="asb-name">${actorName}</span> called CABO! 🎯`, 'Everyone gets one final turn');
    setTimeout(clearActionStatus, 4000);
  }
  if (event.type === 'addon-discard-correct') {
    showBanner(`✅  ${actorName} addon discarded correctly!`, `Now playing with ${event.newHandSize} cards`);
    setActionStatus('ADDON DISCARD ✅', `<span class="asb-name">${actorName}</span> correctly matched — lost a card!`, `Now has ${event.newHandSize} cards`);
    setTimeout(clearActionStatus, 4000);
  }
  if (event.type === 'addon-discard-wrong') {
    showBanner(`❌  ${actorName} addon discard was wrong!`, `Drew a penalty card`);
    setActionStatus('ADDON DISCARD ❌', `<span class="asb-name">${actorName}</span> guessed wrong — drew a penalty!`, `Now has ${event.newHandSize} cards`);
    setTimeout(clearActionStatus, 4000);
  }
}

const isMyTurn = () => gameState?.currentTurn === myId;

// ─── MAIN RENDER ─────────────────────────────────────────────────────────────
function renderGame() {
  if (!gameState || renderingPaused) return;
  const gs = gameState;
  const myTurn = isMyTurn();
  const currentName = gs.playerNames?.[gs.currentTurn] || '?';

  // Header
  const tl = document.getElementById('turn-label');
  if (gs.phase === 'initial-peek') {
    tl.textContent = 'Peek at your cards';
    tl.style.color = 'var(--accent)';
    // Always update the waiting list (visible in overlay or not)
    renderPeekWaiting(gs);
    // Host checks if ALL players have clicked ready — fires every time Firebase updates
    if (isHost) {
      const allReady = (gs.playerOrder || []).every(pid => gs.peekReady?.[pid]);
      if (allReady) updateGame(roomCode, { phase: 'play' });
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
  const helpStr = getHelpText(gs, myId, pendingAction);
  document.getElementById('help-text').textContent = helpStr;

  // Action status box — shows all players what's happening
  if (gs.phase === 'play' && !renderingPaused) {
    const currentName = gs.playerNames?.[gs.currentTurn] || '?';
    const pa = pendingAction;
    if (myTurn && pa) {
      // Show what I'm doing to myself (others see it via events)
      const actionLabels = {
        'peek:pick': ['PEEK OWN', `Choose a card to peek at`],
        'spy:pick-opp': ['SPY', `Choose an opponent's card to spy on`],
        'blindswap:pick-mine': ['BLIND SWAP', `Choose YOUR card to swap`],
        'blindswap:pick-opp': ['BLIND SWAP', `Now choose an opponent's card`],
        'peekswap:pick-opp': ['PEEK + SWAP', `Choose opponent's card to peek at`],
        'peekswap:peek-done': ['PEEK + SWAP', `Peeking...`],
        'peekswap:pick-mine': ['PEEK + SWAP', `Now choose YOUR card to swap out`],
        'kingswap:pick-opp': ['KING SWAP', `Choose opponent's card to peek at`],
        'kingswap:peek-done': ['KING SWAP', `Peeking opponent card...`],
        'kingswap:pick-mine': ['KING SWAP', `Now choose YOUR card to peek at`],
        'kingswap:peek-mine': ['KING SWAP', `Peeking your card...`],
        'kingswap:pick-opp-swap': ['KING SWAP', `Now choose opponent's card to swap`],
      };
      const key = `${pa.type}:${pa.step}`;
      const [label, desc] = actionLabels[key] || ['ACTION', helpStr];
      setActionStatus(label, `<span class="asb-name">You</span> — <span class="asb-action">${desc}</span>`);
    } else if (myTurn && gs.drawnCard) {
      setActionStatus('YOUR TURN', `<span class="asb-name">You</span> drew a card — discard or swap into hand`);
    } else if (myTurn && !gs.drawnCard) {
      setActionStatus('YOUR TURN', `<span class="asb-name">You</span> — draw a card or call CABO`);
    } else if (!myTurn && !pa) {
      // Show what other player is doing
      if (gs.drawnCard) {
        setActionStatus('DECIDING', `<span class="asb-name">${currentName}</span> is deciding what to do with their drawn card`);
      } else {
        setActionStatus('DRAWING', `<span class="asb-name">${currentName}</span> is taking their turn`);
      }
    }
  } else if (gs.phase === 'initial-peek') {
    setActionStatus('PEEK PHASE', `All players are memorizing their inner cards`);
  }

  // CABO button
  if (gs.phase === 'round-end' || gs.phase === 'game-over') clearActionStatus();
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
  const discardedCard = gs.drawnCard;
  const updates = {
    drawnCard: null,
    discard: [...(gs.discard || []), discardedCard],
    log: addLog(gs.log, `<span class="lname">${myName}</span> discarded ${lbl}${discardedCard.suit}`)
  };
  Object.assign(updates, computeNextTurn(gs));
  await updateGame(roomCode, updates);
  triggerAddonDiscardWindow(discardedCard);
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
  triggerAddonDiscardWindow(oldCard);

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

  // After swap: pause renders, show new card face-up for 3s, then flip back
  renderingPaused = true;
  renderGame();
  await sleep(120);
  const freshHandEls = getCardEls(myId, myId);
  const swapEl = freshHandEls[pos];
  if (swapEl) {
    const swapImg = swapEl.querySelector('.card-img');
    if (swapImg) {
      swapEl.style.transition = 'transform 0.3s ease';
      swapEl.style.transform = 'rotateY(90deg)';
      await sleep(160);
      swapImg.src = cardImageUrl(newCard);
      swapEl.style.transform = 'rotateY(0deg)';
      await sleep(5000);
      swapEl.style.transform = 'rotateY(90deg)';
      await sleep(160);
      swapImg.src = 'https://deckofcardsapi.com/static/img/back.png';
      swapEl.style.transform = 'rotateY(0deg)';
      await sleep(200);
    }
  }
  renderingPaused = false;
  renderGame();
}

// ─── PEEK OWN (7/8) ──────────────────────────────────────────────────────────
function doPeekReveal(pos, card) {
  const gs = gameState;
  const dc = pendingAction.drawnCard;
  const lbl = cardLabel(card);

  broadcastEvent(roomCode, {
    type: 'peek', actorId: myId, actorName: myName,
    pos, cardLabel: `${lbl}${card.suit}`
  });
  showToast(`Card ${pos + 1}: ${lbl}${card.suit} = ${card.value}pts`, 5400);

  const updates = {
    drawnCard: null,
    discard: [...(gs.discard || []), dc],
    log: addLog(gs.log, `<span class="lname">${myName}</span> peeked at their own card`)
  };
  pendingAction = null;
  Object.assign(updates, computeNextTurn(gs));
  updateGame(roomCode, updates);
  triggerAddonDiscardWindow(dc);

  // Pause renders, flip card face-up, hold 5s, flip back, resume
  renderingPaused = true;
  setActionStatus('PEEKING', `<span class="asb-name">You</span> are peeking at card ${pos + 1}`, `${lbl}${card.suit} = ${card.value}pts`);
  renderGame();
  sleep(80).then(async () => {
    const el = getCardEls(myId, myId)[pos];
    if (el) {
      const img = el.querySelector('.card-img');
      if (img) {
        el.style.transition = 'transform 0.3s ease';
        el.style.transform = 'rotateY(90deg)';
        await sleep(160);
        img.src = cardImageUrl(card);
        el.style.transform = 'rotateY(0deg)';
        await sleep(5000);
        el.style.transform = 'rotateY(90deg)';
        await sleep(160);
        img.src = 'https://deckofcardsapi.com/static/img/back.png';
        el.style.transform = 'rotateY(0deg)';
        await sleep(200);
      }
    }
    renderingPaused = false;
    renderGame();
  });
}

// ─── SPY (9/10) ──────────────────────────────────────────────────────────────
function doSpyReveal(oppId, oppPos) {
  const gs = gameState;
  const card = gs.hands[oppId][oppPos];
  const lbl = cardLabel(card);
  const opName = gs.playerNames[oppId];
  const dc = pendingAction.drawnCard;
  pendingAction = null;

  showToast(`${opName} Card ${oppPos + 1}: ${lbl}${card.suit} = ${card.value}pts`, 5400);
  broadcastEvent(roomCode, {
    type: 'spy', actorId: myId, actorName: myName,
    targetId: oppId, targetName: opName,
    pos: oppPos, cardLabel: `${lbl}${card.suit}`
  });

  // Pause renders, flip opponent card face-up, hold 5s, flip back, then end turn
  renderingPaused = true;
  setActionStatus('SPYING', `<span class="asb-name">You</span> spied on <span class="asb-action">${opName}</span>`, `Card ${oppPos + 1}: ${lbl}${card.suit} = ${card.value}pts`);
  renderGame();
  sleep(80).then(async () => {
    const el = getCardEls(oppId, myId)[oppPos];
    if (el) {
      const img = el.querySelector('.card-img');
      if (img) {
        el.style.transition = 'transform 0.3s ease';
        el.style.transform = 'rotateY(90deg)';
        await sleep(160);
        img.src = cardImageUrl(card);
        el.style.transform = 'rotateY(0deg)';
        await sleep(5000);
        el.style.transform = 'rotateY(90deg)';
        await sleep(160);
        img.src = 'https://deckofcardsapi.com/static/img/back.png';
        el.style.transform = 'rotateY(0deg)';
        await sleep(200);
      }
    }
    renderingPaused = false;
    // End turn
    const updates = {
      drawnCard: null,
      discard: [...(gameState.discard || []), dc],
      log: addLog(gameState.log, `<span class="lname">${myName}</span> spied on ${opName}`)
    };
    Object.assign(updates, computeNextTurn(gameState));
    await updateGame(roomCode, updates);
    triggerAddonDiscardWindow(dc);
  });
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
  triggerAddonDiscardWindow(dc);
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
  showToast(`${opName} Card ${oppPos + 1}: ${lbl}${card.suit} — pick your card to swap`, 5400);

  // Show opp card briefly
  // Pause renders and flip opp card face-up for 2.5s, then move to pick-mine
  renderingPaused = true;
  renderGame();
  sleep(80).then(async () => {
    const peekEl = getCardEls(oppId, myId)[oppPos];
    if (peekEl) {
      const peekImg = peekEl.querySelector('.card-img');
      if (peekImg) {
        peekEl.style.transition = 'transform 0.3s ease';
        peekEl.style.transform = 'rotateY(90deg)';
        await sleep(160);
        peekImg.src = cardImageUrl(card);
        peekEl.style.transform = 'rotateY(0deg)';
        await sleep(5000);
        peekEl.style.transform = 'rotateY(90deg)';
        await sleep(160);
        peekImg.src = 'https://deckofcardsapi.com/static/img/back.png';
        peekEl.style.transform = 'rotateY(0deg)';
        await sleep(200);
      }
    }
    renderingPaused = false;
    if (pendingAction) { pendingAction.step = 'pick-mine'; renderGame(); }
  });
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
  triggerAddonDiscardWindow(dc);
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
  showToast(`${opName} Card ${oppPos + 1}: ${lbl}${card.suit} — now pick your card`, 5400);

  renderingPaused = true;
  renderGame();
  sleep(80).then(async () => {
    const kingOppEl = getCardEls(oppId, myId)[oppPos];
    if (kingOppEl) {
      const kingOppImg = kingOppEl.querySelector('.card-img');
      if (kingOppImg) {
        kingOppEl.style.transition = 'transform 0.3s ease';
        kingOppEl.style.transform = 'rotateY(90deg)';
        await sleep(160);
        kingOppImg.src = cardImageUrl(card);
        kingOppEl.style.transform = 'rotateY(0deg)';
        await sleep(5000);
        kingOppEl.style.transform = 'rotateY(90deg)';
        await sleep(160);
        kingOppImg.src = 'https://deckofcardsapi.com/static/img/back.png';
        kingOppEl.style.transform = 'rotateY(0deg)';
        await sleep(200);
      }
    }
    renderingPaused = false;
    if (pendingAction) { pendingAction.step = 'pick-mine'; renderGame(); }
  });
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
  showToast(`Your Card ${pos + 1}: ${lbl}${myCard.suit} — pick opponent card to swap`, 5400);

  renderingPaused = true;
  renderGame();
  sleep(80).then(async () => {
    const myPeekEl = getCardEls(myId, myId)[pos];
    if (myPeekEl) {
      const myPeekImg = myPeekEl.querySelector('.card-img');
      if (myPeekImg) {
        myPeekEl.style.transition = 'transform 0.3s ease';
        myPeekEl.style.transform = 'rotateY(90deg)';
        await sleep(160);
        myPeekImg.src = cardImageUrl(myCard);
        myPeekEl.style.transform = 'rotateY(0deg)';
        await sleep(5000);
        myPeekEl.style.transform = 'rotateY(90deg)';
        await sleep(160);
        myPeekImg.src = 'https://deckofcardsapi.com/static/img/back.png';
        myPeekEl.style.transform = 'rotateY(0deg)';
        await sleep(200);
      }
    }
    renderingPaused = false;
    if (pendingAction) { pendingAction.step = 'pick-opp-swap'; renderGame(); }
  });
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
  triggerAddonDiscardWindow(dc);
}

// ─── ADDON DISCARD ────────────────────────────────────────────────────────────

// Call this right after any card lands on the discard pile.
// discardedCard is the card object that was just added.
async function triggerAddonDiscardWindow(discardedCard) {
  if (!isHost) return; // only host writes this to avoid races
  const gs = gameState;
  if (!gs || gs.phase !== 'play') return;

  const faceValue = addonDiscardFaceValue(discardedCard);
  await updateGame(roomCode, {
    addonDiscard: {
      active: true,
      discardFaceValue: faceValue,
      claimedBy: null,
      expiresAt: Date.now() + 5000
    }
  });

  // Auto-close after 5.2s if nobody claimed
  setTimeout(async () => {
    const cur = gameState?.addonDiscard;
    if (cur?.active && !cur?.claimedBy) {
      await updateGame(roomCode, { 'addonDiscard/active': false });
    }
  }, 5200);
}

// Called when a player clicks Addon Discard on one of their cards.
// Uses a Firebase transaction on claimedBy for FCFS atomicity.
window.handleAddonDiscardClick = async function (cardIndex) {
  const gs = gameState;
  if (!gs?.addonDiscard?.active) return;
  if (gs.addonDiscard.claimedBy) return; // already claimed
  const myHand = gs.hands?.[myId] || [];
  if (myHand.length <= 1) return; // can't discard last card

  // Attempt to claim via update (Firebase last-write for exact-null check isn't a true transaction,
  // but we guard with claimedBy null check server-side in resolveAddonDiscard)
  // Use a timestamp-based claim attempt — first to set claimedBy wins
  const adRef = ref(db, `rooms/${roomCode}/game/addonDiscard/claimedBy`);

  // Firebase transaction for true FCFS atomicity
  const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
  const result = await runTransaction(adRef, current => {
    if (current === null || current === undefined) {
      return myId; // I win the race
    }
    return; // abort — someone already claimed
  });

  if (!result.committed) return; // someone else was faster

  // I won the race — now resolve
  await resolveAddonDiscard(cardIndex);
};

async function resolveAddonDiscard(cardIndex) {
  const gs = gameState;
  const myHand = [...(gs.hands?.[myId] || [])];

  // Safety checks
  if (myHand.length <= 1) {
    showToast("You can't discard your last card!", 2500);
    await updateGame(roomCode, { 'addonDiscard/active': false });
    return;
  }

  const chosenCard = myHand[cardIndex];
  if (!chosenCard) return;

  const discardFaceValue = gs.addonDiscard?.discardFaceValue;
  const chosenFaceValue = addonDiscardFaceValue(chosenCard);
  const isMatch = chosenFaceValue === discardFaceValue;

  const chosenLabel = `${cardLabel(chosenCard)}${chosenCard.suit}`;
  const topLabel = cardLabel(gs.discard?.[gs.discard.length - 1]);

  let updates = { 'addonDiscard/active': false };

  if (isMatch) {
    // Remove card from hand — play with one fewer card permanently
    const newHand = myHand.filter((_, i) => i !== cardIndex);
    updates[`hands/${myId}`] = newHand;
    updates['discard'] = [...(gs.discard || []), chosenCard];
    updates['log'] = addLog(gs.log,
      `<span class="lname">${myName}</span> ✅ addon-discarded ${chosenLabel} — correct! Now has ${newHand.length} cards`
    );
    broadcastEvent(roomCode, {
      type: 'addon-discard-correct', actorId: myId, actorName: myName,
      cardLabel: chosenLabel, newHandSize: newHand.length
    });
    // Update myKnownCards — remove the discarded index, shift down higher indices
    const newKnown = new Map();
    myKnownCards.forEach((card, idx) => {
      if (idx < cardIndex) newKnown.set(idx, card);
      else if (idx > cardIndex) newKnown.set(idx - 1, card);
    });
    myKnownCards.clear();
    newKnown.forEach((v, k) => myKnownCards.set(k, v));
    showToast(`✅ Correct! ${chosenLabel} matches ${topLabel}. Card discarded — you now have ${newHand.length} cards!`, 4000);
  } else {
    // Wrong — draw a card from the deck as penalty
    const deck = [...(gs.deck || [])];
    if (deck.length === 0) {
      showToast('Deck empty — no penalty card drawn', 2000);
      await updateGame(roomCode, updates);
      return;
    }
    const penaltyCard = deck.shift();
    const newHand = [...myHand, penaltyCard];
    updates[`hands/${myId}`] = newHand;
    updates['deck'] = deck;
    updates['log'] = addLog(gs.log,
      `<span class="lname">${myName}</span> ❌ wrong addon discard (${chosenLabel} ≠ ${topLabel}) — drew a penalty card`
    );
    broadcastEvent(roomCode, {
      type: 'addon-discard-wrong', actorId: myId, actorName: myName,
      cardLabel: chosenLabel, newHandSize: newHand.length
    });
    showToast(`❌ Wrong! ${chosenLabel} doesn't match ${topLabel}. You draw a penalty card.`, 4000);
  }

  await updateGame(roomCode, updates);
}

function openAddonDiscardWindow(gs) {
  if (addonDiscardWindowOpen) return;
  addonDiscardWindowOpen = true;
  const myHand = gs.hands?.[myId] || [];
  if (myHand.length <= 1) return; // nothing to show

  renderAddonDiscardButtons(myHand, (cardIndex) => {
    window.handleAddonDiscardClick(cardIndex);
  });

  // Countdown timer display
  let remaining = 5;
  const timerEl = document.getElementById('addon-discard-timer');
  if (timerEl) timerEl.textContent = remaining;
  addonDiscardCountdownTimer = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.textContent = remaining;
    if (remaining <= 0) closeAddonDiscardWindow();
  }, 1000);
}

function closeAddonDiscardWindow() {
  if (!addonDiscardWindowOpen) return;
  addonDiscardWindowOpen = false;
  clearInterval(addonDiscardCountdownTimer);
  addonDiscardCountdownTimer = null;
  clearAddonDiscardButtons();
}


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
  closeAddonDiscardWindow();
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
