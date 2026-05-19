import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  'coverage',
  'dist',
  'node_modules',
  'graphify-out'
]);
const TEXT_EXTENSIONS = new Set(['.css', '.htm', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const UI_ROOT_PATTERN = /^(app|components|pages|public|src|styles)\//;
const GESTURE_SURFACE_PATTERN = /\b(carousel|slider|swiper|snap|scroll-x|horizontal|map|mapbox|google-map|leaflet|drag|draggable|swipe|touch)\b/i;
const MAP_SURFACE_PATTERN = /\b(map|mapbox|google-map|leaflet|marker|pin|overlay)\b/i;
const CAROUSEL_SURFACE_PATTERN = /\b(carousel|slider|swiper|slide|snap|scroll-x|horizontal)\b/i;
const TOUCH_TARGET_PATTERN = /\b(card|marker|pin|carousel|slide|item|thumb|button|btn)\b/i;
const TOUCH_ACTION_PATTERN = /touch-action\s*:\s*([^;]+)/i;
const POSITIONED_OVERLAY_PATTERN = /position\s*:\s*(absolute|fixed|sticky)\b/i;
const POINTER_EVENTS_NONE_PATTERN = /pointer-events\s*:\s*none\b/i;
const OVERFLOW_X_PATTERN = /overflow-x\s*:\s*(auto|scroll)\b/i;
const SCROLL_SNAP_PATTERN = /scroll-snap-type\s*:/i;
const MARKER_CODE_PATTERN = /\b(AdvancedMarkerElement|google\.maps\.Marker|MarkerF|MapMarker|<Marker\b|<AdvancedMarker\b|mapbox|leaflet|L\.marker)\b/;
const DRAG_HANDLER_PATTERN = /\b(onPointerDown|onPointerMove|onPointerUp|onTouchStart|onTouchMove|onTouchEnd|onMouseDown|onMouseMove|onMouseUp|onDragStart|draggable)\b/;
const CLICK_NAV_PATTERN = /\b(onClick|router\.push|navigate\s*\(|window\.location|href=)\b/;
const DRAG_STATE_PATTERN = /\b(isDragging|dragging|dragStart|touchStart|pointerStart|swipeStart|isSwiping|hasDragged|dragDistance|touchMoved)\b/g;
const CLICK_SUPPRESSION_PATTERN = /\b(preventClick|ignoreClick|suppressClick|cancelClick|hasDragged|touchMoved)\b|Math\.abs\s*\(|event\.preventDefault\s*\(|e\.preventDefault\s*\(/i;
const DRAG_THRESHOLD_PATTERN = /\b(threshold|delta|dragDistance|swipeDistance|minDrag|movementX|movementY|clientX|clientY|pageX|pageY|Math\.abs)\b/i;
const MARKER_LAYERING_PATTERN = /\b(collisionBehavior|zIndex|z-index|aria-label|selected|active|contrast|outline|box-shadow)\b/i;

export async function scanGestureInteraction(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const result = {
    schema_version: '0.1.0',
    status: 'pass',
    scanned_files: files.length,
    touch_action_hits: [],
    overlay_pointer_hits: [],
    drag_tap_hits: [],
    carousel_hits: [],
    map_marker_hits: [],
    risk_summary: {
      touch_action_hits: { block: 0, review: 0, info: 0 },
      overlay_pointer_hits: { block: 0, review: 0, info: 0 },
      drag_tap_hits: { block: 0, review: 0, info: 0 },
      carousel_hits: { block: 0, review: 0, info: 0 },
      map_marker_hits: { block: 0, review: 0, info: 0 }
    },
    summary: {
      total_hits: 0,
      scanned_files: files.length
    }
  };

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8');
    const ext = path.extname(file.relativePath).toLowerCase();
    if (['.css', '.html', '.htm'].includes(ext)) {
      collectCssGestureHits(result, file.relativePath, content);
    }
    if (['.js', '.jsx', '.mjs', '.ts', '.tsx', '.html', '.htm'].includes(ext)) {
      collectCodeGestureHits(result, file.relativePath, content);
    }
  }

  for (const key of Object.keys(result.risk_summary)) {
    result.risk_summary[key] = summarizeGateEffects(result[key]);
  }
  result.summary.total_hits = [
    result.touch_action_hits,
    result.overlay_pointer_hits,
    result.drag_tap_hits,
    result.carousel_hits,
    result.map_marker_hits
  ].reduce((total, hits) => total + hits.length, 0);
  result.status = result.summary.total_hits > 0 ? 'needs_review' : 'pass';
  return result;
}

function collectCssGestureHits(result, file, content) {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gm;
  let match;
  while ((match = rulePattern.exec(content)) !== null) {
    const selector = cleanup(match[1]);
    const body = match[2];
    const selectorAndBody = `${selector} ${body}`;
    const line = lineNumberAt(content, match.index);
    const excerpt = `${selector} { ${cleanup(body).slice(0, 160)} }`;
    const touchAction = TOUCH_ACTION_PATTERN.exec(body)?.[1]?.trim();

    if (touchAction && GESTURE_SURFACE_PATTERN.test(selectorAndBody) && isAmbiguousTouchAction(touchAction)) {
      result.touch_action_hits.push({
        file,
        line,
        kind: 'ambiguous_touch_action_on_gesture_surface',
        selector,
        touch_action: touchAction,
        excerpt,
        confidence: /pan-x.*pan-y|pan-y.*pan-x/.test(touchAction) ? 'high' : 'medium',
        gate_effect: 'review',
        recommendation: 'carousel、map、drag surfaceでは縦横panやpinch-zoomを同時に許可する前に、スワイプ、地図移動、ページスクロールの優先順位をStory/E2Eで明示する。'
      });
    }

    if (MAP_SURFACE_PATTERN.test(selectorAndBody)
      && POSITIONED_OVERLAY_PATTERN.test(body)
      && !POINTER_EVENTS_NONE_PATTERN.test(body)
      && /z-index\s*:|inset\s*:|top\s*:|bottom\s*:|left\s*:|right\s*:/.test(body)) {
      result.overlay_pointer_hits.push({
        file,
        line,
        kind: 'map_overlay_may_capture_touch',
        selector,
        excerpt,
        confidence: 'medium',
        gate_effect: 'review',
        recommendation: 'map上のoverlayは操作を奪う必要がある領域だけpointer-events:autoにし、装飾や表示だけのlayerはpointer-events:noneにする。'
      });
    }

    if (CAROUSEL_SURFACE_PATTERN.test(selectorAndBody) && OVERFLOW_X_PATTERN.test(body) && !SCROLL_SNAP_PATTERN.test(body)) {
      result.carousel_hits.push({
        file,
        line,
        kind: 'carousel_missing_scroll_snap_contract',
        selector,
        excerpt,
        confidence: 'medium',
        gate_effect: 'review',
        recommendation: 'carouselはscroll-snap、active item更新、drag threshold、または代替の明示制御を持つことを確認する。'
      });
    }

    const size = extractStaticSize(body);
    if (size && TOUCH_TARGET_PATTERN.test(selector) && (size.width < 44 || size.height < 44)) {
      result.carousel_hits.push({
        file,
        line,
        kind: 'small_gesture_hit_area',
        selector,
        width_px: size.width,
        height_px: size.height,
        excerpt,
        confidence: 'medium',
        gate_effect: 'review',
        recommendation: 'mobile touch targetやmap markerの実hit areaは44px程度を基準に、visual sizeだけでなくpaddingや透明hit areaで補強する。'
      });
    }
  }
}

function collectCodeGestureHits(result, file, content) {
  const code = stripComments(content);
  if (DRAG_HANDLER_PATTERN.test(code) && CLICK_NAV_PATTERN.test(code)) {
    const states = [...new Set([...code.matchAll(DRAG_STATE_PATTERN)].map((match) => match[1]))];
    if (states.length > 0 && !CLICK_SUPPRESSION_PATTERN.test(code)) {
      result.drag_tap_hits.push({
        file,
        line: lineNumberAt(content, code.indexOf(states[0])),
        kind: 'drag_state_not_connected_to_click_suppression',
        state_candidates: states.slice(0, 5),
        excerpt: excerptAround(content, states[0]),
        confidence: 'medium',
        gate_effect: 'review',
        recommendation: 'drag/swipe stateを取得している場合は、移動量が閾値を超えたclickやnavigationを抑止し、Playwrightでdrag後にURLが変わらないことを確認する。'
      });
    }
  }

  if (CAROUSEL_SURFACE_PATTERN.test(code)
    && DRAG_HANDLER_PATTERN.test(code)
    && !DRAG_THRESHOLD_PATTERN.test(code)) {
    result.carousel_hits.push({
      file,
      line: firstPatternLine(content, DRAG_HANDLER_PATTERN),
      kind: 'carousel_drag_threshold_not_detected',
      excerpt: excerptAround(content, 'onPointer'),
      confidence: 'medium',
      gate_effect: 'review',
      recommendation: 'carouselのdrag/tap判定は開始座標、移動量、閾値、active card更新、scrollLeft変化を明示する。'
    });
  }

  if (MARKER_CODE_PATTERN.test(code) && !MARKER_LAYERING_PATTERN.test(code)) {
    result.map_marker_hits.push({
      file,
      line: firstPatternLine(content, MARKER_CODE_PATTERN),
      kind: 'map_marker_layering_contract_missing',
      excerpt: excerptAround(content, 'Marker'),
      confidence: 'medium',
      gate_effect: 'review',
      recommendation: 'map markerはcollisionBehavior、zIndex、選択状態、contrast、hit areaの少なくとも一部を明示し、重なり時の操作優先度を確認する。'
    });
  }
}

async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, absolutePath));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!shouldScanFile(relativePath)) continue;
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 1024 * 1024) continue;
    files.push({ absolutePath, relativePath });
  }

  return files;
}

function shouldScanFile(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  if (!UI_ROOT_PATTERN.test(relativePath) && relativePath.includes('/')) return false;
  return !relativePath.endsWith('.test.js')
    && !relativePath.endsWith('.test.jsx')
    && !relativePath.endsWith('.test.ts')
    && !relativePath.endsWith('.test.tsx');
}

function isAmbiguousTouchAction(value) {
  const normalized = value.toLowerCase();
  if (normalized === 'auto' || normalized === 'manipulation') return true;
  if (normalized.includes('pinch-zoom') && (normalized.includes('pan-x') || normalized.includes('pan-y'))) return true;
  return normalized.includes('pan-x') && normalized.includes('pan-y');
}

function extractStaticSize(body) {
  const width = extractPxValue(body, 'width') ?? extractPxValue(body, 'min-width');
  const height = extractPxValue(body, 'height') ?? extractPxValue(body, 'min-height');
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function extractPxValue(body, property) {
  const pattern = new RegExp(`${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i');
  const match = pattern.exec(body);
  if (!match) return null;
  return Number(match[1]);
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function firstPatternLine(content, pattern) {
  const match = pattern.exec(content);
  return lineNumberAt(content, match?.index ?? 0);
}

function excerptAround(content, token) {
  const index = token ? content.indexOf(token) : -1;
  const start = Math.max(0, index < 0 ? 0 : index - 80);
  return cleanup(content.slice(start, start + 180));
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function cleanup(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

function summarizeGateEffects(hits) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits) {
    const effect = ['block', 'review', 'info'].includes(hit.gate_effect) ? hit.gate_effect : 'info';
    summary[effect] += 1;
  }
  return summary;
}

export function renderGestureInteractionReport({ runId, gestureInteraction }) {
  if (!gestureInteraction) {
    return `# ジェスチャー操作診断結果

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 状態 | gesture-interaction は適用されていない |
`;
  }
  const groups = [
    ['touch_action_hits', 'touch-action候補'],
    ['overlay_pointer_hits', 'overlay pointer候補'],
    ['drag_tap_hits', 'drag/tap候補'],
    ['carousel_hits', 'carousel/hit area候補'],
    ['map_marker_hits', 'map marker候補']
  ];
  return `# ジェスチャー操作診断結果

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| Status | ${gestureInteraction.status} |
| 走査ファイル | ${gestureInteraction.scanned_files}件 |
| 検出候補 | ${gestureInteraction.summary?.total_hits ?? 0}件 |
${groups.map(([key, label]) => `| ${label} | ${formatRiskCount(gestureInteraction[key] ?? [], gestureInteraction.risk_summary?.[key])} |`).join('\n')}

${groups.map(([key, label]) => `## ${label}

${renderHits(gestureInteraction[key] ?? [])}`).join('\n\n')}
`;
}

function renderHits(hits) {
  if (hits.length === 0) return '- なし';
  return hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} confidence=${hit.confidence ?? '-'} gate_effect=${hit.gate_effect ?? '-'} ${hit.selector ? `selector=${hit.selector} ` : ''}\`${hit.excerpt ?? ''}\``).join('\n');
}

function formatRiskCount(hits = [], summary = null) {
  const gateSummary = summary ?? summarizeGateEffects(hits);
  return `${hits.length}件 (block=${gateSummary.block ?? 0}, review=${gateSummary.review ?? 0}, info=${gateSummary.info ?? 0})`;
}
