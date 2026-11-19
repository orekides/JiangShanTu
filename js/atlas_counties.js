/**
 * Optional, locally imported CHGIS county-level seats.
 */
(function () {
  'use strict';

  class AtlasCountiesMixin {
    async _toggleCountyLayer(checkbox) {
      if (!checkbox.checked) {
        this._renderCountyPoints();
        return;
      }
      try {
        await this._loadCountyPoints();
        this._renderCountyPoints();
      } catch (error) {
        checkbox.checked = false;
        this._renderCountyPoints();
        console.error('Unable to load local CHGIS county data:', error);
        window.alert(this.locale === 'en'
          ? 'Could not load local county data. Import the CHGIS dataset as described in the README.'
          : this._zh('无法加载本地县级数据。请按 README 说明导入 CHGIS 数据。'));
      }
    }

    _startCountySearch(onReady) {
      const refresh = () => {
        const input = this._id('inp-map-search');
        const list = this._id('map-search-results');
        if (input && input.value.trim() && list && !list.classList.contains('is-hidden')) onReady();
      };
      this._loadCountyPoints()
        .then(refresh, (error) => {
          this._countySearchError = error;
          console.warn('Local county search unavailable:', error);
          refresh();
          const list = this._id('map-search-results');
          if (list && !list.classList.contains('is-hidden')) {
            const notice = document.createElement('li');
            notice.className = 'sr-section-head';
            notice.setAttribute('role', 'presentation');
            notice.textContent = this._countySearchHint();
            list.appendChild(notice);
          }
        });
    }

    _countySearchHint() {
      return this.locale === 'en'
        ? ' · Local county data unavailable; see README'
        : this._zh(' · 本地县级数据不可用，请参阅 README');
    }

    _loadCountyPoints() {
      if (this._countyPoints) return Promise.resolve(this._countyPoints);
      if (!this._countyPointsPromise) {
        this._countyPointsPromise = fetch('data/local/county-points.json', { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((points) => {
            if (!Array.isArray(points) || !points.length || !points.every((p) =>
              Array.isArray(p) && p.length === 7 &&
              typeof p[0] === 'string' && typeof p[1] === 'string' && typeof p[2] === 'string' &&
              p.slice(3).every(Number.isFinite) && p[5] <= p[6]
            )) throw new Error('Invalid county point data');
            this._countyPoints = points;
            this.searchIndex = null;
            this._countySearchError = null;
            return points;
          })
          .catch((error) => {
            this._countyPointsPromise = null;
            throw error;
          });
      }
      return this._countyPointsPromise;
    }

    _getCountySearchEntries() {
      const yearZh = (year) => year < 0 ? `前${-year}` : String(year);
      const yearEn = (year) => year < 0 ? `${-year} BCE` : `${year} CE`;
      return this._countyPoints
        .filter((point) => point[6] >= this.minYear && point[5] <= this.maxYear)
        .map((point) => ({
          kind: 'county',
          dynasty: null,
          year: null,
          countyPoint: point,
          coord: [point[3], point[4]],
          titleZh: point[0],
          titleEn: point[2] || point[0],
          subZh: `${yearZh(point[5])}—${yearZh(point[6])}`,
          subEn: `${yearEn(point[5])} – ${yearEn(point[6])}`,
          keywords: `${point[0]} ${point[1]} ${point[2]}`.toLowerCase(),
        }));
    }

    _selectCountySearchResult(item) {
      const point = item.countyPoint;
      const firstYear = Math.max(this.minYear, point[5]);
      const lastYear = Math.min(this.maxYear, point[6]);
      let targetYear = Math.max(firstYear, Math.min(lastYear, this.year));
      if (targetYear === 0) targetYear = lastYear >= 1 ? 1 : -1;
      this._selectedCountyPoint = point;
      this._id('chk-counties').checked = true;
      if (targetYear !== this.year) this.jumpToYear(targetYear);
      const [x, y] = this.projector.toScreen(point[3], point[4]);
      const w = Math.min(this.camera.w, 1000 / 4);
      const h = w * this._getViewportAspect();
      this._animateCameraTo({ x: x - w * 0.5, y: y - h * 0.48, w, h });
      this._renderCountyPoints();
    }

    _renderCountyPoints() {
      if (!this.grpCounties) return;
      const checkbox = this._id('chk-counties');
      if (!checkbox || !checkbox.checked || !this._countyPoints || 1000 / this.camera.w < 3) {
        this.grpCounties.innerHTML = '';
        return;
      }
      const rect = this.svg.getBoundingClientRect();
      const matrix = this.grpCounties.getScreenCTM();
      if (!matrix) {
        this.grpCounties.innerHTML = '';
        return;
      }
      const boxes = [];
      this.svg.querySelectorAll(
        '.region-caption, .polity-caption, .settlement-node .name, .province-caption, .hydro-label, .neighbor-caption, .corridor-caption'
      ).forEach((node) => {
        if (node.closest('.is-hidden')) return;
        const bounds = node.getBoundingClientRect();
        if (bounds.width && bounds.height) boxes.push(bounds);
      });
      this.grpCounties.innerHTML = '';
      const unit = this.camera.w / Math.max(rect.width, 1);
      const labelScale = Math.min(2.2, Math.sqrt((1000 / this.camera.w) / 3));
      const size = unit * labelScale;
      const screenSize = size * Math.hypot(matrix.a, matrix.b);
      const slots = [
        { x: 4, y: 3, anchor: 'start' },
        { x: -4, y: 3, anchor: 'end' },
        { x: 0, y: 17, anchor: 'middle' },
        { x: 0, y: -10, anchor: 'middle' },
      ];
      const selectedSlots = slots.concat([
        { x: 4, y: 33, anchor: 'start' },
        { x: 4, y: -27, anchor: 'start' },
        { x: -4, y: 33, anchor: 'end' },
        { x: -4, y: -27, anchor: 'end' },
        { x: 4, y: 55, anchor: 'start' },
        { x: 4, y: -49, anchor: 'start' },
        { x: -4, y: 55, anchor: 'end' },
        { x: -4, y: -49, anchor: 'end' },
      ]);
      const selected = this._selectedCountyPoint;
      const points = selected ? [selected, ...this._countyPoints] : this._countyPoints;
      for (const [index, point] of points.entries()) {
        if (index > 0 && point === selected) continue;
        if (this.year < point[5] || this.year > point[6]) continue;
        const [x, y] = this.projector.toScreen(point[3], point[4]);
        if (x < this.camera.x || x > this.camera.x + this.camera.w ||
            y < this.camera.y || y > this.camera.y + this.camera.h) continue;
        const text = this.locale === 'en' ? point[2] : this.locale === 'zh-tw' ? point[1] || point[0] : point[0];
        const width = (this._estimateLocalTextWidth(text, 12) + 4) * screenSize;
        const screenX = matrix.a * x + matrix.c * y + matrix.e;
        const screenY = matrix.b * x + matrix.d * y + matrix.f;
        let placedBox;
        const slot = (point === selected ? selectedSlots : slots).find((candidate) => {
          const anchorX = screenX + candidate.x * screenSize;
          const left = anchorX - (candidate.anchor === 'end' ? width : candidate.anchor === 'middle' ? width / 2 : 0);
          const top = screenY + (candidate.y - 15) * screenSize;
          const box = { left, right: left + width, top, bottom: screenY + (candidate.y + 6) * screenSize };
          if (boxes.some((other) =>
            box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top
          )) return false;
          placedBox = box;
          return true;
        });
        if (!slot && point !== selected) continue;
        const group = this._svgNode('g', {
          class: point === selected ? 'county-point is-selected' : 'county-point',
          transform: `translate(${x} ${y}) scale(${size})`,
        }, this.grpCounties);
        this._svgNode('circle', { r: point === selected ? 3 : 2 }, group);
        if (slot) {
          boxes.push(placedBox);
          const label = this._svgNode('text', { x: slot.x, y: slot.y, 'text-anchor': slot.anchor }, group);
          label.textContent = text;
        }
      }
    }
  }

  function install(Ctrl) {
    Ctrl._extendPrototype(AtlasCountiesMixin);
  }

  if (typeof window === 'undefined') return;
  const readyCtrl = window.HistoricalAtlasController;
  if (readyCtrl && typeof readyCtrl._extendPrototype === 'function') install(readyCtrl);
  else (window.__ATLAS_MIXINS = window.__ATLAS_MIXINS || []).push(install);
})();
