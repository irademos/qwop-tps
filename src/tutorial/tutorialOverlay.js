/**
 * Sword Showdown tutorial UI: the instruction panel, screen-space guides (swipe arrows
 * and block bars drawn over the 3D scene) and the pulsing ring around a HUD button.
 * Pure DOM — the tutorial script (showdownTutorial.js) decides what to show.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const GUIDE_HEIGHT = 44;

function createEl(tag, className, parent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent?.appendChild(el);
  return el;
}

/**
 * One guide: an arrow (single/double-headed) or a thick bar, `length` px long, centred on
 * (x, y) and rotated to `angle` (radians, screen space: 0 = right, +π/2 = down).
 */
function buildGuideSvg({ type, length, color, dashed }) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(length));
  svg.setAttribute('height', String(GUIDE_HEIGHT));
  svg.setAttribute('viewBox', `0 0 ${length} ${GUIDE_HEIGHT}`);
  const mid = GUIDE_HEIGHT / 2;
  if (type === 'bar') {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '4');
    rect.setAttribute('y', String(mid - 9));
    rect.setAttribute('width', String(length - 8));
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', '9');
    rect.setAttribute('fill', color);
    rect.setAttribute('stroke', '#0f172a');
    rect.setAttribute('stroke-width', '3');
    svg.appendChild(rect);
    return svg;
  }
  const head = 22;
  const double = type === 'double-arrow';
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(double ? head : 4));
  line.setAttribute('x2', String(length - head));
  line.setAttribute('y1', String(mid));
  line.setAttribute('y2', String(mid));
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '8');
  line.setAttribute('stroke-linecap', 'round');
  if (dashed) line.setAttribute('stroke-dasharray', '14 10');
  svg.appendChild(line);
  const addHead = (tipX, dir) => {
    const poly = document.createElementNS(SVG_NS, 'polygon');
    const baseX = tipX - dir * head;
    poly.setAttribute('points', `${tipX},${mid} ${baseX},${mid - 15} ${baseX},${mid + 15}`);
    poly.setAttribute('fill', color);
    svg.appendChild(poly);
  };
  addHead(length - 2, 1);
  if (double) addHead(2, -1);
  return svg;
}

export function createTutorialOverlay() {
  const root = createEl('div', 'tutorial-root hidden', document.body);
  root.id = 'tutorial-root';

  const guideLayer = createEl('div', 'tutorial-guides', root);

  const panel = createEl('div', 'tutorial-panel', root);
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  const progress = createEl('div', 'tutorial-progress', panel);
  const title = createEl('div', 'tutorial-title', panel);
  const text = createEl('div', 'tutorial-text', panel);
  const hint = createEl('div', 'tutorial-hint', panel);
  const actions = createEl('div', 'tutorial-actions', panel);
  const skipButton = createEl('button', 'tutorial-skip', actions);
  skipButton.type = 'button';
  skipButton.textContent = 'Skip step ▸';

  let onSkip = null;
  skipButton.addEventListener('click', () => onSkip?.());

  const guideEls = new Map(); // key -> { el, sig }
  let highlighted = [];

  return {
    show() {
      root.classList.remove('hidden');
    },
    hide() {
      root.classList.add('hidden');
      this.clearGuides();
      this.highlight([]);
    },
    /** Panel content. `hint` is the smaller feedback line (e.g. "Blocked! Try again"). */
    setStep({ progressText = '', titleText = '', bodyText = '', hintText = '' } = {}) {
      progress.textContent = progressText;
      title.textContent = titleText;
      text.textContent = bodyText;
      this.setHint(hintText);
    },
    setHint(hintText = '', tone = '') {
      hint.textContent = hintText;
      hint.dataset.tone = tone;
      hint.classList.toggle('hidden', !hintText);
    },
    setSkipHandler(handler) {
      onSkip = handler;
      skipButton.classList.toggle('hidden', !handler);
    },
    /**
     * Draw these guides this frame; guides not listed are removed.
     * @param {{key: string, type: 'arrow'|'double-arrow'|'bar', x: number, y: number,
     *          angle: number, length?: number, color?: string, dashed?: boolean,
     *          label?: string}[]} guides
     */
    setGuides(guides = []) {
      const seen = new Set();
      for (const g of guides) {
        if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
        seen.add(g.key);
        const length = Math.round(g.length ?? 220);
        const color = g.color ?? '#facc15';
        const sig = `${g.type}|${length}|${color}|${!!g.dashed}|${g.label ?? ''}`;
        let entry = guideEls.get(g.key);
        if (!entry || entry.sig !== sig) {
          entry?.el.remove();
          const el = createEl('div', 'tutorial-guide', guideLayer);
          el.appendChild(buildGuideSvg({ type: g.type, length, color, dashed: g.dashed }));
          if (g.label) {
            const label = createEl('div', 'tutorial-guide-label', el);
            label.textContent = g.label;
          }
          entry = { el, sig };
          guideEls.set(g.key, entry);
        }
        entry.el.style.transform =
          `translate(${g.x}px, ${g.y}px) translate(-50%, -50%) rotate(${g.angle}rad)`;
        const label = entry.el.querySelector('.tutorial-guide-label');
        // Keep the label upright
        if (label) label.style.transform = `translate(-50%, 0) rotate(${-g.angle}rad)`;
      }
      for (const [key, entry] of guideEls) {
        if (!seen.has(key)) {
          entry.el.remove();
          guideEls.delete(key);
        }
      }
    },
    clearGuides() {
      this.setGuides([]);
    },
    /** Pulsing ring around each of these elements (others lose theirs). */
    highlight(elements = []) {
      const next = elements.filter(Boolean);
      highlighted.forEach((el) => { if (!next.includes(el)) el.classList.remove('tutorial-highlight'); });
      next.forEach((el) => el.classList.add('tutorial-highlight'));
      highlighted = next;
    },
    destroy() {
      this.hide();
      root.remove();
    }
  };
}
