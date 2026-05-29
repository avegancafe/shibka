// dogs.js — Shibka breed data + parametric procedural dog-face renderer.
// No external images: each breed is drawn once to an offscreen canvas and
// the game blits those onto the main canvas synced to matter.js bodies.

(function (global) {
  "use strict";

  // Authoritative breed/level data from the design spec.
  const LEVELS = [
    { level: 1,  name: "Chihuahua",        radius: 20, furColor: "#E8C9A0", earColor: "#D9B488", muzzleColor: "#F5E6CE", earStyle: "pointy", eyeStyle: "round",  marking: "none",     scoreValue: 1 },
    { level: 2,  name: "Pomeranian",       radius: 26, furColor: "#F4C27A", earColor: "#E0A75C", muzzleColor: "#FDF1DA", earStyle: "floof",  eyeStyle: "round",  marking: "none",     scoreValue: 3 },
    { level: 3,  name: "Pug",              radius: 33, furColor: "#E3C58A", earColor: "#3A2E26", muzzleColor: "#3A2E26", earStyle: "floppy", eyeStyle: "round",  marking: "mask",     scoreValue: 6 },
    { level: 4,  name: "Corgi",            radius: 40, furColor: "#D9742A", earColor: "#B85F1F", muzzleColor: "#FBF6EC", earStyle: "pointy", eyeStyle: "happy",  marking: "patch",    scoreValue: 12 },
    { level: 5,  name: "Beagle",           radius: 48, furColor: "#C77A3A", earColor: "#7A4B26", muzzleColor: "#FBF4E8", earStyle: "floppy", eyeStyle: "sleepy", marking: "patch",    scoreValue: 20 },
    { level: 6,  name: "French Bulldog",   radius: 56, furColor: "#A9A29C", earColor: "#8C857F", muzzleColor: "#EAE5DF", earStyle: "round",  eyeStyle: "round",  marking: "patch",    scoreValue: 32 },
    { level: 7,  name: "Dalmatian",        radius: 64, furColor: "#FBFAF7", earColor: "#2B2B2B", muzzleColor: "#FBFAF7", earStyle: "floppy", eyeStyle: "happy",  marking: "spots",    scoreValue: 48 },
    { level: 8,  name: "Husky",            radius: 72, furColor: "#5B6168", earColor: "#3D4248", muzzleColor: "#F4F5F6", earStyle: "pointy", eyeStyle: "blue",   marking: "mask",     scoreValue: 70 },
    { level: 9,  name: "Golden Retriever", radius: 80, furColor: "#E6B25E", earColor: "#CE9543", muzzleColor: "#F3DDAE", earStyle: "floppy", eyeStyle: "happy",  marking: "none",     scoreValue: 100 },
    { level: 10, name: "Samoyed",          radius: 86, furColor: "#F4EFE4", earColor: "#E1D7C6", muzzleColor: "#FFFFFF", earStyle: "pointy", eyeStyle: "round",  marking: "none",     smile: true, scoreValue: 150 },
    { level: 11, name: "Shiba Inu",        radius: 92, furColor: "#2B2723", earColor: "#211D1A", muzzleColor: "#F3EADA", browColor: "#C77A3A", eyeRing: "#EEE1CB", earStyle: "pointy", eyeStyle: "round",  marking: "eyebrows", smile: true, scoreValue: 256 },
  ];

  // ---- small color helpers -------------------------------------------------
  function shade(hex, amt) {
    // amt > 0 lightens, < 0 darkens
    const c = hex.replace("#", "");
    let r = parseInt(c.substring(0, 2), 16);
    let g = parseInt(c.substring(2, 4), 16);
    let b = parseInt(c.substring(4, 6), 16);
    r = Math.max(0, Math.min(255, Math.round(r + 255 * amt)));
    g = Math.max(0, Math.min(255, Math.round(g + 255 * amt)));
    b = Math.max(0, Math.min(255, Math.round(b + 255 * amt)));
    return `rgb(${r},${g},${b})`;
  }

  // ---- ear drawing ----------------------------------------------------------
  // Ears are drawn in the body's local frame, centered at (0,0), face radius R.
  function drawEars(ctx, R, p) {
    const fur = p.furColor;
    const ear = p.earColor;
    const innerEar = shade(p.earColor, 0.18);

    if (p.earStyle === "pointy") {
      // Two upright triangular ears poking up from the top sides.
      const eo = R * 0.62;           // horizontal offset of each ear
      const ew = R * 0.5;            // ear width
      const eh = R * 0.85;           // ear height
      const topY = -R * 0.78;
      for (const side of [-1, 1]) {
        const cx = side * eo;
        ctx.fillStyle = ear;
        ctx.beginPath();
        ctx.moveTo(cx - ew * 0.5, topY + eh * 0.55);     // outer base
        ctx.quadraticCurveTo(cx - ew * 0.55, topY - eh * 0.35, cx + side * ew * 0.1, topY - eh * 0.55); // tip
        ctx.quadraticCurveTo(cx + ew * 0.55, topY + eh * 0.1, cx + ew * 0.5, topY + eh * 0.55); // inner base
        ctx.closePath();
        ctx.fill();
        // inner ear
        ctx.fillStyle = innerEar;
        ctx.beginPath();
        ctx.moveTo(cx - ew * 0.18, topY + eh * 0.4);
        ctx.quadraticCurveTo(cx, topY - eh * 0.2, cx + side * ew * 0.08, topY - eh * 0.28);
        ctx.quadraticCurveTo(cx + ew * 0.22, topY + eh * 0.05, cx + ew * 0.18, topY + eh * 0.4);
        ctx.closePath();
        ctx.fill();
      }
    } else if (p.earStyle === "floppy") {
      // Down/hanging ears along the sides of the head.
      const eo = R * 0.82;
      const ew = R * 0.46;
      const eh = R * 1.0;
      const topY = -R * 0.35;
      for (const side of [-1, 1]) {
        const cx = side * eo;
        ctx.fillStyle = ear;
        ctx.beginPath();
        ctx.ellipse(cx, topY + eh * 0.4, ew, eh * 0.55, side * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.earStyle === "floof") {
      // Pomeranian: a fluffy ring of fur tufts around the head with small
      // rounded ears peeking out top — a round "floof" silhouette.
      ctx.fillStyle = shade(p.furColor, 0.06);
      const tufts = 13;
      for (let i = 0; i < tufts; i++) {
        const ang = (Math.PI * 2 * i) / tufts - Math.PI / 2;
        const tx = Math.cos(ang) * R * 0.96;
        const ty = Math.sin(ang) * R * 0.96;
        ctx.beginPath();
        ctx.arc(tx, ty, R * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // small rounded ears poking up out of the floof
      const eo = R * 0.5;
      const topY = -R * 0.78;
      for (const side of [-1, 1]) {
        ctx.fillStyle = ear;
        ctx.beginPath();
        ctx.ellipse(side * eo, topY, R * 0.26, R * 0.32, side * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = innerEar;
        ctx.beginPath();
        ctx.ellipse(side * eo, topY + R * 0.04, R * 0.13, R * 0.18, side * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.earStyle === "round") {
      // Bat / round ears (French Bulldog) — wide rounded ears up top.
      const eo = R * 0.6;
      const ew = R * 0.42;
      const eh = R * 0.62;
      const topY = -R * 0.72;
      for (const side of [-1, 1]) {
        const cx = side * eo;
        ctx.fillStyle = ear;
        ctx.beginPath();
        ctx.ellipse(cx, topY, ew, eh, side * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = innerEar;
        ctx.beginPath();
        ctx.ellipse(cx, topY + eh * 0.08, ew * 0.5, eh * 0.6, side * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- eyes -----------------------------------------------------------------
  function drawEyes(ctx, R, p) {
    const ex = R * 0.4;     // eye horizontal offset
    const ey = -R * 0.05;   // eye vertical offset
    const er = R * 0.13;    // eye radius

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (p.eyeStyle === "happy") {
      // Smiley closed upward arcs ^ ^
      ctx.strokeStyle = "#2A211C";
      ctx.lineWidth = Math.max(2, R * 0.07);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * ex, ey + er * 0.4, er * 1.1, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    } else if (p.eyeStyle === "sleepy") {
      // Half-lidded relaxed eyes — a dot with a lid line above.
      for (const side of [-1, 1]) {
        ctx.fillStyle = "#2A211C";
        ctx.beginPath();
        ctx.arc(side * ex, ey + er * 0.3, er * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#2A211C";
        ctx.lineWidth = Math.max(2, R * 0.06);
        ctx.beginPath();
        ctx.arc(side * ex, ey + er * 0.3, er * 1.3, Math.PI * 1.05, Math.PI * 1.95, false);
        ctx.stroke();
      }
    } else if (p.eyeStyle === "blue") {
      // Husky ice-blue eyes with dark pupil + highlight.
      for (const side of [-1, 1]) {
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(side * ex, ey, er * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#6FC4E8";
        ctx.beginPath();
        ctx.arc(side * ex, ey, er * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1E2A33";
        ctx.beginPath();
        ctx.arc(side * ex, ey, er * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(side * ex - er * 0.25, ey - er * 0.3, er * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // round (default): glossy dark eyes with highlight.
      for (const side of [-1, 1]) {
        // Light socket ring so dark eyes stay readable on dark fur (black Shiba).
        if (p.eyeRing) {
          ctx.fillStyle = p.eyeRing;
          ctx.beginPath();
          ctx.arc(side * ex, ey, er * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#2A211C";
        ctx.beginPath();
        ctx.arc(side * ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.arc(side * ex - er * 0.3, ey - er * 0.35, er * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- markings -------------------------------------------------------------
  function drawMarkings(ctx, R, p) {
    if (p.marking === "spots") {
      // Dalmatian polka dots scattered around the face edge.
      ctx.fillStyle = "#2B2B2B";
      const spots = [
        [-0.55, -0.35, 0.12], [0.5, -0.45, 0.1], [0.62, 0.2, 0.13],
        [-0.6, 0.25, 0.11], [0.15, 0.55, 0.1], [-0.2, -0.6, 0.08],
        [0.35, 0.45, 0.07],
      ];
      for (const [sx, sy, sr] of spots) {
        ctx.beginPath();
        ctx.arc(sx * R, sy * R, sr * R, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.marking === "patch") {
      // Asymmetric eye patch (one side darker) for Corgi/Beagle/Frenchie.
      ctx.fillStyle = shade(p.earColor, -0.04);
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(-R * 0.4, -R * 0.05, R * 0.32, R * 0.34, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (p.marking === "eyebrows") {
      // Shiba's iconic tan eyebrow dots above the eyes (the "tan" of black & tan).
      ctx.fillStyle = p.browColor || p.muzzleColor;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * R * 0.42, -R * 0.32, R * 0.11, R * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // "mask" markings are handled inside the muzzle drawing (dark mask region).
  }

  // ---- one parametric dog face ---------------------------------------------
  // Draws centered at (0,0) in current transform; face fills circle radius R.
  function drawDogFace(ctx, p, R) {
    // Ears first so they sit behind the head.
    drawEars(ctx, R, p);

    // Head circle with subtle radial shading for roundness.
    const grad = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.2, 0, 0, R);
    grad.addColorStop(0, shade(p.furColor, 0.08));
    grad.addColorStop(1, p.furColor);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Outline for ball definition.
    ctx.strokeStyle = shade(p.furColor, -0.18);
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, R - ctx.lineWidth * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // Markings beneath the muzzle (patch/spots/eyebrows). Mask handled below.
    if (p.marking === "patch" || p.marking === "spots") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.clip();
      drawMarkings(ctx, R, p);
      ctx.restore();
    }

    // Mask marking: a dark region covering the lower/center face (Pug/Husky/Akita).
    if (p.marking === "mask") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = shade(p.earColor, -0.02);
      ctx.globalAlpha = 0.85;
      // Goggle-ish mask: covers around the eyes and down the muzzle bridge.
      ctx.beginPath();
      ctx.ellipse(0, R * 0.05, R * 0.78, R * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Muzzle / snout patch (lighter two-tone). Drawn after mask so the snout
    // pops out of the mask region (classic husky/akita look).
    ctx.fillStyle = p.muzzleColor;
    ctx.beginPath();
    ctx.ellipse(0, R * 0.32, R * 0.52, R * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyebrows (Shiba) go above eyes, on top of fur.
    if (p.marking === "eyebrows") drawMarkings(ctx, R, p);

    // Eyes.
    drawEyes(ctx, R, p);

    // Nose.
    ctx.fillStyle = "#2A211C";
    ctx.beginPath();
    ctx.ellipse(0, R * 0.22, R * 0.13, R * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-R * 0.04, R * 0.19, R * 0.04, R * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mouth + optional tongue. Shiba gets the classic smug grin.
    ctx.strokeStyle = "#2A211C";
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    ctx.lineCap = "round";
    if (p.smile) {
      // Wide smug grin with a little tongue (Shiba's smug smile / Sammy smile).
      ctx.beginPath();
      ctx.moveTo(-R * 0.22, R * 0.4);
      ctx.quadraticCurveTo(0, R * 0.66, R * 0.22, R * 0.4);
      ctx.stroke();
      // little tongue
      ctx.fillStyle = "#E58A8A";
      ctx.beginPath();
      ctx.ellipse(0, R * 0.5, R * 0.1, R * 0.08, 0, 0, Math.PI);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, R * 0.32);
      ctx.lineTo(0, R * 0.42);
      ctx.moveTo(0, R * 0.42);
      ctx.quadraticCurveTo(-R * 0.12, R * 0.5, -R * 0.18, R * 0.44);
      ctx.moveTo(0, R * 0.42);
      ctx.quadraticCurveTo(R * 0.12, R * 0.5, R * 0.18, R * 0.44);
      ctx.stroke();
    }
  }

  // ---- offscreen pre-render cache ------------------------------------------
  // Pre-render each breed to an offscreen canvas at device-pixel scale so the
  // game just blits them (fast, crisp). Includes a soft drop shadow margin.
  const _cache = {};
  function getSprite(level, dpr) {
    dpr = dpr || (global.devicePixelRatio || 1);
    const key = level + "@" + dpr;
    if (_cache[key]) return _cache[key];

    const def = LEVELS[level - 1];
    const R = def.radius;
    const margin = R * 0.95;             // room for ears + shadow
    const size = (R + margin) * 2;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(size * dpr);
    cv.height = Math.ceil(size * dpr);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);

    // soft drop shadow
    ctx.save();
    ctx.shadowColor = "rgba(90,60,30,0.22)";
    ctx.shadowBlur = R * 0.25;
    ctx.shadowOffsetY = R * 0.12;
    ctx.fillStyle = "rgba(0,0,0,0.001)";
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawDogFace(ctx, def, R);

    const sprite = { canvas: cv, cssSize: size, half: size / 2, def };
    _cache[key] = sprite;
    return sprite;
  }

  global.SHIBKA_DOGS = {
    LEVELS,
    drawDogFace,   // parametric renderer (ctx, params, radius)
    getSprite,     // cached offscreen sprite for a level
    shade,
  };
})(window);
