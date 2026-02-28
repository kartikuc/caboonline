// ─── UI RENDERING ─────────────────────────────────────────────────────────────
import { cardImageUrl, cardLabel, cardPower, powerLabel } from './cards.js';

// Create a card element (img-based)
export function makeCardEl(card, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card-slot';

  const img = document.createElement('img');
  img.className = 'card-img';
  img.draggable = false;

  const faceDown = opts.faceDown || !card;
  img.src = faceDown
    ? 'https://deckofcardsapi.com/static/img/back.png'
    : cardImageUrl(card);

  if (!faceDown) {
    el.dataset.faceUp = 'true';
    el.dataset.imgUrl = cardImageUrl(card);
  }
  if (card) el.dataset.cardJson = JSON.stringify(card);

  el.appendChild(img);
  return el;
}

// Render the score strip
export function renderScoreStrip(gs, myId) {
  const strip = document.getElementById('score-strip');
  if (!strip) return;
  strip.innerHTML = '';
  (gs.playerOrder || []).forEach(pid => {
    const div = document.createElement('div');
    div.className = 'score-badge' + (pid === gs.currentTurn ? ' active-player' : '');
    const isMe = pid === myId;
    div.innerHTML = `
      <span class="sname">${gs.playerNames[pid]}${isMe ? ' ★' : ''}</span>
      <span class="sval">${gs.scores?.[pid] ?? 0}</span>
    `;
    strip.appendChild(div);
  });
}

// Render opponent zones
export function renderOpponents(gs, myId, pendingAction, onOppCardClick) {
  const oppArea = document.getElementById('opponents-area');
  if (!oppArea) return;
  oppArea.innerHTML = '';

  (gs.playerOrder || []).filter(pid => pid !== myId).forEach(pid => {
    const zone = document.createElement('div');
    zone.className = 'opponent-zone' + (pid === gs.currentTurn ? ' active-turn' : '');
    zone.dataset.pid = pid;

    const nameEl = document.createElement('div');
    nameEl.className = 'opponent-name';
    nameEl.textContent = gs.playerNames[pid];
    zone.appendChild(nameEl);

    const hand = gs.hands?.[pid] || [];
    const row = document.createElement('div');
    row.className = 'hand-row';

    hand.forEach((c, i) => {
      const el = makeCardEl(null, { faceDown: true });

      const pa = pendingAction;
      const clickable = pa && (
        (pa.type === 'spy' && pa.step === 'pick-opp') ||
        (pa.type === 'peekswap' && pa.step === 'pick-opp') ||
        (pa.type === 'kingswap' && pa.step === 'pick-opp') ||
        (pa.type === 'kingswap' && pa.step === 'pick-opp-swap') ||
        (pa.type === 'blindswap' && pa.step === 'pick-opp')
      );

      if (clickable) {
        el.classList.add('selectable');
        el.onclick = () => onOppCardClick(pid, i);
      } else {
        el.classList.add('not-selectable');
      }

      row.appendChild(el);
    });

    zone.appendChild(row);
    oppArea.appendChild(zone);
  });
}

// Render my hand
export function renderMyHand(gs, myId, myKnownCards, pendingAction, onMyCardClick) {
  const myCardsEl = document.getElementById('my-cards');
  if (!myCardsEl) return;
  myCardsEl.innerHTML = '';

  const myHand = gs.hands?.[myId] || [];
  myHand.forEach((card, i) => {
    const known = myKnownCards.has(i);
    const pa = pendingAction;
    const kingShowMine = pa?.type === 'kingswap' && pa.step === 'peek-mine' && pa.myPos === i;
    const faceUp = known || kingShowMine;

    const el = makeCardEl(faceUp ? card : null, { faceDown: !faceUp });

    if (gs.phase === 'play') {
      let clickable = false;
      if (gs.drawnCard && !pa) clickable = true;
      else if (pa?.type === 'peek' && pa.step === 'pick') clickable = true;
      else if (pa?.type === 'blindswap' && pa.step === 'pick-mine') clickable = true;
      else if (pa?.type === 'peekswap' && pa.step === 'pick-mine') clickable = true;
      else if (pa?.type === 'kingswap' && pa.step === 'pick-mine') clickable = true;

      if (clickable) {
        el.classList.add('selectable');
        el.onclick = () => onMyCardClick(i, card);
      } else {
        el.classList.add('not-selectable');
      }

      if (pa?.myPos === i) el.classList.add('selected');
    } else {
      el.classList.add('not-selectable');
    }

    myCardsEl.appendChild(el);
  });
}

// Render discard pile
export function renderDiscardPile(gs) {
  const dd = document.getElementById('discard-pile-display');
  if (!dd) return;
  const discardArr = gs.discard || [];
  const top = discardArr[discardArr.length - 1] || null;
  dd.innerHTML = '';
  if (top) {
    const el = makeCardEl(top);
    el.classList.add('not-selectable');
    dd.appendChild(el);
  } else {
    dd.innerHTML = '<div class="discard-empty">+</div>';
  }
}

// Render drawn card area
export function renderDrawnCard(gs, myId, pendingAction) {
  const drawnArea = document.getElementById('drawn-card-area');
  const myTurn = gs.currentTurn === myId;
  if (!drawnArea) return;

  if (gs.drawnCard && myTurn && !pendingAction) {
    drawnArea.style.display = 'flex';
    const container = document.getElementById('drawn-card-display');
    if (container) {
      container.innerHTML = '';
      const dEl = makeCardEl(gs.drawnCard);
      dEl.classList.add('not-selectable');
      container.appendChild(dEl);
    }
    const power = cardPower(gs.drawnCard);
    const pb = document.getElementById('use-power-btn');
    if (pb) {
      if (power) {
        pb.style.display = 'block';
        pb.textContent = powerLabel(power);
      } else {
        pb.style.display = 'none';
      }
    }
  } else {
    drawnArea.style.display = 'none';
  }
}

// Render round end modal content
export function renderRoundEnd(gs, scored, newScores, isHost) {
  let html = '<div class="score-table">';
  scored.forEach(r => {
    const handStr = r.hand.map(c => `${cardLabel(c)}${c.suit}(${c.value})`).join(' ');
    html += `<div class="score-row ${r.pts === 0 ? 'winner' : ''}">
      <span style="font-size:11px">${r.name}${r.pid === gs.caboCallerId ? ' 📣' : ''}: ${handStr}</span>
      <span style="white-space:nowrap">+${r.pts}→${newScores[r.pid]}</span>
    </div>`;
  });
  html += '</div>';
  document.getElementById('round-modal-content').innerHTML = html;
  document.getElementById('next-round-btn').style.display = isHost ? 'block' : 'none';
  document.getElementById('round-modal').classList.add('open');
}

// Render game over modal
export function renderGameOver(scores, names, order) {
  document.getElementById('round-modal')?.classList.remove('open');
  const sorted = order
    .map(pid => ({ pid, name: names[pid], score: scores[pid] }))
    .sort((a, b) => a.score - b.score);
  document.getElementById('gameover-title').textContent = `${sorted[0].name} Wins! 🎉`;
  let html = '<div class="score-table">';
  sorted.forEach((p, i) => {
    html += `<div class="score-row ${i === 0 ? 'winner' : ''}">
      <span>${i + 1}. ${p.name}</span><span>${p.score}pts</span>
    </div>`;
  });
  html += '</div>';
  document.getElementById('gameover-content').innerHTML = html;
  document.getElementById('game-over-modal').classList.add('open');
}

// Show an event banner
export function showBanner(title, subtitle = '') {
  document.querySelectorAll('.event-banner').forEach(b => b.remove());
  const div = document.createElement('div');
  div.className = 'event-banner';
  div.innerHTML = `
    <div class="ev-title">${title}</div>
    ${subtitle ? `<div class="ev-sub">${subtitle}</div>` : ''}
  `;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// Show a toast at bottom
export function showToast(msg, duration = 2500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-hide'), duration - 300);
  setTimeout(() => t.remove(), duration);
}

// Get card elements for a given player id
export function getCardEls(pid, myId) {
  if (pid === myId) {
    return [...document.getElementById('my-cards').querySelectorAll('.card-slot')];
  }
  const zones = document.querySelectorAll('.opponent-zone');
  for (const zone of zones) {
    if (zone.dataset.pid === pid) return [...zone.querySelectorAll('.card-slot')];
  }
  return [];
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── ADDON DISCARD UI ─────────────────────────────────────────────────────────

// Renders the addon-discard banner and buttons below each of the local player's cards.
// onCardClick(cardIndex) is called when the player clicks a card button.
// Strategy: render buttons in a separate #addon-btns-row that mirrors the hand layout,
// so we never touch the existing .card-slot elements.
export function renderAddonDiscardButtons(myHand, onCardClick) {
  clearAddonDiscardButtons();

  const myArea = document.getElementById('my-area');
  if (!myArea) return;

  // Banner
  const banner = document.createElement('div');
  banner.id = 'addon-discard-banner';
  banner.className = 'addon-discard-banner';
  banner.innerHTML = `
    <span class="addon-discard-title">⚡ Addon Discard!</span>
    <span class="addon-discard-hint">Match the discard pile's rank with one of your cards</span>
    <span class="addon-discard-countdown"><span id="addon-discard-timer">5</span>s</span>
  `;
  myArea.insertBefore(banner, myArea.firstChild);

  // Separate row of buttons that sits below #my-cards, visually aligned
  const myCardsEl = document.getElementById('my-cards');
  if (!myCardsEl) return;

  const btnRow = document.createElement('div');
  btnRow.id = 'addon-btns-row';
  btnRow.className = 'addon-btns-row';

  myHand.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'addon-discard-btn';
    btn.textContent = 'Addon Discard';
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.addon-discard-btn').forEach(b => b.disabled = true);
      onCardClick(i);
    };
    btnRow.appendChild(btn);
  });

  // Insert the button row right after #my-cards
  myCardsEl.insertAdjacentElement('afterend', btnRow);
}

export function clearAddonDiscardButtons() {
  document.getElementById('addon-discard-banner')?.remove();
  document.getElementById('addon-btns-row')?.remove();
}
