/**
 * In-Browser WebXDC Packager (.xdc)
 * Creates a pure offline .xdc package with embedded HTML/CSS/JS, icon.png, and ONLY the target region dataset.
 * Uses deflate compression via JSZip.
 */
class XdcPackager {
  constructor() {}

  async buildSubPackage(config) {
    const zip = new window.JSZip();

    const manifestContent = `name = "Where Are You All?"
source_code_url = "https://github.com/webxdc/where-are-you-all"
`;
    zip.file("manifest.toml", manifestContent);
    zip.file("config.json", JSON.stringify(config, null, 2));

    try {
      // Fetch web application shell & icon.png
      const [htmlResp, cssResp, appResp, mapResp, zipResp, packResp, iconResp] = await Promise.all([
        fetch('/index.html').then(r => r.text()),
        fetch('/css/style.css').then(r => r.text()),
        fetch('/js/app.js').then(r => r.text()),
        fetch('/js/map.js').then(r => r.text()),
        fetch('/js/jszip.min.js').then(r => r.text()),
        fetch('/js/packager.js').then(r => r.text()),
        fetch('/icon.png').then(r => r.arrayBuffer()).catch(() => null)
      ]);

      zip.file("index.html", htmlResp);
      zip.file("css/style.css", cssResp);
      zip.file("js/app.js", appResp);
      zip.file("js/map.js", mapResp);
      zip.file("js/jszip.min.js", zipResp);
      zip.file("js/packager.js", packResp);

      if (iconResp) {
        zip.file("icon.png", new Uint8Array(iconResp));
      }

      // Embed ONLY the specific map and region dataset required for this scope
      const fetchMapText = async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${url}`);
        return res.text();
      };

      if (config.level === 'world_continents' || (config.level === 'world' && config.subType === 'continents')) {
        zip.file("data/world-continents.json", await fetchMapText('/data/world-continents.json'));
      } else if (config.level === 'world_countries' || (config.level === 'world' && config.subType === 'countries')) {
        zip.file("data/world-countries.json", await fetchMapText('/data/world-countries.json'));
      } else if (config.level === 'continent') {
        zip.file(`data/continents/${config.iso}.json`, await fetchMapText(`/data/continents/${config.iso}.json`));
      } else if (config.level === 'country') {
        zip.file(`data/admin1/${config.iso}.json`, await fetchMapText(`/data/admin1/${config.iso}.json`));
      }

    } catch (err) {
      console.error('[Packager] Error bundling files', err);
      // Never produce a poll package without its map dataset: it would open to a blank map.
      throw err;
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const safeRegion = (config.region || 'region').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const fileName = `where-are-you-all-${safeRegion}.xdc`;

    return {
      blob,
      fileName,
      url: URL.createObjectURL(blob),
      sizeKb: Math.round(blob.size / 1024)
    };
  }
}

window.XdcPackager = XdcPackager;
