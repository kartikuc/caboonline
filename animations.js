// ─── ANIMATION ENGINE ─────────────────────────────────────────────────────────

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Get the absolute rect of a card element's center
export function getCardRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

// Create a flying card clone for animations
function createFlyingCard(srcRect, imgUrl, faceUp = false) {
  const clone = document.createElement('div');
  clone.className = 'card-flying';
  const img = document.createElement('img');
  img.src = imgUrl;
  img.draggable = false;
  clone.appendChild(img);
  clone.style.cssText = `
    position: fixed;
    left: ${srcRect.x - srcRect.w / 2}px;
    top: ${srcRect.y - srcRect.h / 2}px;
    width: ${srcRect.w}px;
    height: ${srcRect.h}px;
    z-index: 9999;
    pointer-events: none;
    border-radius: var(--card-radius);
    transform-origin: center center;
    will-change: transform, opacity;
    transition: none;
    box-shadow: 0 8px 32px rgba(0,0,0,0.7);
  `;
  document.body.appendChild(clone);
  return clone;
}

// Animate a card flying from src element to dest element
export async function animateCardFly(srcEl, destEl, options = {}) {
  const {
    imgUrl = 'https://deckofcardsapi.com/static/img/back.png',
    duration = 450,
    flipToFace = false,
    faceImgUrl = null,
    onMidpoint = null
  } = options;

  const srcRect = getCardRect(srcEl);
  const destRect = getCardRect(destEl);

  const clone = createFlyingCard(srcRect, imgUrl);
  document.body.appendChild(clone);

  // Force reflow
  clone.getBoundingClientRect();

  const dx = destRect.x - srcRect.x;
  const dy = destRect.y - srcRect.y;

  // Arc height based on distance
  const dist = Math.sqrt(dx * dx + dy * dy);
  const arcHeight = Math.min(80, dist * 0.18);

  return new Promise(resolve => {
    const startTime = performance.now();
    let midpointFired = false;

    function frame(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const x = srcRect.x - srcRect.w / 2 + dx * ease;
      const y = srcRect.y - srcRect.h / 2 + dy * ease - Math.sin(t * Math.PI) * arcHeight;

      // Slight rotation during flight
      const rotation = Math.sin(t * Math.PI) * 8 * Math.sign(dx || 1);

      clone.style.left = `${x}px`;
      clone.style.top = `${y}px`;
      clone.style.transform = `rotate(${rotation}deg) scale(${1 + Math.sin(t * Math.PI) * 0.06})`;

      // Flip halfway if requested
      if (flipToFace && t >= 0.5 && !midpointFired) {
        midpointFired = true;
        clone.style.transition = 'transform 0.18s ease';
        clone.style.transform = `rotate(${rotation}deg) rotateY(90deg)`;
        setTimeout(() => {
          if (faceImgUrl) clone.querySelector('img').src = faceImgUrl;
          clone.style.transform = `rotate(${rotation}deg) rotateY(0deg)`;
        }, 90);
        if (onMidpoint) onMidpoint();
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        clone.remove();
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

// Deal a card from deck to target slot (face down)
export async function dealCardAnimation(deckEl, targetEl, delay = 0) {
  await sleep(delay);
  const srcRect = getCardRect(deckEl);
  const destRect = getCardRect(targetEl);

  const clone = createFlyingCard(srcRect, 'https://deckofcardsapi.com/static/img/back.png');
  document.body.appendChild(clone);
  clone.getBoundingClientRect();

  const dx = destRect.x - srcRect.x;
  const dy = destRect.y - srcRect.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const arcH = Math.min(60, dist * 0.15);
  const dur = 380;

  return new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / dur, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const x = srcRect.x - srcRect.w / 2 + dx * ease;
      const y = srcRect.y - srcRect.h / 2 + dy * ease - Math.sin(t * Math.PI) * arcH;
      const rot = Math.sin(t * Math.PI) * 5 * Math.sign(dx || 1);
      clone.style.left = `${x}px`;
      clone.style.top = `${y}px`;
      clone.style.transform = `rotate(${rot}deg)`;
      clone.style.opacity = t < 0.9 ? '1' : `${1 - (t - 0.9) * 10}`;
      if (t < 1) requestAnimationFrame(frame);
      else { clone.remove(); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

// Flip a card element face-up
export async function flipCardUp(el, imgUrl) {
  return new Promise(resolve => {
    el.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1)';
    el.style.transform = 'rotateY(90deg)';
    setTimeout(() => {
      const img = el.querySelector('img');
      if (img) img.src = imgUrl;
      el.dataset.faceUp = 'true';
      el.dataset.imgUrl = imgUrl;
      el.style.transform = 'rotateY(0deg)';
      setTimeout(resolve, 300);
    }, 140);
  });
}

// Flip a card element face-down
export async function flipCardDown(el) {
  return new Promise(resolve => {
    el.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1)';
    el.style.transform = 'rotateY(90deg)';
    setTimeout(() => {
      const img = el.querySelector('img');
      if (img) img.src = 'https://deckofcardsapi.com/static/img/back.png';
      el.dataset.faceUp = 'false';
      delete el.dataset.imgUrl;
      el.style.transform = 'rotateY(0deg)';
      setTimeout(resolve, 300);
    }, 140);
  });
}

// Animate a card sliding from one slot to another (e.g., swap into hand / to discard)
export async function slideCardBetween(fromEl, toEl, imgUrl, duration = 380) {
  const srcRect = getCardRect(fromEl);
  const destRect = getCardRect(toEl);

  const clone = createFlyingCard(srcRect, imgUrl);
  clone.getBoundingClientRect();

  const dx = destRect.x - srcRect.x;
  const dy = destRect.y - srcRect.y;
  const arcH = Math.min(50, Math.sqrt(dx * dx + dy * dy) * 0.12);

  return new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = srcRect.x - srcRect.w / 2 + dx * ease;
      const y = srcRect.y - srcRect.h / 2 + dy * ease - Math.sin(t * Math.PI) * arcH;
      const rot = Math.sin(t * Math.PI) * 6 * Math.sign(dx || 1);
      clone.style.left = `${x}px`;
      clone.style.top = `${y}px`;
      clone.style.transform = `rotate(${rot}deg)`;
      if (t < 1) requestAnimationFrame(frame);
      else { clone.remove(); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

// Show a temporary "reveal" animation - card pops up bigger then settles
export async function revealCard(el, imgUrl, holdMs = 3000) {
  await flipCardUp(el, imgUrl);
  el.classList.add('card-reveal-pulse');
  await sleep(holdMs);
  el.classList.remove('card-reveal-pulse');
  await flipCardDown(el);
}

// Animate card going from drawn area to hand slot, replacing old card
// old card slides to discard pile simultaneously  
export async function animateSwapIntoHand({
  drawnCardEl,
  handSlotEl,
  discardPileEl,
  drawnImgUrl,
  oldImgUrl,
}) {
  const drawnRect = getCardRect(drawnCardEl);
  const handRect = getCardRect(handSlotEl);
  const discardRect = getCardRect(discardPileEl);

  // Create two flying cards simultaneously
  const flyIn = createFlyingCard(drawnRect, drawnImgUrl);
  const flyOut = createFlyingCard(handRect, oldImgUrl);

  flyIn.getBoundingClientRect();
  flyOut.getBoundingClientRect();

  const dur = 420;

  // Hide source elements during animation
  drawnCardEl.style.opacity = '0';
  handSlotEl.style.opacity = '0';

  await Promise.all([
    // Drawn card -> hand slot
    new Promise(resolve => {
      const dx = handRect.x - drawnRect.x;
      const dy = handRect.y - drawnRect.y;
      const arcH = Math.min(60, Math.sqrt(dx * dx + dy * dy) * 0.15);
      const start = performance.now();
      function frame(now) {
        const t = Math.min((now - start) / dur, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        flyIn.style.left = `${drawnRect.x - drawnRect.w / 2 + dx * ease}px`;
        flyIn.style.top = `${drawnRect.y - drawnRect.h / 2 + dy * ease - Math.sin(t * Math.PI) * arcH}px`;
        flyIn.style.transform = `rotate(${Math.sin(t * Math.PI) * 8}deg) scale(${1 + Math.sin(t * Math.PI) * 0.05})`;
        if (t < 1) requestAnimationFrame(frame);
        else { flyIn.remove(); resolve(); }
      }
      requestAnimationFrame(frame);
    }),
    // Old card -> discard pile (face up)
    new Promise(resolve => {
      const dx = discardRect.x - handRect.x;
      const dy = discardRect.y - handRect.y;
      const arcH = Math.min(60, Math.sqrt(dx * dx + dy * dy) * 0.15);
      const start = performance.now();
      let flipped = false;
      function frame(now) {
        const t = Math.min((now - start) / dur, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        flyOut.style.left = `${handRect.x - handRect.w / 2 + dx * ease}px`;
        flyOut.style.top = `${handRect.y - handRect.h / 2 + dy * ease - Math.sin(t * Math.PI) * arcH}px`;
        flyOut.style.transform = `rotate(${-Math.sin(t * Math.PI) * 6}deg)`;
        // Flip to face-up at midpoint
        if (t >= 0.5 && !flipped) {
          flipped = true;
          flyOut.style.transition = 'transform 0.15s ease';
          flyOut.querySelector('img').src = oldImgUrl;
        }
        if (t < 1) requestAnimationFrame(frame);
        else { flyOut.remove(); resolve(); }
      }
      requestAnimationFrame(frame);
    })
  ]);

  handSlotEl.style.opacity = '1';
  discardPileEl.style.opacity = '1';
}

// Pulse highlight for swap selection
export function pulseCard(el, color = 'var(--accent)', duration = 600) {
  el.style.boxShadow = `0 0 0 3px ${color}, 0 0 20px ${color}40`;
  setTimeout(() => { el.style.boxShadow = ''; }, duration);
}

// Stagger-deal animation - deals cards with cascading delays
export async function staggerDeal(elements, deckEl, delayBetween = 80) {
  const promises = [];
  elements.forEach((el, i) => {
    promises.push(dealCardAnimation(deckEl, el, i * delayBetween));
  });
  await Promise.all(promises);
}
