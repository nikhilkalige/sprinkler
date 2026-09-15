# Sprinkler Spray Simulator

A simple, dependency-free simulation of sprinkler coverage over a grid of trees. Built with plain HTML, CSS, and JavaScript (canvas-based rendering, no libraries or build step).

Live demo: http://www.shortcircuits.dev/sprinkler/

## Features

- **Configurable tree grid** — rows, columns, spacing (ft), and girth/canopy circumference (ft).
- **Configurable sprinkler grid** — rows, columns, spacing (ft), and spray radius (ft), independent of the tree grid.
- **Row/column linking** — a toggle keeps a grid's rows and columns equal (square grid) while you edit either field.
- **Whole-grid offset** — shift the entire sprinkler grid by an X/Y offset (feet), including a "Center Between Trees" preset that drops sprinklers into the gaps between trees.
- **Drag to reposition** — click and drag any sprinkler to see the spray pattern and coverage stats update live.
- **Zoom & pan** — zoom in/out, fit-to-view, mouse-wheel zoom, and click-drag panning on the canvas.
- **Tree blocking mode** — toggle a mode where each sprinkler's wetted area is shaded with the actual shape it reaches, accounting for tree canopies blocking its line of sight, instead of a plain circle.
- **Live coverage analysis** — field area watered (%), trees watered (count), and overwatered overlap (%), recomputed on every change.

## Usage

Open `index.html` directly in a browser, or serve the folder locally:

```
python3 -m http.server
```

No build step or dependencies required.

## Files

- `index.html` — page structure and controls
- `style.css` — layout and styling
- `app.js` — grid generation, canvas rendering, coverage math, and UI wiring
