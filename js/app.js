/**
 * Where are you all? - Main WebXDC Application Logic
 * Pure Vanilla JavaScript (English Only)
 */
(function () {
  let skipBlurHide = false;
  let appState = {
    mode: 'CREATOR', // 'CREATOR' for original app, 'USAGE' for ReSent package
    currentScope: 'global', // 'global' | 'continent' | 'country'
    globalMode: 'WORLD_CONTINENTS', // 'WORLD_CONTINENTS' or 'WORLD_COUNTRIES'
    config: null,
    selectedRegion: null,
    myLocation: null,
    namesData: [],
    continentsData: [],
    worldContinentsMap: null,
    worldCountriesMap: null,
    currentMapData: null,
    counts: {},
    creatorMapRenderer: null,
    usageMapRenderer: null,
    packager: new window.XdcPackager()
  };

  async function initApp() {
    setupTheme();
    setupSimulatorBar();
    await loadInitialData();
    await checkAppModeAndConfig();
    setupEventListeners();
    setupWebXdcSync();
  }

  function setupTheme() {
    const saved = localStorage.getItem('app_theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = saved || (systemPrefersDark ? 'dark' : 'light');

    applyTheme(initialTheme);

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || (systemPrefersDark ? 'dark' : 'light');
        const next = cur === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('app_theme', next);
      });
    }

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // If user hasn't explicitly set a preference, follow the system change
        if (!localStorage.getItem('app_theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    }
  }

  function setupSimulatorBar() {
    if (!window.webxdc || !window.webxdc.isSimulation) {
      const bar = document.getElementById('sim-peer-bar');
      if (bar) bar.style.display = 'none';
      const runBtn = document.getElementById('run-region-btn');
      if (runBtn) runBtn.style.display = 'none';
      return;
    }
    const runBtn = document.getElementById('run-region-btn');
    if (runBtn) runBtn.style.display = '';
    renderPeerChips();
    window.addEventListener('webxdc:peerchange', () => {
      renderPeerChips();
      checkSavedUserPick();
      updateStatsUI();
      showToast(`Switched active user to: ${window.webxdc.selfName}`);
    });
  }

  function renderPeerChips() {
    const container = document.getElementById('peer-chips-list');
    if (!container || !window.webxdc.getPeersList) return;
    const peers = window.webxdc.getPeersList();
    container.innerHTML = peers.map((p, idx) => `
      <button class="peer-chip ${p.isCurrent ? 'active' : ''}" data-idx="${idx}">
        ${p.isCurrent ? '👉 ' : ''}${p.name}
      </button>
    `).join('');

    container.querySelectorAll('.peer-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        window.webxdc.setPeer(idx);
      });
    });
  }

  async function loadInitialData() {
    try {
      const [namesRes, contRes, contMapRes, countriesMapRes] = await Promise.all([
        fetch('/data/names.json').then(r => r.json()).catch(() => ({ regions: [] })),
        fetch('/data/continents.json').then(r => r.json()).catch(() => ({ continents: [] })),
        fetch('/data/world-continents.json').then(r => r.json()).catch(() => null),
        fetch('/data/world-countries.json').then(r => r.json()).catch(() => null)
      ]);
      appState.namesData = namesRes.regions || [];
      appState.continentsData = (contRes.continents || []).filter(c => c.id !== 'AN' && c.id !== 'AQ');
      appState.worldContinentsMap = contMapRes;
      appState.worldCountriesMap = countriesMapRes;
    } catch (e) {
      console.error('Failed to load initial datasets', e);
    }
  }

  async function checkAppModeAndConfig() {
    try {
      const confRes = await fetch('/config.json');
      if (confRes.ok) {
        const config = await confRes.json();
        appState.config = config;
        appState.mode = 'USAGE';
      } else {
        appState.mode = 'CREATOR';
      }
    } catch (e) {
      appState.mode = 'CREATOR';
    }

    renderViewsForMode();
  }

  async function renderViewsForMode() {
    const badge = document.getElementById('mode-indicator-badge');
    const headerTitle = document.getElementById('current-scope-heading');
    const creatorView = document.getElementById('creator-view');
    const usageView = document.getElementById('usage-view');

    if (appState.mode === 'CREATOR') {
      badge.textContent = '🛠️ Creator Mode';
      badge.className = 'neo-badge neo-btn-yellow';
      headerTitle.textContent = 'Select scope and region to generate a poll .xdc file';
      if (creatorView) creatorView.style.display = 'grid';
      if (usageView) usageView.style.display = 'none';

      appState.creatorMapRenderer = new window.MapRenderer('creator-map-container', {
        interactive: false, // Non-clickable preview in Creator Mode
        namesData: appState.namesData
      });

      setupScopeSelector();
      setScope('global');

    } else {
      const regionName = appState.config?.region || 'Poll';
      const levelLabel = appState.config?.level === 'country' ? 'State / Province' : 
                         appState.config?.level === 'continent' ? 'Country' : 
                         (appState.config?.subType === 'countries' ? 'Country' : 'Continent');
      badge.textContent = `📍 Poll: ${regionName}`;
      badge.className = 'neo-badge neo-btn-cyan';
      headerTitle.textContent = `Choose your ${levelLabel} in ${regionName}`;
      
      if (creatorView) creatorView.style.display = 'none';
      if (usageView) usageView.style.display = 'grid';

      appState.usageMapRenderer = new window.MapRenderer('usage-map-container', {
        interactive: true, // Clickable in Usage Mode
        namesData: appState.namesData,
        onSelect: (id, feature) => {
          handleUsageRegionSelected(id, feature);
        }
      });

      await loadUsageModeMap();
    }
  }

  async function loadUsageModeMap() {
    const config = appState.config;
    const titleEl = document.getElementById('usage-map-title');
    const subTitleEl = document.getElementById('usage-map-subtitle');

    if (config.level === 'world_continents' || (config.level === 'world' && config.subType !== 'countries')) {
      titleEl.textContent = 'Global Continents Poll';
      subTitleEl.textContent = 'Click your continent on the map to vote';
      
      let mapData = appState.worldContinentsMap;
      if (!mapData) {
        mapData = await fetch('/data/world-continents.json').then(r => r.json());
        appState.worldContinentsMap = mapData;
      }
      appState.currentMapData = mapData;
      appState.usageMapRenderer.render(mapData, appState.counts);

    } else if (config.level === 'world_countries' || (config.level === 'world' && config.subType === 'countries')) {
      titleEl.textContent = 'Global Countries Poll';
      subTitleEl.textContent = 'Click your country on the map to vote';
      
      let mapData = appState.worldCountriesMap;
      if (!mapData) {
        mapData = await fetch('/data/world-countries.json').then(r => r.json());
        appState.worldCountriesMap = mapData;
      }
      appState.currentMapData = mapData;
      appState.usageMapRenderer.render(mapData, appState.counts);

    } else if (config.level === 'continent') {
      titleEl.textContent = `${config.region} - Countries Poll`;
      subTitleEl.textContent = 'Click your country on the map to vote';
      try {
        const contMap = await fetch(`/data/continents/${config.iso}.json`).then(r => r.json());
        appState.currentMapData = contMap;
        appState.usageMapRenderer.render(contMap, appState.counts);
      } catch (e) {
        console.error('Failed to load continent map', e);
      }
    } else if (config.level === 'country') {
      titleEl.textContent = `${config.region} - State/Province Poll`;
      subTitleEl.textContent = 'Click your province or state on the map to vote';
      try {
        const countryMap = await fetch(`/data/admin1/${config.iso}.json`).then(r => r.json());
        appState.currentMapData = countryMap;
        appState.usageMapRenderer.render(countryMap, appState.counts);
      } catch (e) {
        console.error('Failed to load country admin1 map', e);
      }
    }

    checkSavedUserPick();
    updateStatsUI();
  }

  function setupScopeSelector() {
    const globalBtn = document.getElementById('scope-global-btn');
    const continentBtn = document.getElementById('scope-continent-btn');
    const countryBtn = document.getElementById('scope-country-btn');
    const searchInput = document.getElementById('region-search-input');
    const dropdown = document.getElementById('search-dropdown');

    if (!globalBtn || !continentBtn || !countryBtn) return;

    globalBtn.addEventListener('click', () => setScope('global'));
    continentBtn.addEventListener('click', () => setScope('continent'));
    countryBtn.addEventListener('click', () => setScope('country'));

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        handleSearchInput(e.target.value.trim());
      });

      searchInput.addEventListener('focus', () => {
        searchInput.select();
        // When focusing, show all options in current scope with selected item highlighted and scrolled into view
        handleSearchInput('');
      });

      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (!skipBlurHide && dropdown) dropdown.style.display = 'none';
          skipBlurHide = false;
        }, 150);
      });

      searchInput.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.search-result-item');
        if (!items.length) return;

        // Find currently highlighted index
        let idx = -1;
        items.forEach((el, i) => { if (el.classList.contains('highlighted')) idx = i; });

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          idx = Math.min(idx + 1, items.length - 1);
          items.forEach(el => el.classList.remove('highlighted'));
          items[idx].classList.add('highlighted');
          items[idx].scrollIntoView({ block: 'nearest', behavior: 'instant' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          idx = Math.max(idx - 1, 0);
          items.forEach(el => el.classList.remove('highlighted'));
          items[idx].classList.add('highlighted');
          items[idx].scrollIntoView({ block: 'nearest', behavior: 'instant' });
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (idx >= 0) items[idx].click();
          else if (items.length) items[0].click();
        }
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box-container')) {
          if (dropdown) dropdown.style.display = 'none';
        }
      });
    }
  }

  async function setScope(scope) {
    appState.currentScope = scope;
    const globalBtn = document.getElementById('scope-global-btn');
    const continentBtn = document.getElementById('scope-continent-btn');
    const countryBtn = document.getElementById('scope-country-btn');
    const searchInput = document.getElementById('region-search-input');
    const searchLabel = document.getElementById('search-input-label');
    const titleEl = document.getElementById('creator-map-title');
    const subTitleEl = document.getElementById('creator-map-subtitle');

    [globalBtn, continentBtn, countryBtn].forEach(b => {
      if (b) b.classList.remove('active');
    });

    if (scope === 'global') {
      if (globalBtn) globalBtn.classList.add('active');
      if (searchLabel) searchLabel.textContent = '2. Choose Global Scope';
      if (searchInput) {
        searchInput.value = appState.globalMode === 'WORLD_COUNTRIES' ? 'Global (All Countries)' : 'Global (All Continents)';
        searchInput.placeholder = 'Select Continents or Countries...';
      }
      
      await selectGlobalScope(appState.globalMode);

    } else if (scope === 'continent') {
      if (continentBtn) continentBtn.classList.add('active');
      if (searchLabel) searchLabel.textContent = '2. Choose Continent';
      if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = 'Search continent (e.g. Africa, Asia, Europe)...';
      }
      if (titleEl) titleEl.textContent = 'Continent Countries Preview';
      if (subTitleEl) subTitleEl.textContent = 'Preview of countries in the selected continent';

      // First alphabet continent (Africa: 'AF')
      const firstAlphabetContinent = appState.continentsData
        .filter(c => c.id !== 'AN' && c.id !== 'AQ')
        .sort((a, b) => a.name.localeCompare(b.name))[0]?.id || 'AF';

      await selectContinentScope(firstAlphabetContinent);

    } else if (scope === 'country') {
      if (countryBtn) countryBtn.classList.add('active');
      if (searchLabel) searchLabel.textContent = '2. Choose Country';
      if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = 'Search country (e.g. Afghanistan, Albania, Algeria)...';
      }
      if (titleEl) titleEl.textContent = 'Country Provinces / States Preview';
      if (subTitleEl) subTitleEl.textContent = 'Preview of divisions in the selected country';

      // First alphabet country (Afghanistan: 'AF')
      const firstAlphabetCountry = appState.namesData
        .filter(r => r.type === 'country')
        .sort((a, b) => a.name.localeCompare(b.name))[0]?.id;

      await selectCountryScope(firstAlphabetCountry);
    }
  }

  async function selectGlobalScope(type) {
    appState.globalMode = type;
    const titleEl = document.getElementById('creator-map-title');
    const subTitleEl = document.getElementById('creator-map-subtitle');
    const searchInput = document.getElementById('region-search-input');

    if (type === 'WORLD_COUNTRIES') {
      if (searchInput) searchInput.value = 'Global (All Countries)';
      if (titleEl) titleEl.textContent = 'Global Countries Preview';
      if (subTitleEl) subTitleEl.textContent = 'Preview of all 177+ countries map';

      let mapData = appState.worldCountriesMap;
      if (!mapData) {
        mapData = await fetch('/data/world-countries.json').then(r => r.json());
        appState.worldCountriesMap = mapData;
      }
      appState.currentMapData = mapData;
      appState.creatorMapRenderer.render(mapData, {});

      setCreatorSelectedRegion({
        id: 'WORLD_COUNTRIES',
        name: 'Global (All Countries)',
        type: 'global_countries',
        iso: 'WORLD_COUNTRIES',
        flag: '🗺️',
        subCount: mapData.features.length
      });
    } else {
      if (searchInput) searchInput.value = 'Global (All Continents)';
      if (titleEl) titleEl.textContent = 'Global Continents Preview';
      if (subTitleEl) subTitleEl.textContent = 'Preview of all 7 continents map';

      let mapData = appState.worldContinentsMap;
      if (!mapData) {
        mapData = await fetch('/data/world-continents.json').then(r => r.json());
        appState.worldContinentsMap = mapData;
      }
      appState.currentMapData = mapData;
      appState.creatorMapRenderer.render(mapData, {});

      setCreatorSelectedRegion({
        id: 'WORLD_CONTINENTS',
        name: 'Global (All Continents)',
        type: 'global_continents',
        iso: 'WORLD_CONTINENTS',
        flag: '🌍',
        subCount: 7
      });
    }
  }

  function handleSearchInput(query) {
    const dropdown = document.getElementById('search-dropdown');
    if (!dropdown) return;

    let filtered = [];
    let selectedItemId = null;
    const cleanQuery = (query || '').trim().toLowerCase();

    if (appState.currentScope === 'global') {
      selectedItemId = appState.globalMode;
      const allGlobalOptions = [
        {
          id: 'WORLD_CONTINENTS',
          name: 'Global (All Continents)',
          type: 'global_continents',
          flag: '🌍',
          iso: 'WORLD_CONTINENTS'
        },
        {
          id: 'WORLD_COUNTRIES',
          name: 'Global (All Countries)',
          type: 'global_countries',
          flag: '🗺️',
          iso: 'WORLD_COUNTRIES'
        }
      ];

      // If query is empty or matches the currently selected option name exactly, show all options
      const isExactMatchSelected = allGlobalOptions.some(item => item.id === selectedItemId && item.name.toLowerCase() === cleanQuery);
      if (!cleanQuery || isExactMatchSelected) {
        filtered = allGlobalOptions;
      } else {
        filtered = allGlobalOptions.filter(item => item.name.toLowerCase().includes(cleanQuery));
      }

    } else if (appState.currentScope === 'continent') {
      selectedItemId = appState.selectedRegion ? (appState.selectedRegion.iso || appState.selectedRegion.id) : 'AF';
      // Filter out single-country continents (e.g. Antarctica) and sort alphabetically
      const allContinents = appState.continentsData
        .filter(c => c.id !== 'AN' && c.id !== 'AQ')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => ({
          id: c.id,
          name: c.name,
          type: 'continent',
          flag: c.icon,
          iso: c.id
        }));

      const isExactMatchSelected = allContinents.some(item => (item.id === selectedItemId || item.iso === selectedItemId) && item.name.toLowerCase() === cleanQuery);
      if (!cleanQuery || isExactMatchSelected) {
        filtered = allContinents;
      } else {
        filtered = allContinents.filter(c => c.name.toLowerCase().includes(cleanQuery));
      }

    } else if (appState.currentScope === 'country') {
      selectedItemId = appState.selectedRegion ? (appState.selectedRegion.iso || appState.selectedRegion.id) : 'AF';
      const allCountries = appState.namesData
        .filter(r => r.type === 'country')
        .sort((a, b) => a.name.localeCompare(b.name));

      const isExactMatchSelected = allCountries.some(item => (item.id === selectedItemId || item.iso === selectedItemId) && item.name.toLowerCase() === cleanQuery);
      if (!cleanQuery || isExactMatchSelected) {
        filtered = allCountries.slice(0, 100);
      } else {
        filtered = allCountries
          .filter(r => r.name.toLowerCase().includes(cleanQuery))
          .slice(0, 50);
      }
    }

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div style="padding:10px 14px; font-weight:700; color:var(--text-muted);">No matching regions found</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = filtered.map((item, idx) => {
      const isSelected = cleanQuery ? idx === 0 : (item.id === selectedItemId || item.iso === selectedItemId);
      return `
        <div class="search-result-item ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-type="${item.type}">
          <span>${item.flag || '📍'} ${item.name}</span>
          <span class="neo-badge ${isSelected ? 'neo-btn-white' : 'neo-btn-white'}" style="font-size:10px;">
            ${isSelected ? '✓ SELECTED' : item.type.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      `;
    }).join('');

    dropdown.style.display = 'block';

    // Scroll to selected item without animation
    const selectedEl = dropdown.querySelector('.search-result-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }

    function handleDropdownSelect(el) {
      const id = el.dataset.id;
      const type = el.dataset.type;
      dropdown.style.display = 'none';
      
      if (type === 'global_continents' || type === 'global_countries') {
        selectGlobalScope(id);
      } else if (type === 'continent') {
        selectContinentScope(id);
      } else if (type === 'country') {
        selectCountryScope(id);
      }

      requestAnimationFrame(() => document.getElementById('region-search-input')?.blur());
    }

    dropdown.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        skipBlurHide = true;
        handleDropdownSelect(el);
      });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        handleDropdownSelect(el);
      });
    });
  }

  async function selectContinentScope(contId) {
    const cont = appState.continentsData.find(c => c.id === contId) || appState.continentsData[0];
    if (!cont) return;

    const searchInput = document.getElementById('region-search-input');
    if (searchInput) searchInput.value = cont.name;

    try {
      const contMap = await fetch(`/data/continents/${cont.id}.json`).then(r => r.json());
      appState.currentMapData = contMap;
      appState.creatorMapRenderer.render(contMap, {});

      const titleEl = document.getElementById('creator-map-title');
      const subTitleEl = document.getElementById('creator-map-subtitle');
      if (titleEl) titleEl.textContent = `${cont.name} Countries Preview`;
      if (subTitleEl) subTitleEl.textContent = `Includes all ${contMap.features.length} countries in ${cont.name}`;

      setCreatorSelectedRegion({
        id: cont.id,
        name: cont.name,
        type: 'continent',
        iso: cont.id,
        flag: cont.icon,
        subCount: contMap.features.length
      });
    } catch (e) {
      console.error('Failed to load continent map', e);
    }
  }

  async function selectCountryScope(countryIso) {
    const country = appState.namesData.find(r => (r.id === countryIso || r.iso === countryIso) && r.type === 'country');
    const countryName = country ? country.name : countryIso;
    const flag = country ? country.flag : '📍';

    const searchInput = document.getElementById('region-search-input');
    if (searchInput) searchInput.value = countryName;

    try {
      const countryMap = await fetch(`/data/admin1/${countryIso}.json`).then(r => r.json());
      appState.currentMapData = countryMap;
      appState.creatorMapRenderer.render(countryMap, {});

      const titleEl = document.getElementById('creator-map-title');
      const subTitleEl = document.getElementById('creator-map-subtitle');
      if (titleEl) titleEl.textContent = `${countryName} Provinces / States Preview`;
      if (subTitleEl) subTitleEl.textContent = `Includes all ${countryMap.features.length} divisions in ${countryName}`;

      setCreatorSelectedRegion({
        id: countryIso,
        name: countryName,
        type: 'country',
        iso: countryIso,
        flag: flag,
        subCount: countryMap.features.length
      });
    } catch (e) {
      console.warn(`Admin1 map for ${countryIso} not available`, e);
      setCreatorSelectedRegion({
        id: countryIso,
        name: countryName,
        type: 'country',
        iso: countryIso,
        flag: flag
      });
    }
  }

  function setCreatorSelectedRegion(region) {
    appState.selectedRegion = region;
    const nameEl = document.getElementById('creator-selected-region-name');
    const descEl = document.getElementById('creator-selected-region-desc');
    const scopeBadge = document.getElementById('creator-selected-scope-badge');
    const pkgBtn = document.getElementById('package-xdc-btn');

    if (nameEl) nameEl.textContent = `${region.flag || '📍'} ${region.name}`;
    if (scopeBadge) scopeBadge.textContent = `${appState.currentScope.toUpperCase()} SCOPE`;
    if (descEl) {
      if (region.type === 'global_continents') {
        descEl.textContent = 'Generates an independent .xdc poll for all 7 continents.';
      } else if (region.type === 'global_countries') {
        descEl.textContent = 'Generates an independent .xdc poll for all 177+ countries worldwide.';
      } else if (appState.currentScope === 'continent') {
        descEl.textContent = `Generates a .xdc poll with ${region.subCount || 'all'} countries in ${region.name}.`;
      } else {
        descEl.textContent = `Generates a .xdc poll with ${region.subCount || 'all'} provinces / states in ${region.name}.`;
      }
    }
    if (pkgBtn) pkgBtn.disabled = false;
  }

  function handleUsageRegionSelected(id, feature) {
    appState.selectedRegion = feature || { id, name: id };
    const nameEl = document.getElementById('usage-selected-region-name');
    const descEl = document.getElementById('usage-selected-region-desc');
    const confirmBtn = document.getElementById('confirm-location-btn');

    const regionFlag = appState.selectedRegion.flag || (appState.namesData.find(n => n.id === id || n.iso === id) || {}).flag || '';
    if (nameEl) nameEl.textContent = `${regionFlag ? regionFlag + ' ' : ''}${appState.selectedRegion.name}`;
    if (descEl) descEl.textContent = `Confirm "${appState.selectedRegion.name}" as your location in ${appState.config?.region || 'Poll'}.`;
    if (confirmBtn) confirmBtn.disabled = false;
  }

  function setupEventListeners() {
    // Creator Zoom
    document.getElementById('creator-zoom-in-btn')?.addEventListener('click', () => appState.creatorMapRenderer?.zoomIn());
    document.getElementById('creator-zoom-out-btn')?.addEventListener('click', () => appState.creatorMapRenderer?.zoomOut());
    document.getElementById('creator-zoom-reset-btn')?.addEventListener('click', () => appState.creatorMapRenderer?.resetZoom());

    // Usage Zoom
    document.getElementById('usage-zoom-in-btn')?.addEventListener('click', () => appState.usageMapRenderer?.zoomIn());
    document.getElementById('usage-zoom-out-btn')?.addEventListener('click', () => appState.usageMapRenderer?.zoomOut());
    document.getElementById('usage-zoom-reset-btn')?.addEventListener('click', () => appState.usageMapRenderer?.resetZoom());

    // Package XDC Button
    document.getElementById('package-xdc-btn')?.addEventListener('click', handlePackageXdc);
    document.getElementById('run-region-btn')?.addEventListener('click', handleRunRegion);

    // Confirm Location Button
    document.getElementById('confirm-location-btn')?.addEventListener('click', handleConfirmLocation);

    // Reset Sync in Sim Bar
    document.getElementById('clear-sync-btn')?.addEventListener('click', () => {
      if (window.webxdc && window.webxdc.sendUpdate) {
        window.webxdc.sendUpdate({
          payload: { action: 'CLEAR' },
          info: 'Reset all votes',
          summary: '0 Participants'
        }, 'Reset poll');
      }
    });
  }

  async function handlePackageXdc() {
    if (!appState.selectedRegion) return;

    const btn = document.getElementById('package-xdc-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Packaging .xdc (Compressed)...';

    const sel = appState.selectedRegion;
    let level = appState.currentScope;
    let subType = 'standard';

    if (sel.type === 'global_continents') {
      level = 'world_continents';
      subType = 'continents';
    } else if (sel.type === 'global_countries') {
      level = 'world_countries';
      subType = 'countries';
    }

    const config = {
      level: level,
      subType: subType,
      region: sel.name,
      iso: sel.iso || sel.id,
      regionName: sel.name,
      createdAt: new Date().toISOString()
    };

    try {
      const result = await appState.packager.buildSubPackage(config);

      // Send to Delta Chat immediately
      if (window.webxdc && window.webxdc.sendToChat) {
        try {
          await window.webxdc.sendToChat({
            file: {
              name: result.fileName,
              blob: result.blob
            },
            text: `Region: ${config.region}`
          });
          showToast(`🚀 Sent ${result.fileName} to chat!`);
        } catch (chatErr) {
          console.warn('sendToChat error, triggering browser download fallback', chatErr);
          triggerDownload(result);
          showToast(`Saved ${result.fileName}`);
        }
      } else {
        // Fallback for browser preview environment
        triggerDownload(result);
        showToast(`Created & downloaded ${result.fileName}`);
      }
    } catch (err) {
      console.error('Packaging error', err);
      showToast('Error generating package.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Package .XDC For This Region';
    }
  }

  async function handleRunRegion() {
    if (!appState.selectedRegion) return;

    const sel = appState.selectedRegion;
    let level = appState.currentScope;
    let subType = 'standard';

    if (sel.type === 'global_continents') {
      level = 'world_continents';
      subType = 'continents';
    } else if (sel.type === 'global_countries') {
      level = 'world_countries';
      subType = 'countries';
    }

    appState.config = {
      level: level,
      subType: subType,
      region: sel.name,
      iso: sel.iso || sel.id,
      regionName: sel.name,
      createdAt: new Date().toISOString()
    };

    appState.mode = 'USAGE';
    appState.currentScope = 'global';
    appState.selectedRegion = null;
    appState.counts = {};

    await renderViewsForMode();
    showToast(`▶️ Running poll for: ${sel.name}`);
  }

  function triggerDownload(result) {
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleConfirmLocation() {
    if (!appState.selectedRegion || !window.webxdc) return;

    const user = window.webxdc.selfAddr || 'user_' + Math.random().toString(36).substring(2, 8);
    const userName = window.webxdc.selfName || 'Anonymous';
    const regionId = appState.selectedRegion.id;
    const regionName = appState.selectedRegion.name;

    appState.myLocation = regionId;
    localStorage.setItem(`my_loc_${appState.config?.iso || 'global'}`, regionId);

    // Calculate updated total participants for summary
    const tempCounts = { ...appState.counts };
    tempCounts[regionId] = (tempCounts[regionId] || 0) + 1;
    const totalParticipants = Object.values(tempCounts).reduce((a, b) => a + b, 0);

    // Immediately deselect from map renderer and reset selectedRegion
    if (appState.usageMapRenderer) {
      appState.usageMapRenderer.deselect();
    }
    appState.selectedRegion = null;

    // Send update: Summary as "X Participants", info empty so no unwanted "Users live in Country" in chat
    window.webxdc.sendUpdate({
      payload: {
        action: 'VOTE',
        user: user,
        userName: userName,
        regionId: regionId,
        regionName: regionName,
        timestamp: Date.now()
      },
      summary: `${totalParticipants} Participants`,
    }, '');

    showToast(`Your location was recorded: ${regionName}`);
    updateVoteBadge();

    const nameEl = document.getElementById('usage-selected-region-name');
    const descEl = document.getElementById('usage-selected-region-desc');
    const confirmBtn = document.getElementById('confirm-location-btn');
    if (nameEl) nameEl.textContent = 'None Selected';
    if (descEl) descEl.textContent = 'Click on the map to choose your region.';
    if (confirmBtn) confirmBtn.disabled = true;
  }

  function checkSavedUserPick() {
    const saved = localStorage.getItem(`my_loc_${appState.config?.iso || 'global'}`);
    if (saved) {
      appState.myLocation = saved;
      updateVoteBadge();
    }
  }

  function getRegionDisplayName(regId) {
    if (!regId) return '';
    if (appState.currentMapData) {
      const feats = appState.currentMapData.features || appState.currentMapData.provinces || [];
      const f = feats.find(item => item.id === regId || item.iso === regId || item.code === regId);
      if (f) return f.name;
    }
    const expectedType = appState.currentScope === 'country' ? 'country' : appState.currentScope === 'continent' ? 'continent' : null;
    const found = appState.namesData.find(item => (item.id === regId || item.iso === regId) && (!expectedType || item.type === expectedType));
    if (found) return found.name;
    return regId;
  }

  function updateVoteBadge() {
    const badge = document.getElementById('my-current-vote-badge');
    if (!badge) return;
    if (appState.myLocation) {
      const countryOrRegionName = getRegionDisplayName(appState.myLocation);
      badge.textContent = `Your Pick: ${countryOrRegionName}`;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function setupWebXdcSync() {
    if (!window.webxdc || !window.webxdc.setUpdateListener) return;

    let userVotes = {};

    window.webxdc.setUpdateListener((update) => {
      if (!update.payload) return;
      const { action, user, regionId } = update.payload;

      if (action === 'CLEAR') {
        userVotes = {};
        appState.counts = {};
      } else if (action === 'VOTE') {
        userVotes[user] = regionId;
      }

      const counts = {};
      Object.values(userVotes).forEach(rId => {
        counts[rId] = (counts[rId] || 0) + 1;
      });
      appState.counts = counts;

      if (appState.usageMapRenderer && appState.currentMapData) {
        appState.usageMapRenderer.render(
          appState.currentMapData,
          appState.counts,
          appState.selectedRegion ? appState.selectedRegion.id : null
        );
      }

      updateVoteBadge();
      updateStatsUI();
    });
  }

  function updateStatsUI() {
    const list = document.getElementById('ranking-stats-list');
    const totalVotesEl = document.getElementById('total-votes-count');
    if (!list) return;

    const entries = Object.entries(appState.counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((acc, cur) => acc + cur[1], 0);

    if (totalVotesEl) totalVotesEl.textContent = `${total} Participants`;

    if (entries.length === 0) {
      list.innerHTML = `<div class="neo-card" style="text-align:center; color: var(--text-muted); font-weight:700;">No votes yet. Click a region to vote!</div>`;
      return;
    }

    list.innerHTML = entries.map(([regId, count], idx) => {
      const displayName = getRegionDisplayName(regId);
      const isMyPick = appState.myLocation === regId;

      return `
        <div class="stats-item ${isMyPick ? 'my-pick' : ''}">
          <div style="display:flex; align-items:center; overflow:hidden;">
            <span class="stats-rank">#${idx + 1}</span>
            <strong style="white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${displayName}</strong>
            ${isMyPick ? '<span class="neo-badge neo-btn-pink" style="margin-left:8px; font-size:10px;">YOU</span>' : ''}
          </div>
          <span class="stats-count">${count} vote${count > 1 ? 's' : ''}</span>
        </div>
      `;
    }).join('');
  }

  function showToast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  window.addEventListener('DOMContentLoaded', initApp);
})();
