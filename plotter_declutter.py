#!/usr/bin/env python3
"""
plotter_declutter.py — removes hidden geometry from layered SVG plotter art.

THE PROBLEM
-----------
Generative rigs (Cavalry, Processing, etc.) often export each "iteration" as
a solid FILLED shape -- used only to visually mask earlier iterations in a
raster preview/render -- plus a STROKE-only outline of that same shape, in
document order (later elements are painted on top, same as any SVG renderer).
A pen plotter ignores fill entirely, so it ends up drawing every stroke in
full, including the portions that were only ever meant to be hidden behind a
later shape's fill. The result: messy, overlapping lines where the artwork
was designed to show clean, occluded ribbons.

THE FIX
-------
Walk every <path> that has a stroke, and subtract the union of every FILLED
shape that comes after it in document order (i.e. anything painted on top of
it) from its own outline. What's left is exactly the portion of that line a
viewer would actually see -- which is also exactly what the plotter should
draw. No manual booleans, no Affinity, no upper bound on iteration count
(processes a couple hundred shapes in well under a second).

USAGE
-----
    python3 plotter_declutter.py input.svg output.svg
    python3 plotter_declutter.py input.svg output.svg --tolerance 0.25

`--tolerance` controls how densely curves (if any) get sampled into line
segments before the boolean step, in document units. Straight-line paths
(the common case for this kind of rig) are unaffected by this setting.

REQUIRES: svgelements, shapely  (pip install svgelements shapely)
"""
import argparse
import sys
import time

from svgelements import SVG, Path
from shapely.geometry import Polygon, LineString
from shapely.validation import make_valid


def flatten_path(path, tolerance=0.25):
    """Sample a (possibly curved) svgelements Path into a flat list of
    (x, y) points, already in document space (transforms applied), dense
    enough that consecutive points are within `tolerance` units of each
    other along the curve. Straight-line (M/L/Z) paths are returned as-is,
    point for point -- no resampling artifacts."""
    points = []
    for seg in path:
        name = type(seg).__name__
        if name == 'Move':
            points.append((seg.end.x, seg.end.y))
            continue
        length = seg.length()
        if not length:
            continue
        if name == 'Line':
            points.append((seg.end.x, seg.end.y))
        else:
            n = max(1, int(length / tolerance))
            for i in range(1, n + 1):
                pt = seg.point(i / n)
                points.append((pt.x, pt.y))

    cleaned = []
    for p in points:
        if not cleaned or abs(p[0] - cleaned[-1][0]) > 1e-9 or abs(p[1] - cleaned[-1][1]) > 1e-9:
            cleaned.append(p)
    return cleaned


def to_valid_polygon(points):
    """Build a Polygon, repairing self-intersections (common in dense
    rosette/spirograph-style generative shapes) via make_valid()."""
    if len(points) < 3:
        return None
    poly = Polygon(points)
    return poly if poly.is_valid else make_valid(poly)


def collect_lines(geom, out):
    """Flatten any LineString/MultiLineString/GeometryCollection result of a
    shapely boolean op into a flat list of LineStrings."""
    if geom is None or geom.is_empty:
        return
    if geom.geom_type in ('LineString', 'LinearRing'):
        out.append(geom)
    elif geom.geom_type in ('MultiLineString', 'GeometryCollection'):
        for sub in geom.geoms:
            collect_lines(sub, out)


def declutter(svg_path, tolerance=0.25, verbose=True):
    doc = SVG.parse(svg_path)
    paths = [e for e in doc.elements() if isinstance(e, Path)]
    if verbose:
        print(f'[declutter] {len(paths)} <path> elements found.')

    shapes = []
    for p in paths:
        fill, stroke = p.fill, p.stroke
        has_fill = fill is not None and str(fill).lower() not in ('none', 'transparent')
        has_stroke = stroke is not None and str(stroke).lower() not in ('none', 'transparent')
        if not has_fill and not has_stroke:
            continue
        shapes.append({
            'points': flatten_path(p, tolerance),
            'has_fill': has_fill,
            'has_stroke': has_stroke,
            'stroke': str(stroke) if has_stroke else '#000000',
            'stroke_width': p.stroke_width or 1,
        })

    n = len(shapes)
    mask = None
    visible = [None] * n
    t0 = time.time()
    for k in range(n - 1, -1, -1):
        s = shapes[k]
        poly = to_valid_polygon(s['points'])

        if s['has_stroke']:
            boundary = poly.exterior if poly is not None else LineString(s['points'])
            visible[k] = boundary if mask is None else boundary.difference(mask)

        if s['has_fill'] and poly is not None:
            mask = poly if mask is None else mask.union(poly)

    if verbose:
        print(f'[declutter] occlusion solved for {n} shapes in {time.time()-t0:.2f}s')

    lines_out = []
    for k, s in enumerate(shapes):
        if not s['has_stroke']:
            continue
        flat = []
        collect_lines(visible[k], flat)
        for line in flat:
            lines_out.append((line, s['stroke'], s['stroke_width']))

    width = doc.width or 1000
    height = doc.height or 1000
    return lines_out, width, height


def write_svg(lines_out, width, height, out_path):
    parts = [
        '<?xml version="1.0" encoding="utf-8" ?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
    ]
    for line, stroke, stroke_width in lines_out:
        coords = list(line.coords)
        if len(coords) < 2:
            continue
        d = 'M' + ' L'.join(f'{x:.3f} {y:.3f}' for x, y in coords)
        parts.append(
            f'<path fill="none" stroke="{stroke}" stroke-width="{stroke_width}" '
            f'stroke-miterlimit="10" d="{d}"/>'
        )
    parts.append('</svg>')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input_svg')
    ap.add_argument('output_svg')
    ap.add_argument('--tolerance', type=float, default=0.25,
                     help='Curve-flattening density in document units (default: 0.25). Ignored for straight-line paths.')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    lines_out, width, height = declutter(args.input_svg, args.tolerance, verbose=not args.quiet)
    write_svg(lines_out, width, height, args.output_svg)
    if not args.quiet:
        print(f'[declutter] wrote {len(lines_out)} visible line segments -> {args.output_svg}')


if __name__ == '__main__':
    main()
