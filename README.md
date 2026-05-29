# Shibka 🐾

A cute, physics-based **merge puzzle** — a fan reskin of the Suika / Watermelon
game, but with **dog breeds** instead of fruit. Drop pups into the bin; when two
of the same breed touch, they merge into the next breed up. Work your way from a
tiny **Chihuahua** all the way to the smug, meme-worthy **Shiba Inu**.

## Run locally

It's a plain static site — no build step, no npm. Just serve the folder and open
`index.html`. From this directory:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser.

(Any static file server works; you need a server rather than `file://` only so
the relative `<script>` paths and `localStorage` behave normally.)

Everything runs **fully offline** — `matter-js` is vendored in `vendor/`, dog
faces are drawn procedurally on a canvas, and the system font stack is used. No
network requests at runtime.

## How to play

- **Move** your mouse / finger across the play area (or use **← →**) to aim the
  next pup along the top.
- **Drop** it with a **click**, **Space**, or **tap**. It falls under gravity.
- When two dogs of the **same breed** collide, they **merge** into the next
  breed and you score points.
- Only the five smallest breeds (Chihuahua → Beagle) ever drop in; everything
  bigger only appears through merging.
- A dashed **danger line** sits near the top. If a settled dog stays above it for
  ~2 seconds, it's **game over**.
- Merging two **Shiba Inus** (the biggest) pops them both for a big bonus.
- Your **best** score is saved in `localStorage`.

## Breed progression

Chihuahua → Pomeranian → Pug → Corgi → Beagle → French Bulldog → Dalmatian →
Husky → Golden Retriever → Samoyed → **Shiba Inu** 🐕

## Project structure

```
index.html          markup + stable DOM hooks
css/style.css        warm cream/biscuit palette + layout
js/dogs.js           breed data (LEVELS) + parametric drawDog / offscreen sprites
js/game.js           matter.js setup, input, drop & merge logic, scoring, test hooks
vendor/matter.min.js matter-js 0.20.0 (vendored)
```

## Credits

Shibka is an unofficial **fan clone** of the Suika Game / Watermelon Game merge
mechanic. It is not affiliated with or endorsed by the original creators. Physics
by [matter-js](https://brm.io/matter-js/). All dog art is drawn procedurally in
canvas — no external image assets.
