/**
 * Pure JavaScript Vector Map Rendering & Interaction Engine
 * Zero dependencies, pure SVG & Vanilla DOM (English Only)
 * Touch and Mouse dragging supported across both map background and region paths
 */
class MapRenderer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = options;
    this.isInteractive = options.interactive !== false; // if false, preview mode
    this.namesData = options.namesData || [];
    this.svg = null;
    this.currentData = null;
    this.selectedId = null;
    this.counts = {};
    this.onSelect = options.onSelect || function () {};
    this.viewBox = { x: 0, y: 0, w: 1000, h: 520 };
    this.baseViewBox = { ...this.viewBox };
    this.init();
  }

  init() {
    if (!this.container) return;
    this.container.innerHTML = `
      <svg class="world-map-svg" viewBox="0 0 1000 520" preserveAspectRatio="xMidYMid meet">
        <g class="map-layer"></g>
      </svg>
      <div class="map-tooltip"></div>
    `;
    this.svg = this.container.querySelector('svg');
    this.layer = this.container.querySelector('.map-layer');
    this.tooltip = this.container.querySelector('.map-tooltip');
    this.setupPanningAndGestures();
  }

  setupPanningAndGestures() {
    let isDragging = false;
    let hasMoved = false;
    let startPoint = { x: 0, y: 0 };
    let startViewBox = { ...this.viewBox };
    let downTarget = null;
    const DRAG_THRESHOLD = 5; // Pixels threshold to distinguish click from pan

    const onPointerDown = (clientX, clientY, target) => {
      isDragging = true;
      hasMoved = false;
      downTarget = target;
      startPoint = { x: clientX, y: clientY };
      startViewBox = { ...this.viewBox };
    };

    const onPointerMove = (clientX, clientY) => {
      if (!isDragging) return;
      const dxScreen = clientX - startPoint.x;
      const dyScreen = clientY - startPoint.y;
      
      if (Math.abs(dxScreen) > DRAG_THRESHOLD || Math.abs(dyScreen) > DRAG_THRESHOLD) {
        hasMoved = true;
        this.svg.style.cursor = 'grabbing';
      }

      if (hasMoved) {
        const dx = dxScreen * (this.viewBox.w / this.svg.clientWidth);
        const dy = dyScreen * (this.viewBox.h / this.svg.clientHeight);
        this.viewBox.x = startViewBox.x - dx;
        this.viewBox.y = startViewBox.y - dy;
        this.updateViewBox();
      }
    };

    const onPointerUp = (clientX, clientY) => {
      if (isDragging) {
        if (!hasMoved && this.isInteractive && downTarget) {
          // It was a click/tap without drag on a region
          const region = downTarget.closest('.map-region');
          if (region) {
            const id = region.dataset.id;
            const feature = this.findFeatureById(id);
            this.selectRegion(id, feature);
          }
        }
        isDragging = false;
        hasMoved = false;
        downTarget = null;
        this.svg.style.cursor = 'default';
      }
    };

    // Mouse Events
    this.svg.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onPointerDown(e.clientX, e.clientY, e.target);
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      onPointerMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', (e) => {
      if (isDragging) {
        onPointerUp(e.clientX, e.clientY);
      }
    });

    // Touch Events (Mobile & Tablet)
    this.svg.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        onPointerDown(touch.clientX, touch.clientY, e.target);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const touch = e.touches[0];
      onPointerMove(touch.clientX, touch.clientY);
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (isDragging) {
        const touch = e.changedTouches[0];
        onPointerUp(touch ? touch.clientX : 0, touch ? touch.clientY : 0);
      }
    });

    // Wheel zoom
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      this.zoom(zoomFactor, e.clientX, e.clientY);
    }, { passive: false });
  }

  zoom(factor, clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const mouseX = clientX !== undefined ? (clientX - rect.left) / rect.width : 0.5;
    const mouseY = clientY !== undefined ? (clientY - rect.top) / rect.height : 0.5;

    const newW = Math.max(80, Math.min(3000, this.viewBox.w * factor));
    const newH = Math.max(50, Math.min(2000, this.viewBox.h * factor));

    this.viewBox.x += (this.viewBox.w - newW) * mouseX;
    this.viewBox.y += (this.viewBox.h - newH) * mouseY;
    this.viewBox.w = newW;
    this.viewBox.h = newH;
    this.updateViewBox();
  }

  zoomIn() { this.zoom(0.8); }
  zoomOut() { this.zoom(1.25); }
  resetZoom() {
    this.viewBox = { ...this.baseViewBox };
    this.updateViewBox();
  }

  updateViewBox() {
    this.svg.setAttribute('viewBox', `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  render(mapData, counts = {}, selectedId = null) {
    if (!mapData || !this.layer) return;
    this.currentData = mapData;
    this.counts = counts;
    this.selectedId = selectedId;

    if (mapData.viewBox) {
      const parts = mapData.viewBox.split(' ').map(Number);
      this.baseViewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
      this.viewBox = { ...this.baseViewBox };
      this.updateViewBox();
    }

    this.layer.innerHTML = '';

    // Compute rank-based ratios for voted regions
    const votedEntries = Object.entries(counts).filter(([, c]) => c > 0);
    const rankRatios = {};
    if (votedEntries.length > 0) {
      votedEntries.sort((a, b) => a[1] - b[1]);
      const n = votedEntries.length;
      let i = 0;
      while (i < n) {
        let j = i;
        while (j < n && votedEntries[j][1] === votedEntries[i][1]) j++;
        // Average position for tied entries, normalised to 0-1
        const avgPos = (i + j - 1) / 2;
        const ratio = n === 1 ? 1 : avgPos / (n - 1);
        for (let k = i; k < j; k++) {
          rankRatios[votedEntries[k][0]] = ratio;
        }
        i = j;
      }
    }

    const features = mapData.features || mapData.provinces || [];

    features.forEach((feature) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', feature.d);
      path.setAttribute('id', `region-${feature.id}`);
      path.classList.add('map-region');
      path.dataset.id = feature.id;
      path.dataset.name = feature.name;

      const count = counts[feature.id] || 0;
      if (count > 0) {
        path.style.fill = this.getHeatmapColor(rankRatios[feature.id]);
      }

      if (this.selectedId === feature.id) {
        path.classList.add('selected');
      }

      if (this.isInteractive) {
        path.addEventListener('mouseenter', (e) => {
          const currentCount = this.counts[feature.id] || 0;
          const featureFlag = feature.flag || (this.namesData.find(n => n.id === feature.id || n.iso === feature.id) || {}).flag || '';
          const flagPrefix = featureFlag ? featureFlag + ' ' : '';
          this.tooltip.innerHTML = `<strong>${flagPrefix}${feature.name}</strong><br><span>${currentCount} vote${currentCount !== 1 ? 's' : ''}</span>`;
          this.tooltip.style.display = 'block';
          this.positionTooltip(e);
        });

        path.addEventListener('mousemove', (e) => {
          this.positionTooltip(e);
        });

        path.addEventListener('mouseleave', () => {
          this.tooltip.style.display = 'none';
        });
      }

      this.layer.appendChild(path);
    });
  }

  positionTooltip(e) {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y - 12}px`;
  }

  selectRegion(id, feature) {
    if (!this.isInteractive) return;
    this.selectedId = id;
    const prev = this.layer.querySelectorAll('.map-region.selected');
    prev.forEach(p => p.classList.remove('selected'));

    if (id) {
      const current = this.layer.querySelector(`#region-${id}`);
      if (current) current.classList.add('selected');
    }

    this.onSelect(id, feature || this.findFeatureById(id));
  }

  deselect() {
    this.selectedId = null;
    if (this.layer) {
      const prev = this.layer.querySelectorAll('.map-region.selected');
      prev.forEach(p => p.classList.remove('selected'));
    }
  }

  findFeatureById(id) {
    if (!this.currentData || !id) return null;
    const list = this.currentData.features || this.currentData.provinces || [];
    return list.find(f => f.id === id);
  }

  getHeatmapColor(ratio) {
    // Lazily parse accent-pink from CSS custom property
    if (!this._hue) {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-pink').trim();
      // Resolve light-dark() by picking the first hex value
      const hex = raw.match(/#[0-9a-fA-F]{3,8}/)?.[0] || '#ff5277';
      this._hue = this._hexToHsl(hex);
    }

    // Lightness: 85% at low → 30% at high
    const l = 85 - ratio * 55;
    // Saturation: 60% at low → 90% at high for vibrancy
    const s = 60 + ratio * 30;

    return `hsl(${this._hue}, ${s}%, ${l}%)`;
  }

  _hexToHsl(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return 0;
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return Math.round(h * 360);
  }
}

window.MapRenderer = MapRenderer;
