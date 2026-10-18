# Plotter Declutter

A browser-based tool that removes hidden geometry from layered SVG plotter art: no install, no server, runs entirely client-side.

**Try it:** open `index.html` in any browser, or visit [3dvic.com/apps/plotter-declutter](https://3dvic.com/apps/plotter-declutter/)

## The problem

This tool exists because Cron, a member of the Affinity Discord community,
ran into exactly this problem with a real plotter composition and asked
about it.

Generative rigs (Cavalry, Processing, and similar tools) often export each "iteration" of a composition as a solid **filled** shape (used only to visually mask earlier iterations in a raster preview) plus a **stroke-only** outline of that same shape, in document order (later elements painted on top, same as any SVG renderer).

A pen plotter ignores fill entirely. It draws every stroke in full, including the portions that were only ever meant to be hidden behind a later shape's fill, producing messy, overlapping lines where the artwork was designed to show clean, occluded ribbons.

## The fix

For every stroked path, subtract the union of every filled shape that comes *after* it in document order (i.e. anything painted on top of it). What's left is exactly the portion of that line a viewer would actually see, which is also exactly what the plotter should draw.

Processes a few hundred shapes in under a second, ~1000+ in a few seconds, entirely in-browser via [ClipperLib](https://sourceforge.net/projects/jsclipper/).

## Features

- **2D Hidden Line Removal (HLR)**: Cleans overlapping vector line drawings instantly.
- **Basic Shape Conversion**: Automatically converts `<rect>` (including rounded rects), `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, and `<polygon>` elements to equivalent paths on import.
- **Color Layer Preservation**: Groups paths by their stroke colors into nested SVG groups (`<g id="layer-..." stroke="...">`) and DXF layers.
- **Interactive Layer Checklist**: Toggle individual color layers on and off to filter views and select which colors to download.
- **TSP Path Optimization**: Sorts paths using a Nearest Neighbor (TSP) algorithm with automatic line reversal to minimize physical pen lift travel distance ("air travel") and plot faster.
- **Light/Dark BG Toggle**: Change the preview canvas background to light or dark mode; strokes dynamically adjust contrast for perfect visibility.
- **Dual Export**: Export clean SVGs or DXF format files.

## How to use it

1. Open `index.html` (double-click, or drag into a browser tab).
2. Drop your SVG, or click to browse.
3. Use the checkboxes to toggle layers, select the canvas background mode, or activate TSP path sorting.
4. Compare Before / After.
5. Download the cleaned SVG or DXF, ready to send to your plotter.

**Fully offline.** No file is ever uploaded anywhere, and no internet connection is needed at all: `scripts/clipper.js` is vendored locally in this repo (not loaded from a CDN), so the whole tool works the moment you open `index.html`, network or no network.

## CLI Tools

We provide two command-line tools to declutter SVGs headlessly:

### 1. Node.js CLI (`declutter-cli.js`)
A zero-dependency JavaScript CLI that runs out of the box in Node.
*   **Single File**: `node declutter-cli.js input.svg output_clean.svg`
*   **Batch Directory**: `node declutter-cli.js ./my_svgs_folder/`
*   **Disable sorting**: append `--no-sort`

### 2. Python CLI (`plotter_declutter.py`)
An alternative python CLI that handles curve-heavy SVGs via `svgelements` + `shapely` dependencies.

## Affinity Script (Native)

A native version (`scripts/affinity/plotter_declutter_native.js`) that runs
directly inside Affinity, for shapes already imported into the document --
no browser, no export/reimport round trip.

**How to use it:**
1. Import or paste your plotter/generative-art SVG into an Affinity document.
2. Select all the shapes that make up the artwork (Edit > Select All works
   even if they're nested inside a group, as SVG imports usually are).
3. Run the script.
4. Each shape is clipped to only the portion not covered by shapes drawn
   after it. Shapes fully hidden behind later shapes are removed entirely.

**Known limitation:** works on closed shapes (real filled/fillable areas).
Open strokes with no closed area (plain lines straight out of some rigs)
aren't clipped correctly yet.

**Known issue:** running this on a document with a *linked* (not embedded)
source SVG has been reported to run very slowly and, in one case, crash --
likely related to live source-file syncing during the operation. Works
fine on embedded/pasted artwork. If you hit this, let us know what you see.

This exists because Affinity's boolean operations (union/subtract) are
implemented natively but not yet exposed in the documented scripting API --
Cron went back to the Affinity team to confirm they were reachable at all,
which is the only reason this script could be built. Validated end-to-end
by Cron on a real ~180-shape generative composition (37.8s). Thanks for
pushing on this.

## Structure

```
plotter-declutter/
├── index.html              ← the web tool, double-click and go
├── declutter-cli.js        ← Node.js CLI tool (zero dependencies)
├── plotter_declutter.py    ← optional Python CLI alternative
├── scripts/
│   ├── clipper.js                        ← ClipperLib, vendored locally for offline use
│   └── affinity/
│       └── plotter_declutter_native.js   ← native Affinity Script version
└── README.md
```

## License

MIT

