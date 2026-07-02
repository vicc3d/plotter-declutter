#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ================================================================ //
// Load ClipperLib securely using vm                                 //
// ================================================================ //
let ClipperLib;
try {
  const clipperPath = path.join(__dirname, 'scripts', 'clipper.js');
  if (!fs.existsSync(clipperPath)) {
    throw new Error(`Clipper library not found at: ${clipperPath}`);
  }
  const clipperCode = fs.readFileSync(clipperPath, 'utf8');
  const sandbox = { Math, Array, Object, String, Number, RegExp, parseFloat, parseInt, console, navigator: { userAgent: '' } };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(clipperCode, sandbox);
  ClipperLib = sandbox.ClipperLib;
} catch (err) {
  console.error("Error loading ClipperLib:", err.message);
  process.exit(1);
}

// ================================================================ //
// Helper functions                                                 //
// ================================================================ //
const SCALE = 1000;
function toClipperPath(points) { return points.map(([x,y]) => ({ X: Math.round(x*SCALE), Y: Math.round(y*SCALE) })); }
function fromClipperPath(path) { return path.map(p => [p.X/SCALE, p.Y/SCALE]); }
function collectAllPolygons(polytree) {
  const out = [];
  function walk(node) {
    if (node.m_polygon && node.m_polygon.length >= 2) out.push(node.m_polygon);
    const childs = node.m_Childs || (node.Childs ? node.Childs() : []);
    for (const c of childs) walk(c);
  }
  const top = polytree.m_Childs || polytree.Childs();
  for (const c of top) walk(c);
  return out;
}
function lineMinusMask(points, maskPaths) {
  if (maskPaths.length === 0) return [points];
  const subj = toClipperPath(points);
  const cpr = new ClipperLib.Clipper();
  cpr.AddPath(subj, ClipperLib.PolyType.ptSubject, false);
  cpr.AddPaths(maskPaths, ClipperLib.PolyType.ptClip, true);
  const polytree = new ClipperLib.PolyTree();
  cpr.Execute(ClipperLib.ClipType.ctDifference, polytree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return collectAllPolygons(polytree).map(fromClipperPath);
}
function unionInto(maskPaths, points) {
  const poly = toClipperPath(points);
  if (!ClipperLib.Clipper.Area(poly)) return maskPaths;
  if (maskPaths.length === 0) return [poly];
  const cpr = new ClipperLib.Clipper();
  cpr.AddPaths(maskPaths, ClipperLib.PolyType.ptSubject, true);
  cpr.AddPath(poly, ClipperLib.PolyType.ptClip, true);
  const solution = new ClipperLib.Paths();
  cpr.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return solution;
}

function dist(x0,y0,x1,y1){return Math.hypot(x1-x0,y1-y0);}
function bezierLength(x0,y0,x1,y1,x2,y2,x3,y3){return dist(x0,y0,x1,y1)+dist(x1,y1,x2,y2)+dist(x2,y2,x3,y3);}
function quadLength(x0,y0,x1,y1,x2,y2){return dist(x0,y0,x1,y1)+dist(x1,y1,x2,y2);}
function cubicPoint(x0,y0,x1,y1,x2,y2,x3,y3,t){const mt=1-t,a=mt*mt*mt,b=3*mt*mt*t,c=3*mt*t*t,d=t*t*t;return[a*x0+b*x1+c*x2+d*x3,a*y0+b*y1+c*y2+d*y3];}
function quadPoint(x0,y0,x1,y1,x2,y2,t){const mt=1-t,a=mt*mt,b=2*mt*t,c=t*t;return[a*x0+b*x1+c*x2,a*y0+b*y1+c*y2];}
function flattenArc(x0,y0,rx,ry,rotDeg,largeArc,sweep,x1,y1,tolerance){
  if (rx===0||ry===0) return [[x1,y1]];
  const phi=(rotDeg*Math.PI)/180, cosPhi=Math.cos(phi), sinPhi=Math.sin(phi);
  const dx=(x0-x1)/2, dy=(y0-y1)/2;
  const x1p=cosPhi*dx+sinPhi*dy, y1p=-sinPhi*dx+cosPhi*dy;
  rx=Math.abs(rx); ry=Math.abs(ry);
  const lambda=(x1p*x1p)/(rx*rx)+(y1p*y1p)/(ry*ry);
  if (lambda>1){const s=Math.sqrt(lambda);rx*=s;ry*=s;}
  const sign=(largeArc!==sweep)?1:-1;
  const num=rx*rx*ry*ry-rx*rx*y1p*y1p-ry*ry*x1p*x1p;
  const den=rx*rx*y1p*y1p+ry*ry*x1p*x1p;
  const co=sign*Math.sqrt(Math.max(0,num/den));
  const cxp=co*(rx*y1p)/ry, cyp=-co*(ry*x1p)/rx;
  const cx=cosPhi*cxp-sinPhi*cyp+(x0+x1)/2, cy=sinPhi*cxp+cosPhi*cyp+(y0+y1)/2;
  const angle=(ux,uy,vx,vy)=>{const sgn=(ux*vy-uy*vx<0)?-1:1;const dot=Math.max(-1,Math.min(1,(ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy))));return sgn*Math.acos(dot);};
  const theta1=angle(1,0,(x1p-cxp)/rx,(y1p-cyp)/ry);
  let dTheta=angle((x1p-cxp)/rx,(y1p-cyp)/ry,(-x1p-cxp)/rx,(-y1p-cyp)/ry);
  if(!sweep&&dTheta>0)dTheta-=2*Math.PI;
  if(sweep&&dTheta<0)dTheta+=2*Math.PI;
  const n=Math.max(2,Math.ceil((Math.abs(dTheta)*Math.max(rx,ry))/tolerance));
  const pts=[];
  for(let k=1;k<=n;k++){const tt=theta1+(dTheta*k)/n;
    pts.push([cosPhi*rx*Math.cos(tt)-sinPhi*ry*Math.sin(tt)+cx, sinPhi*rx*Math.cos(tt)+cosPhi*ry*Math.sin(tt)+cy]);}
  return pts;
}

function flattenPath(d, tolerance) {
  tolerance = tolerance || 0.5;
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g) || [];
  let i = 0;
  const next = () => parseFloat(tokens[i++]);
  const subpaths = [];
  let cur = [];
  let x = 0, y = 0, sx = 0, sy = 0, lastCtrl = null, lastCmd = '';

  function moveTo(px, py) { if (cur.length) subpaths.push(cur); cur = [[px, py]]; x = sx = px; y = sy = py; }
  function lineTo(px, py) { cur.push([px, py]); x = px; y = py; }
  function cubicTo(x1, y1, x2, y2, ex, ey) {
    const n = Math.max(2, Math.ceil(bezierLength(x, y, x1, y1, x2, y2, ex, ey) / tolerance));
    for (let k = 1; k <= n; k++) cur.push(cubicPoint(x, y, x1, y1, x2, y2, ex, ey, k / n));
    x = ex; y = ey; lastCtrl = [2 * ex - x2, 2 * ey - y2];
  }
  function quadTo(x1, y1, ex, ey) {
    const n = Math.max(2, Math.ceil(quadLength(x, y, x1, y1, ex, ey) / tolerance));
    for (let k = 1; k <= n; k++) cur.push(quadPoint(x, y, x1, y1, x2, y2, k / n));
    x = ex; y = ey; lastCtrl = [2 * ex - x1, 2 * ey - y1];
  }
  function arcTo(rx, ry, rot, large, sweep, ex, ey) {
    for (const p of flattenArc(x, y, rx, ry, rot, large, sweep, ex, ey, tolerance)) cur.push(p);
    x = ex; y = ey;
  }

  while (i < tokens.length) {
    let tk = tokens[i];
    if (/^[A-Za-z]$/.test(tk)) { lastCmd = tk; i++; } else { tk = lastCmd; if (tk === 'M' || tk === 'm') tk = (tk === 'M') ? 'L' : 'l'; }
    const rel = tk === tk.toLowerCase();
    const C = tk.toUpperCase();

    if (C === 'M') { const px = next() + (rel ? x : 0), py = next() + (rel ? y : 0); moveTo(px, py); }
    else if (C === 'L') { const px = next() + (rel ? x : 0), py = next() + (rel ? y : 0); lineTo(px, py); }
    else if (C === 'H') { const px = next() + (rel ? x : 0); lineTo(px, y); }
    else if (C === 'V') { const py = next() + (rel ? y : 0); lineTo(x, py); }
    else if (C === 'C') {
      const x1 = next() + (rel ? x : 0), y1 = next() + (rel ? y : 0);
      const x2 = next() + (rel ? x : 0), y2 = next() + (rel ? y : 0);
      const ex = next() + (rel ? x : 0), ey = next() + (rel ? y : 0);
      cubicTo(x1, y1, x2, y2, ex, ey);
    } else if (C === 'S') {
      const c1 = lastCtrl || [x, y];
      const x2 = next() + (rel ? x : 0), y2 = next() + (rel ? y : 0);
      const ex = next() + (rel ? x : 0), ey = next() + (rel ? y : 0);
      cubicTo(c1[0], c1[1], x2, y2, ex, ey);
    } else if (C === 'Q') {
      const x1 = next() + (rel ? x : 0), y1 = next() + (rel ? y : 0);
      const ex = next() + (rel ? x : 0), ey = next() + (rel ? y : 0);
      quadTo(x1, y1, ex, ey);
    } else if (C === 'T') {
      const c1 = lastCtrl || [x, y];
      const ex = next() + (rel ? x : 0), ey = next() + (rel ? y : 0);
      quadTo(c1[0], c1[1], ex, ey);
    } else if (C === 'A') {
      const rx = next(), ry = next(), rot = next(), large = next(), sweep = next();
      const ex = next() + (rel ? x : 0), ey = next() + (rel ? y : 0);
      arcTo(rx, ry, rot, large, sweep, ex, ey);
    } else if (C === 'Z') { lineTo(sx, sy); x = sx; y = sy; }
    else break;
    if (C !== 'S' && C !== 'C' && C !== 'Q' && C !== 'T') lastCtrl = null;
  }
  if (cur.length) subpaths.push(cur);
  return subpaths;
}

const IDENTITY = [1,0,0,1,0,0];
function parseTransform(str) {
  if (!str) return IDENTITY;
  let m = IDENTITY;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str))) {
    const fn = match[1];
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let mm = IDENTITY;
    if (fn === 'matrix') mm = args;
    else if (fn === 'translate') mm = [1,0,0,1, args[0]||0, args[1]||0];
    else if (fn === 'scale') { const sx=args[0], sy=args.length>1?args[1]:args[0]; mm=[sx,0,0,sy,0,0]; }
    else if (fn === 'rotate') {
      const a=(args[0]*Math.PI)/180, cos=Math.cos(a), sin=Math.sin(a);
      if (args.length>=3) { const cx=args[1], cy=args[2];
        m=multiply(m,[1,0,0,1,cx,cy]); mm=[cos,sin,-sin,cos,0,0]; m=multiply(m,mm); m=multiply(m,[1,0,0,1,-cx,-cy]); continue; }
      mm=[cos,sin,-sin,cos,0,0];
    }
    else if (fn === 'skewX') mm=[1,0,Math.tan((args[0]*Math.PI)/180),1,0,0];
    else if (fn === 'skewY') mm=[1,Math.tan((args[0]*Math.PI)/180),0,1,0,0];
    m = multiply(m, mm);
  }
  return m;
}
function multiply(a,b){const[a1,b1,c1,d1,e1,f1]=a,[a2,b2,c2,d2,e2,f2]=b;
  return [a1*a2+c1*b2, b1*a2+d1*b2, a1*c2+c1*d2, b1*c2+d1*d2, a1*e2+c1*f2+e1, b1*e2+d1*f2+f1];}
function applyMatrix(points, m) { const [a,b,c,d,e,f]=m; return points.map(([x,y])=>[a*x+c*y+e, b*x+d*y+f]); }

function isNoneLike(v) { return !v || v === 'none' || v === 'transparent'; }

function parseStyleAttr(styleStr) {
  const result = {};
  if (!styleStr) return result;
  for (const decl of styleStr.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const key = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

function resolveStyleFromAttrs(styleAttr, fillAttr, strokeAttr, strokeWidthAttr, prop, fallback) {
  const style = parseStyleAttr(styleAttr);
  if (prop in style && style[prop] !== '') return style[prop];
  if (prop === 'fill' && fillAttr) return fillAttr;
  if (prop === 'stroke' && strokeAttr) return strokeAttr;
  if (prop === 'stroke-width' && strokeWidthAttr) return strokeWidthAttr;
  return fallback;
}

function declutter(shapes) {
  const n = shapes.length;
  let mask = [];
  const visible = new Array(n);

  for (let i = n - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.hasStroke) {
      const segments = [];
      for (const sub of s.subpaths) {
        if (sub.length < 2) continue;
        for (const seg of lineMinusMask(sub, mask)) {
          if (seg.length >= 2) segments.push(seg);
        }
      }
      visible[i] = segments;
    } else { visible[i] = []; }
    if (s.hasFill) {
      for (const sub of s.subpaths) {
        if (sub.length >= 3) mask = unionInto(mask, sub);
      }
    }
  }
  return visible;
}

function sortPathsTSP(segments) {
  if (segments.length <= 1) return segments;
  const sorted = [segments[0]];
  const remaining = new Set(segments.slice(1));
  let currentEnd = segments[0][segments[0].length - 1];

  while (remaining.size > 0) {
    let closestSeg = null;
    let minDistance = Infinity;
    let reverseClosest = false;

    for (const seg of remaining) {
      const start = seg[0];
      const end = seg[seg.length - 1];

      const dStart = Math.hypot(start[0] - currentEnd[0], start[1] - currentEnd[1]);
      if (dStart < minDistance) {
        minDistance = dStart;
        closestSeg = seg;
        reverseClosest = false;
      }

      const dEnd = Math.hypot(end[0] - currentEnd[0], end[1] - currentEnd[1]);
      if (dEnd < minDistance) {
        minDistance = dEnd;
        closestSeg = seg;
        reverseClosest = true;
      }
    }

    if (closestSeg) {
      remaining.delete(closestSeg);
      const segToAdd = reverseClosest ? [...closestSeg].reverse() : closestSeg;
      sorted.push(segToAdd);
      currentEnd = segToAdd[segToAdd.length - 1];
    } else {
      break;
    }
  }
  return sorted;
}

// ================================================================ //
// SVG Parse / Convert Helpers for CLI                              //
// ================================================================ //
function parseAttrs(attrsStr) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(attrsStr)) !== null) {
    attrs[match[1]] = match[2] || match[3] || '';
  }
  return attrs;
}

function getPathData(tag, attrs) {
  const getAttr = (name) => attrs[name] || '';

  if (tag === 'path') return getAttr('d');

  if (tag === 'rect') {
    const x = parseFloat(getAttr('x') || 0);
    const y = parseFloat(getAttr('y') || 0);
    const w = parseFloat(getAttr('width') || 0);
    const h = parseFloat(getAttr('height') || 0);
    let rx = parseFloat(getAttr('rx') || 0);
    let ry = parseFloat(getAttr('ry') || 0);
    const hasRx = 'rx' in attrs;
    const hasRy = 'ry' in attrs;
    if (hasRx && !hasRy) ry = rx;
    if (hasRy && !hasRx) rx = ry;
    rx = Math.min(rx, w / 2);
    ry = Math.min(ry, h / 2);

    if (rx === 0 && ry === 0) {
      return `M ${x} ${y} h ${w} v ${h} h ${-w} z`;
    } else {
      return `M ${x + rx} ${y} ` +
             `h ${w - 2 * rx} ` +
             `a ${rx} ${ry} 0 0 1 ${rx} ${ry} ` +
             `v ${h - 2 * ry} ` +
             `a ${rx} ${ry} 0 0 1 ${-rx} ${ry} ` +
             `h ${-(w - 2 * rx)} ` +
             `a ${rx} ${ry} 0 0 1 ${-rx} ${-ry} ` +
             `v ${-(h - 2 * ry)} ` +
             `a ${rx} ${ry} 0 0 1 ${rx} ${-ry} ` +
             `z`;
    }
  }

  if (tag === 'circle') {
    const cx = parseFloat(getAttr('cx') || 0);
    const cy = parseFloat(getAttr('cy') || 0);
    const r = parseFloat(getAttr('r') || 0);
    if (r <= 0) return '';
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 -${2*r} 0 Z`;
  }

  if (tag === 'ellipse') {
    const cx = parseFloat(getAttr('cx') || 0);
    const cy = parseFloat(getAttr('cy') || 0);
    const rx = parseFloat(getAttr('rx') || 0);
    const ry = parseFloat(getAttr('ry') || 0);
    if (rx <= 0 || ry <= 0) return '';
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2*rx} 0 a ${rx} ${ry} 0 1 0 -${2*rx} 0 Z`;
  }

  if (tag === 'line') {
    const x1 = parseFloat(getAttr('x1') || 0);
    const y1 = parseFloat(getAttr('y1') || 0);
    const x2 = parseFloat(getAttr('x2') || 0);
    const y2 = parseFloat(getAttr('y2') || 0);
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  if (tag === 'polyline' || tag === 'polygon') {
    const pointsStr = getAttr('points') || '';
    const nums = pointsStr.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length < 4) return '';
    let dStr = `M ${nums[0]} ${nums[1]}`;
    for (let k = 2; k < nums.length; k += 2) {
      if (k + 1 < nums.length) dStr += ` L ${nums[k]} ${nums[k+1]}`;
    }
    if (tag === 'polygon') dStr += ' Z';
    return dStr;
  }

  return '';
}

function extractShapesFromSVG(svgText) {
  const shapes = [];
  const shapeRegex = /<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)\/?>/g;
  let match;
  
  while ((match = shapeRegex.exec(svgText)) !== null) {
    const tag = match[1];
    const attrs = parseAttrs(match[2]);
    
    const d = getPathData(tag, attrs);
    if (!d) continue;

    const style = attrs.style || '';
    const fillAttr = attrs.fill || '';
    const strokeAttr = attrs.stroke || '';
    const strokeWidthAttr = attrs['stroke-width'] || '';
    const transformAttr = attrs.transform || '';

    const fill = resolveStyleFromAttrs(style, fillAttr, strokeAttr, strokeWidthAttr, 'fill', '#000000');
    const stroke = resolveStyleFromAttrs(style, fillAttr, strokeAttr, strokeWidthAttr, 'stroke', 'none');
    const strokeWidth = resolveStyleFromAttrs(style, fillAttr, strokeAttr, strokeWidthAttr, 'stroke-width', '1');

    const matrix = parseTransform(transformAttr);
    const subpaths = flattenPath(d, 0.5).map(pts => applyMatrix(pts, matrix));

    shapes.push({
      subpaths,
      hasFill: !isNoneLike(fill),
      hasStroke: !isNoneLike(stroke),
      stroke: isNoneLike(stroke) ? '#000000' : stroke,
      strokeWidth
    });
  }
  return shapes;
}

function parseSVGDimensions(svgText) {
  const svgMatch = svgText.match(/<svg\b([^>]*)>/);
  let vbW = null, vbH = null, pxW = null, pxH = null;
  if (svgMatch) {
    const attrsStr = svgMatch[1];
    const attrs = parseAttrs(attrsStr);
    const viewBox = attrs.viewBox || '';
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      vbW = parts[2] || null;
      vbH = parts[3] || null;
    }
    const widthVal = attrs.width || '';
    const heightVal = attrs.height || '';
    if (/^\s*[\d.]+\s*$/.test(widthVal)) pxW = parseFloat(widthVal);
    if (/^\s*[\d.]+\s*$/.test(heightVal)) pxH = parseFloat(heightVal);
  }
  return {
    width: vbW || pxW || 1000,
    height: vbH || pxH || 1000
  };
}

function buildCleanSVG(width, height, shapesRaw, visible, sortEnabled) {
  const groups = {};
  for (let i = 0; i < shapesRaw.length; i++) {
    const s = shapesRaw[i];
    if (!s.hasStroke) continue;
    const color = s.stroke.toLowerCase();
    
    let segments = visible[i];
    if (!groups[color]) groups[color] = [];
    for (const seg of segments) {
      if (seg.length >= 2) groups[color].push(seg);
    }
  }

  let body = '';
  for (const color in groups) {
    let segments = groups[color];
    if (sortEnabled) {
      segments = sortPathsTSP(segments);
    }
    const pathsHtml = segments.map(seg => {
      const d = 'M' + seg.map(([x,y]) => x.toFixed(3)+' '+y.toFixed(3)).join(' L');
      const matchedShape = shapesRaw.find(s => s.stroke.toLowerCase() === color);
      const sw = matchedShape ? matchedShape.strokeWidth : '1';
      return `<path fill="none" stroke="${color}" stroke-width="${sw}" d="${d}"/>`;
    }).join('\n');

    body += `<g id="layer-${color.replace('#', '')}" stroke="${color}">\n${pathsHtml}\n</g>\n`;
  }
  return `<?xml version="1.0" encoding="utf-8" ?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

// ================================================================ //
// Processing pipeline                                              //
// ================================================================ //
function processFile(inputFilePath, outputFilePath, sortEnabled) {
  try {
    const svgText = fs.readFileSync(inputFilePath, 'utf8');
    const { width, height } = parseSVGDimensions(svgText);
    const shapesRaw = extractShapesFromSVG(svgText);
    
    if (shapesRaw.length === 0) {
      console.warn(`[Warning] No path or shape elements found in: ${inputFilePath}`);
      return false;
    }
    
    const visible = declutter(shapesRaw);
    const outputSVG = buildCleanSVG(width, height, shapesRaw, visible, sortEnabled);
    
    fs.writeFileSync(outputFilePath, outputSVG);
    let totalSegments = 0;
    visible.forEach(v => totalSegments += v.length);
    console.log(`[Success] Processed: ${path.basename(inputFilePath)} -> ${path.basename(outputFilePath)} (${totalSegments} visible lines)`);
    return true;
  } catch (err) {
    console.error(`[Error] Failed to process ${inputFilePath}:`, err.message);
    return false;
  }
}

// ================================================================ //
// CLI entry point                                                  //
// ================================================================ //
function printHelp() {
  console.log(`
Plotter Declutter CLI - Headless SVG Occlusion Cleaner

Usage:
  node declutter-cli.js <input_path> [output_path] [options]

Arguments:
  <input_path>   Path to a single SVG file or a directory containing SVGs.
  [output_path]  Path to save the output SVG. (If input is a folder, this argument is ignored).
                 If omitted, output is saved as "<input_name>_cleaned.svg".

Options:
  --no-sort      Disable TSP path order optimization (Nearest Neighbor).
  --help, -h     Show this help screen.

Examples:
  node declutter-cli.js drawing.svg
  node declutter-cli.js input.svg output_clean.svg --no-sort
  node declutter-cli.js ./svg_folder/
`);
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp();
  process.exit(0);
}

const sortEnabled = !args.includes('--no-sort');
const positionals = args.filter(a => !a.startsWith('--'));

const inputPath = positionals[0];
if (!inputPath) {
  console.error("Error: Input path is required.");
  printHelp();
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Error: File or directory not found: ${inputPath}`);
  process.exit(1);
}

const stats = fs.statSync(inputPath);

if (stats.isDirectory()) {
  console.log(`Processing folder: ${inputPath} (TSP sorting = ${sortEnabled})`);
  const files = fs.readdirSync(inputPath).filter(f => f.toLowerCase().endsWith('.svg') && !f.endsWith('_cleaned.svg'));
  
  if (files.length === 0) {
    console.log("No SVG files found to process.");
    process.exit(0);
  }
  
  let successCount = 0;
  files.forEach(file => {
    const fullInput = path.join(inputPath, file);
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    const fullOutput = path.join(inputPath, `${base}_cleaned${ext}`);
    if (processFile(fullInput, fullOutput, sortEnabled)) {
      successCount++;
    }
  });
  console.log(`\nBatch completed: Successfully processed ${successCount}/${files.length} SVGs.`);
} else {
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  
  const defaultOutput = path.join(dir, `${base}_cleaned${ext}`);
  const outputPath = positionals[1] || defaultOutput;
  
  console.log(`Processing file: ${inputPath} -> ${outputPath} (TSP sorting = ${sortEnabled})`);
  const success = processFile(inputPath, outputPath, sortEnabled);
  process.exit(success ? 0 : 1);
}
