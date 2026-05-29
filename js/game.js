// game.js — Shibka: a Suika/watermelon merge game reskinned with dog breeds.
// matter.js physics + a synced canvas overlay that draws procedural dog faces.

(function () {
  "use strict";

  const { Engine, World, Bodies, Body, Composite, Events } = Matter;
  const DOGS = window.SHIBKA_DOGS;
  const LEVELS = DOGS.LEVELS;

  // ---- world / play-area config -------------------------------------------
  const W = 420;             // world width (matches canvas CSS pixel width)
  const H = 640;             // world height
  const WALL = 14;           // wall thickness
  const DROP_Y = 70;         // y where a held dog sits before dropping
  const DANGER_Y = 120;      // danger line y
  const DROP_COOLDOWN = 450; // ms between drops
  const GAMEOVER_GRACE = 2000; // ms a dog may sit above the danger line
  const MAX_DROP_LEVEL = 5;  // only levels 1..5 can be dropped

  const palette = {
    background: "#FBF3E7",
    container: "#FFFCF7",
    dangerLine: "#E5743F",
    accent: "#F2A03D",
  };

  // ---- DOM ------------------------------------------------------------------
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const nextEl = document.getElementById("next-dog");
  const restartBtn = document.getElementById("restart-button");
  const gameOverEl = document.getElementById("game-over");
  const finalScoreEl = document.getElementById("final-score");

  // The physics world is a fixed W×H (420×640); only the *display* scales to
  // fill the viewport, so the board grows on big screens instead of sitting in a
  // tiny fixed column. spriteRatio = device px per world unit, kept in sync so
  // the procedural dog faces re-render crisp at whatever size we're showing.
  const dpr = window.devicePixelRatio || 1;
  let spriteRatio = dpr;
  function fitCanvas() {
    const aspect = W / H;
    const wide = window.innerWidth >= 860;
    const banner = document.querySelector(".dedication");
    const bh = banner ? banner.offsetHeight : 0; // dedication header eats some height
    let dispW, dispH;
    if (wide) {
      // desktop: board fills the height between the side panels
      const availH = window.innerHeight - 48 - bh;
      const availW = window.innerWidth - 540; // room for left + right panels
      dispH = Math.max(420, availH);
      dispW = dispH * aspect;
      if (dispW > availW) { dispW = Math.max(260, availW); dispH = dispW / aspect; }
    } else {
      // mobile/narrow: fill the width (page scrolls for the panels below)
      dispW = Math.min(window.innerWidth - 24, 460);
      dispH = dispW / aspect;
      const maxH = window.innerHeight - 150 - bh;
      if (maxH > 380 && dispH > maxH) { dispH = maxH; dispW = dispH * aspect; }
    }
    canvas.style.width = dispW + "px";
    canvas.style.height = dispH + "px";
    const ratio = (dispW / W) * dpr;      // device px per world unit
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // quantize so resizing doesn't spawn endless sprite-cache variants
    spriteRatio = Math.min(3, Math.max(1, Math.round(ratio * 2) / 2));
  }
  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  // Weighted toward the smallest breeds (classic Suika feel): Chihuahua /
  // Pomeranian dominate and big Beagles are rare, so the board fills slowly.
  // Declared before the state below so the initial randDropLevel() calls don't
  // hit the const's temporal dead zone.
  const DROP_WEIGHTS = [1, 1, 1, 2, 2, 3, 4, 5]; // levels, biased to L1..L3
  function randDropLevel() {
    const level = DROP_WEIGHTS[Math.floor(Math.random() * DROP_WEIGHTS.length)];
    return Math.min(level, MAX_DROP_LEVEL);
  }

  // ---- engine ---------------------------------------------------------------
  let engine, world;
  let score = 0;
  let best = Number(localStorage.getItem("shibka_best") || 0);
  let gameOver = false;
  // Two-dog queue, like the original: heldLevel is the dog you aim with at the
  // top, nextLevel is the "on deck" dog previewed in the Next box.
  let heldLevel = randDropLevel();
  let nextLevel = randDropLevel();
  let heldX = W / 2;
  let canDrop = true;
  let aboveLineSince = Object.create(null); // bodyId -> timestamp first seen above line

  function setupEngine() {
    engine = Engine.create();
    engine.gravity.y = 1.0;
    world = engine.world;

    const wallOpts = { isStatic: true, friction: 0.5, restitution: 0.1, render: { visible: false } };
    const floor = Bodies.rectangle(W / 2, H - WALL / 2, W, WALL, wallOpts);
    const left = Bodies.rectangle(WALL / 2, H / 2, WALL, H, wallOpts);
    const right = Bodies.rectangle(W - WALL / 2, H / 2, WALL, H, wallOpts);
    floor.label = left.label = right.label = "wall";
    World.add(world, [floor, left, right]);

    Events.on(engine, "collisionStart", handleCollisions);
  }

  // ---- dog bodies -----------------------------------------------------------
  function makeDog(level, x, y) {
    const def = LEVELS[level - 1];
    const body = Bodies.circle(x, y, def.radius, {
      restitution: 0.2,
      friction: 0.5,
      frictionStatic: 0.5,
      density: 0.001,
      label: "dog",
    });
    body.shibLevel = level;
    body.merging = false;
    return body;
  }

  function addDog(level, x, y) {
    const body = makeDog(level, x, y);
    World.add(world, body);
    return body;
  }

  function clampX(x, level) {
    const r = LEVELS[level - 1].radius;
    return Math.max(WALL + r, Math.min(W - WALL - r, x));
  }

  // ---- dropping -------------------------------------------------------------
  function dropDog() {
    if (gameOver || !canDrop) return;
    const level = heldLevel;
    const x = clampX(heldX, level);
    const body = addDog(level, x, DROP_Y);
    Body.setVelocity(body, { x: 0, y: 0 });

    // advance the queue: on-deck dog becomes held, draw a fresh on-deck dog.
    heldLevel = nextLevel;
    nextLevel = randDropLevel();
    updateNextPreview();

    canDrop = false;
    setTimeout(() => { canDrop = true; }, DROP_COOLDOWN);
  }

  // ---- merging --------------------------------------------------------------
  function handleCollisions(evt) {
    const pairs = evt.pairs;
    const toMerge = [];
    for (const pair of pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label !== "dog" || b.label !== "dog") continue;
      if (a.merging || b.merging) continue;
      if (a.shibLevel !== b.shibLevel) continue;
      // Flag immediately so neither body participates in another merge this tick.
      a.merging = true;
      b.merging = true;
      toMerge.push([a, b]);
    }
    for (const [a, b] of toMerge) mergePair(a, b);
  }

  // collisionStart only fires the frame two bodies first touch. Same-level dogs
  // that come to rest already touching (e.g. a freshly spawned merge sitting
  // beside an equal, or a slow pile settling two equals into contact) never get
  // a collisionStart and would otherwise stall forever. This per-frame sweep
  // catches those resting/post-merge contacts. The `merging` flag guards against
  // double-merges within a tick.
  const MERGE_EPSILON = 1.5;
  function sweepResting() {
    const dogs = getDogBodies();
    for (let i = 0; i < dogs.length; i++) {
      const a = dogs[i];
      if (a.merging) continue;
      for (let j = i + 1; j < dogs.length; j++) {
        const b = dogs[j];
        if (b.merging) continue;
        if (a.shibLevel !== b.shibLevel) continue;
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= a.circleRadius + b.circleRadius + MERGE_EPSILON) {
          a.merging = true;
          b.merging = true;
          mergePair(a, b);
          break; // a is consumed; move to next i
        }
      }
    }
  }

  function mergePair(a, b) {
    const level = a.shibLevel;
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;

    Composite.remove(world, a);
    Composite.remove(world, b);

    if (level >= 11) {
      // Two Shibas pop — big bonus, no new body (the "double watermelon").
      addScore(LEVELS[10].scoreValue * 4);
      spawnBurst(mx, my, LEVELS[10].furColor);
      return;
    }

    const newLevel = level + 1;
    const merged = addDog(newLevel, mx, my);
    // gentle pop upward so merges feel lively
    Body.setVelocity(merged, { x: 0, y: -1 });
    addScore(LEVELS[newLevel - 1].scoreValue);
    spawnBurst(mx, my, LEVELS[newLevel - 1].furColor);
  }

  function addScore(n) {
    score += n;
    scoreEl.textContent = score;
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("shibka_best", String(best));
    }
  }

  // ---- merge burst particles (purely cosmetic) ------------------------------
  let bursts = [];
  function spawnBurst(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      bursts.push({
        x, y,
        vx: Math.cos(a) * (1.5 + Math.random()),
        vy: Math.sin(a) * (1.5 + Math.random()),
        life: 1, color,
      });
    }
  }
  function updateBursts() {
    for (const p of bursts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 0.04;
    }
    bursts = bursts.filter((p) => p.life > 0);
  }

  // ---- game over check ------------------------------------------------------
  function checkGameOver(now) {
    if (gameOver) return;
    const dogs = getDogBodies();
    const present = Object.create(null);
    for (const d of dogs) {
      if (d.merging) continue;
      const top = d.position.y - d.circleRadius;
      // A dog still plummeting downward is mid-drop just passing the line — don't
      // count it. Otherwise any dog whose top edge sits above the line is a
      // danger, even if it's gently jittering as a tall pile settles.
      const fallingFast = d.velocity.y > 3;
      if (top < DANGER_Y && !fallingFast) {
        if (!aboveLineSince[d.id]) aboveLineSince[d.id] = now;
        present[d.id] = true;
        if (now - aboveLineSince[d.id] > GAMEOVER_GRACE) {
          endGame();
          return;
        }
      }
    }
    // forget bodies that are no longer above the line
    for (const id in aboveLineSince) {
      if (!present[id]) delete aboveLineSince[id];
    }
  }

  function endGame() {
    gameOver = true;
    finalScoreEl.textContent = score;
    gameOverEl.classList.remove("hidden");
  }

  // ---- helpers --------------------------------------------------------------
  function getDogBodies() {
    return Composite.allBodies(world).filter((b) => b.label === "dog");
  }

  // ---- rendering ------------------------------------------------------------
  function render() {
    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, W, H);

    // container card
    ctx.fillStyle = palette.container;
    roundRect(ctx, WALL / 2, DROP_Y - 20, W - WALL, H - DROP_Y, 18);
    ctx.fill();

    // danger line
    ctx.strokeStyle = palette.dangerLine;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WALL, DANGER_Y);
    ctx.lineTo(W - WALL, DANGER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // held / next dog at the top + guide line. Always shown while playing so the
    // aim affordance stays continuous; dimmed during the post-drop cooldown to
    // signal that a drop isn't available yet (but still tracking heldX).
    if (!gameOver) {
      const x = clampX(heldX, heldLevel);
      const dim = canDrop ? 1 : 0.4;
      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = 0.35 * dim;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, DROP_Y);
      ctx.lineTo(x, H - WALL);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = dim;
      drawSprite(heldLevel, x, DROP_Y, 0);
      ctx.globalAlpha = 1;
    }

    // dogs
    for (const d of getDogBodies()) {
      drawSprite(d.shibLevel, d.position.x, d.position.y, d.angle);
    }

    // bursts
    for (const p of bursts) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * p.life + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSprite(level, x, y, angle) {
    const sprite = DOGS.getSprite(level, spriteRatio);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(
      sprite.canvas,
      -sprite.half, -sprite.half,
      sprite.cssSize, sprite.cssSize
    );
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- next preview ---------------------------------------------------------
  function updateNextPreview() {
    const def = LEVELS[nextLevel - 1];
    nextEl.innerHTML = "";

    // Render the actual cached breed sprite (scaled into a small box) so the
    // preview matches the on-board art instead of a bare color swatch.
    const box = 28; // CSS px the preview sprite occupies
    const sprite = DOGS.getSprite(nextLevel, dpr);
    const cv = document.createElement("canvas");
    cv.className = "next-sprite";
    cv.width = Math.round(box * dpr);
    cv.height = Math.round(box * dpr);
    cv.style.width = box + "px";
    cv.style.height = box + "px";
    const c = cv.getContext("2d");
    c.drawImage(sprite.canvas, 0, 0, cv.width, cv.height);

    const label = document.createElement("span");
    label.textContent = def.name;
    nextEl.appendChild(cv);
    nextEl.appendChild(label);
  }

  // ---- dog evolution ring ---------------------------------------------------
  // A circular display of the full breed progression (Chihuahua → … → Shiba),
  // echoing the original game's "Fruit Evolution" wheel. Each dog is hoverable /
  // tappable to reveal its breed name (see the handlers further down).
  const EVO_SIZE = 230;          // CSS px the ring canvas occupies
  let evoHits = [];              // [{x, y, r, name, level}] in CSS px, for hit-testing
  function drawEvolutionRing(highlight) {
    if (highlight === undefined) highlight = -1;
    const cv = document.getElementById("evolution-ring");
    if (!cv) return;
    const size = EVO_SIZE;
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.width = size + "px";
    cv.style.height = size + "px";
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2, RR = 84;

    // faint dashed guide ring
    c.strokeStyle = "rgba(138,116,88,0.25)";
    c.lineWidth = 2;
    c.setLineDash([3, 6]);
    c.beginPath();
    c.arc(cx, cy, RR, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);

    const n = LEVELS.length;
    evoHits = [];
    for (let i = 0; i < n; i++) {
      const def = LEVELS[i];
      const ang = -Math.PI / 2 + (Math.PI * 2 * i) / n; // start at top, clockwise
      const x = cx + Math.cos(ang) * RR;
      const y = cy + Math.sin(ang) * RR;
      const sprite = DOGS.getSprite(def.level, dpr);
      // grow display size with level so the Shiba reads as the goal
      const displayDiam = 20 + (def.radius / 92) * 18; // ~20 .. 38 px
      const hovered = i === highlight;
      const scale = hovered ? 1.22 : 1;
      const drawSize = sprite.cssSize * (displayDiam / (def.radius * 2)) * scale;

      // soft highlight disc behind the hovered dog
      if (hovered) {
        c.fillStyle = "rgba(242,160,61,0.30)";
        c.beginPath();
        c.arc(x, y, displayDiam / 2 + 7, 0, Math.PI * 2);
        c.fill();
      }
      c.drawImage(sprite.canvas, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
      evoHits.push({ x, y, r: displayDiam / 2 + 5, name: def.name, level: def.level });
    }

    // center hint
    c.fillStyle = "rgba(138,116,88,0.85)";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "700 13px -apple-system, BlinkMacSystemFont, sans-serif";
    c.fillText("Merge", cx, cy - 7);
    c.fillText("to evolve", cx, cy + 9);
  }

  // Hover / tap a dog in the ring to reveal its breed name in a small tooltip.
  function setupEvolutionRing() {
    const cv = document.getElementById("evolution-ring");
    const tip = document.getElementById("evo-tip");
    if (!cv || !tip) return;
    let hover = -1;

    function pick(clientX, clientY) {
      const rect = cv.getBoundingClientRect();
      const x = (clientX - rect.left) * (EVO_SIZE / rect.width);
      const y = (clientY - rect.top) * (EVO_SIZE / rect.height);
      for (let i = 0; i < evoHits.length; i++) {
        const h = evoHits[i];
        if (Math.hypot(x - h.x, y - h.y) <= h.r) return i;
      }
      return -1;
    }
    function showTip(i) {
      const h = evoHits[i];
      tip.textContent = `${h.level}. ${h.name}`;
      tip.style.left = cv.offsetLeft + h.x + "px";
      tip.style.top = cv.offsetTop + h.y - h.r - 6 + "px";
      tip.classList.remove("hidden");
    }
    function hideTip() { tip.classList.add("hidden"); }
    function set(i) {
      if (i !== hover) { hover = i; drawEvolutionRing(i); }
      cv.style.cursor = i >= 0 ? "pointer" : "default";
      if (i >= 0) showTip(i); else hideTip();
    }

    cv.addEventListener("mousemove", (e) => set(pick(e.clientX, e.clientY)));
    cv.addEventListener("mouseleave", () => set(-1));
    cv.addEventListener("click", (e) => set(pick(e.clientX, e.clientY)));
    cv.addEventListener("touchstart", (e) => {
      if (!e.touches[0]) return;
      const i = pick(e.touches[0].clientX, e.touches[0].clientY);
      if (i >= 0) { e.preventDefault(); set(i); }
    }, { passive: false });
  }

  // ---- main loop (fixed timestep) ------------------------------------------
  let last = 0;
  let acc = 0;
  const STEP = 1000 / 60;
  function loop(t) {
    if (!last) last = t;
    let dt = t - last;
    last = t;
    if (dt > 100) dt = 100; // clamp big gaps (tab switch)
    acc += dt;
    while (acc >= STEP) {
      if (!gameOver) {
        Engine.update(engine, STEP);
        sweepResting();
      }
      acc -= STEP;
    }
    updateBursts();
    checkGameOver(performance.now());
    render();
    requestAnimationFrame(loop);
  }

  // ---- input ----------------------------------------------------------------
  function pointerX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener("mousemove", (e) => {
    heldX = clampX(pointerX(e.clientX), heldLevel);
  });
  canvas.addEventListener("mousedown", (e) => {
    heldX = clampX(pointerX(e.clientX), heldLevel);
    dropDog();
  });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches[0]) heldX = clampX(pointerX(e.touches[0].clientX), heldLevel);
  }, { passive: false });
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches[0]) heldX = clampX(pointerX(e.touches[0].clientX), heldLevel);
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    dropDog();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") heldX = clampX(heldX - 14, heldLevel);
    else if (e.key === "ArrowRight") heldX = clampX(heldX + 14, heldLevel);
    else if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); dropDog(); }
  });

  restartBtn.addEventListener("click", reset);

  // ---- reset ----------------------------------------------------------------
  function reset() {
    if (engine) {
      Events.off(engine, "collisionStart", handleCollisions);
      World.clear(world, false);
      Engine.clear(engine);
    }
    score = 0;
    gameOver = false;
    canDrop = true;
    bursts = [];
    aboveLineSince = Object.create(null);
    heldLevel = randDropLevel();
    nextLevel = randDropLevel();
    heldX = W / 2;
    scoreEl.textContent = "0";
    bestEl.textContent = best;
    gameOverEl.classList.add("hidden");
    setupEngine();
    updateNextPreview();
  }

  // ---- boot -----------------------------------------------------------------
  setupEngine();
  bestEl.textContent = best;
  scoreEl.textContent = "0";
  updateNextPreview();
  drawEvolutionRing();
  setupEvolutionRing();
  requestAnimationFrame(loop);

  // ---- test hooks (Playwright) ---------------------------------------------
  window.__SHIBKA = {
    get score() { return score; },
    get best() { return best; },
    get gameOver() { return gameOver; },
    get dogCount() { return getDogBodies().length; },
    get levels() { return getDogBodies().map((b) => b.shibLevel); },
    // Force-create a dog at canvas/world coords (coords are 1:1 with world).
    spawnAt(level, x, y) {
      level = Math.max(1, Math.min(11, level | 0));
      return addDog(level, x, y);
    },
    reset,
    LEVELS: LEVELS.map((d) => ({ level: d.level, name: d.name, radius: d.radius })),
  };
})();
