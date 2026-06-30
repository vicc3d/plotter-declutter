# Plotter Declutter

A browser-based tool that removes hidden geometry from layered SVG plotter art — no install, no server, runs entirely client-side.

**Try it:** open `index.html` in any browser, or visit [3dvic.com/apps/plotter-declutter](https://3dvic.com/apps/plotter-declutter/)

## The problem

Generative rigs (Cavalry, Processing, and similar tools) often export each "iteration" of a composition as a solid **filled** shape — used only to visually mask earlier iterations in a raster preview — plus a **stroke-only** outline of that same shape, in document order (later elements painted on top, same as any SVG renderer).

A pen plotter ignores fill entirely. It draws every stroke in full, including the portions that were only ever meant to be hidden behind a later shape's fill — producing messy, overlapping lines where the artwork was designed to show clean, occluded ribbons.

## The fix

For every stroked path, subtract the union of every filled shape that comes *after* it in document order (i.e. anything painted on top of it). What's left is exactly the portion of that line a viewer would actually see — which is also exactly what the plotter should draw.

Processes a few hundred shapes in under a second, ~1000+ in a few seconds, entirely in-browser via [ClipperLib](https://sourceforge.net/projects/jsclipper/).

## How to use it

1. Open `index.html` (double-click, or drag into a browser tab).
2. Drop your SVG, or click to browse.
3. Compare Before / After.
4. Download the cleaned SVG, ready to send to your plotter.

**Fully offline.** No file is ever uploaded anywhere, and no internet connection is needed at all — `scripts/clipper.js` is vendored locally in this repo (not loaded from a CDN), so the whole tool works the moment you open `index.html`, network or no network.

## Limitations

- Works on `<path>` elements (the typical export shape from Cavalry-style rigs). Native `<rect>`, `<circle>`, `<polygon>`, etc. aren't supported yet.
- Treats each path's first fill rule as a simple filled region; complex even-odd hole patterns within a single path aren't modeled precisely.
- A companion **Python CLI script** (`plotter_declutter.py`, in this repo) does the same thing for users comfortable with the command line, and additionally supports curve-heavy SVGs via `svgelements` + `shapely`.

## Structure

```
plotter-declutter/
├── index.html              ← the tool, double-click and go
├── scripts/
│   └── clipper.js          ← ClipperLib, vendored locally for offline use
├── plotter_declutter.py    ← optional Python CLI alternative
└── README.md
```

## License

MIT
