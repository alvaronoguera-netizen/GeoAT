/*
 * Geo AT — Geoportal académico
 * Versión corregida para funcionar tanto con:
 *   1) doble clic en index.html (file://)
 *   2) Live Server / localhost
 *   3) GitHub Pages (https://)
 *
 * Correcciones principales:
 * - No se intenta leer data/layers.json mediante fetch() cuando la página se abre
 *   con file://, evitando el error CORS de Chrome/Edge.
 * - Las capas demostrativas tienen GeoJSON embebido como respaldo, por lo que
 *   también funcionan al abrir index.html directamente.
 * - Se elimina la capa estándar de tile.openstreetmap.org del arranque. Ese
 *   servidor puede bloquear solicitudes file:// por sus requisitos de Referer
 *   y política de uso de tiles. Se usan mapas base de Esri (calles + satélite)
 *   que muestran carreteras, ciudades y contexto territorial sin ese 403.
 * - Se añade manejo de errores para que un recurso externo no rompa el portal.
 * - Se corrige el comportamiento de edición/medición y la descarga local.
 */

const CATEGORIES = [
  'Agropecuaria',
  'Aguas interiores',
  'Biota',
  'Climatología Meteorología Atmósfera',
  'Contornos',
  'Economía',
  'Elevación',
  'Entorno',
  'Estructura',
  'Planificación catastral',
  'Salud',
  'Sociedad',
  'Transporte',
  'Ubicación'
];

// Sistemas de coordenadas soportados por Geo AT.
// Leaflet trabaja internamente con coordenadas geográficas (lon/lat, WGS84),
// por lo que las capas proyectadas se transforman antes de dibujarse.
const CRS_OPTIONS = [
  { value: 'AUTO', label: 'Detectar automáticamente' },
  { value: 'EPSG:4326', label: 'WGS 84 geográficas — EPSG:4326' },
  { value: 'EPSG:3857', label: 'WGS 84 / Web Mercator — EPSG:3857' },
  { value: 'EPSG:32615', label: 'WGS 84 / UTM zona 15N — EPSG:32615' },
  { value: 'EPSG:32616', label: 'WGS 84 / UTM zona 16N — EPSG:32616' },
  { value: 'EPSG:32614', label: 'WGS 84 / UTM zona 14N — EPSG:32614' },
  { value: 'EPSG:32617', label: 'WGS 84 / UTM zona 17N — EPSG:32617' },
  { value: 'EPSG:4258', label: 'ETRS89 geográficas — EPSG:4258' },
  { value: 'EPSG:4269', label: 'NAD83 geográficas — EPSG:4269' },
  { value: 'EPSG:4267', label: 'NAD27 geográficas — EPSG:4267' },
  { value: 'ESRI:103598', label: 'GTM (Guatemala) — ESRI:103598' },
  { value: 'CUSTOM', label: 'Otro CRS (EPSG / PROJ.4 / WKT)' }
];

const CRS_PROJ4 = {
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs +type=crs',
  'EPSG:3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs',
  'EPSG:32615': '+proj=utm +zone=15 +datum=WGS84 +units=m +no_defs +type=crs',
  'EPSG:32616': '+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs +type=crs',
  'EPSG:32614': '+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs +type=crs',
  'EPSG:32617': '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs +type=crs',
  'EPSG:4258': '+proj=longlat +ellps=GRS80 +no_defs +type=crs',
  'EPSG:4269': '+proj=longlat +datum=NAD83 +no_defs +type=crs',
  'EPSG:4267': '+proj=longlat +datum=NAD27 +no_defs +type=crs',
  // GTM oficial de Guatemala, identificador ESRI:103598.
  // lon_0=-90.5, k=0.9998, false easting=500000 m.
  'ESRI:103598': '+proj=tmerc +lat_0=0 +lon_0=-90.5 +k=0.9998 +x_0=500000 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs'
};

function registerCRSDefinitions() {
  if (!window.proj4) return;
  Object.entries(CRS_PROJ4).forEach(([code, def]) => {
    try { proj4.defs(code, def); } catch (_) {}
  });
}

function normalizeCRS(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.includes('GTM') || raw.includes('103598')) return 'ESRI:103598';
  const epsg = raw.match(/(?:EPSG[:\/ ]*|URN:OGC:DEF:CRS:EPSG::)(4326|3857|32615|32616)\b/);
  if (epsg) return `EPSG:${epsg[1]}`;
  if (raw === '4326') return 'EPSG:4326';
  if (raw === '3857') return 'EPSG:3857';
  if (raw === '32614') return 'EPSG:32614';
  if (raw === '32615') return 'EPSG:32615';
  if (raw === '32616') return 'EPSG:32616';
  if (raw === '32617') return 'EPSG:32617';
  if (raw === '4258') return 'EPSG:4258';
  if (raw === '4269') return 'EPSG:4269';
  if (raw === '4267') return 'EPSG:4267';
  return '';
}

function crsLabel(code) {
  const hit = CRS_OPTIONS.find(x => x.value === code);
  return hit?.label || code || 'No identificado';
}

function extractCRSFromGeoJSON(raw) {
  const candidates = [];
  const crs = raw?.crs;
  if (crs) {
    if (typeof crs === 'string') candidates.push(crs);
    if (crs.name) candidates.push(crs.name);
    if (crs.href) candidates.push(crs.href);
    if (crs.properties) {
      if (crs.properties.name) candidates.push(crs.properties.name);
      if (crs.properties.code) candidates.push(String(crs.properties.code));
      if (crs.properties.href) candidates.push(crs.properties.href);
    }
  }
  for (const candidate of candidates) {
    const normalized = normalizeCRS(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function walkCoordinates(node, visitor, depth = 0) {
  if (Array.isArray(node)) {
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      visitor(node);
      return;
    }
    node.forEach(child => walkCoordinates(child, visitor, depth + 1));
  }
}

function getCoordinateRange(geojson) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  walkCoordinates(geojson, c => {
    minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
    minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
  });
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

function isGeographicRange(range) {
  return !!range &&
    range.minX >= -180 && range.maxX <= 180 &&
    range.minY >= -90 && range.maxY <= 90;
}

function transformCoordinateTree(node, transformer) {
  if (Array.isArray(node)) {
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      return transformer(node);
    }
    return node.map(child => transformCoordinateTree(child, transformer));
  }
  return node;
}

function cloneGeoJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function transformGeoJSONToWGS84(rawGeoJSON, sourceCRS) {
  const normalized = normalizeCRS(sourceCRS) || (isGeographicRange(getCoordinateRange(rawGeoJSON)) ? 'EPSG:4326' : '');
  if (!normalized) {
    throw new Error('No fue posible identificar el CRS de la capa. Selecciona el sistema de coordenadas de origen en el Paso 1.');
  }

  if (normalized === 'EPSG:4326') {
    return { geojson: cloneGeoJSON(rawGeoJSON), sourceCRS: normalized, transformed: false };
  }

  if (!window.proj4) {
    throw new Error('La librería de transformación de coordenadas no está disponible. Revisa tu conexión a internet.');
  }

  registerCRSDefinitions();
  const sourceDef = CRS_PROJ4[normalized] || sourceCRS;
  if (!sourceDef) {
    throw new Error(`No hay una definición configurada para ${sourceCRS}.`);
  }

  const output = cloneGeoJSON(rawGeoJSON);
  const transformer = coordinate => {
    const extra = coordinate.length > 2 ? coordinate.slice(2) : [];
    const xy = proj4(sourceDef, CRS_PROJ4['EPSG:4326'], [coordinate[0], coordinate[1]]);
    return [xy[0], xy[1], ...extra];
  };

  if (output.type === 'FeatureCollection') {
    output.features = output.features.map(feature => {
      if (feature.geometry?.coordinates) {
        feature.geometry.coordinates = transformCoordinateTree(feature.geometry.coordinates, transformer);
      }
      return feature;
    });
  } else if (output.type === 'Feature' && output.geometry?.coordinates) {
    output.geometry.coordinates = transformCoordinateTree(output.geometry.coordinates, transformer);
  } else if (output.coordinates) {
    output.coordinates = transformCoordinateTree(output.coordinates, transformer);
  }

  delete output.crs;
  return { geojson: output, sourceCRS: normalized, transformed: true };
}

function detectCRSForGeoJSON(raw) {
  const embedded = extractCRSFromGeoJSON(raw);
  if (embedded) return { code: embedded, confidence: 'metadata' };

  const range = getCoordinateRange(raw);
  if (isGeographicRange(range)) return { code: 'EPSG:4326', confidence: 'range' };

  return { code: '', confidence: 'unknown' };
}


// GeoJSON demostrativo embebido: permite abrir index.html con doble clic.
const DEMO_ZONAS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { nombre: 'Zona 1', valor_suelo: 850, uso: 'Residencial' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-89.555, 14.807], [-89.545, 14.807], [-89.545, 14.817],
          [-89.555, 14.817], [-89.555, 14.807]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { nombre: 'Zona 2', valor_suelo: 1250, uso: 'Mixto' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-89.545, 14.807], [-89.535, 14.807], [-89.535, 14.817],
          [-89.545, 14.817], [-89.545, 14.807]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { nombre: 'Zona 3', valor_suelo: 1750, uso: 'Comercial' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-89.535, 14.807], [-89.525, 14.807], [-89.525, 14.817],
          [-89.535, 14.817], [-89.535, 14.807]
        ]]
      }
    }
  ]
};

const DEMO_PUNTOS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { nombre: 'Punto A', codigo: 'PA-001', valor: 100 },
      geometry: { type: 'Point', coordinates: [-89.551, 14.821] }
    },
    {
      type: 'Feature',
      properties: { nombre: 'Punto B', codigo: 'PB-002', valor: 150 },
      geometry: { type: 'Point', coordinates: [-89.532, 14.821] }
    },
    {
      type: 'Feature',
      properties: { nombre: 'Punto C', codigo: 'PC-003', valor: 225 },
      geometry: { type: 'Point', coordinates: [-89.515, 14.813] }
    }
  ]
};

const BUILTIN_CATALOG = [
  {
    id: 'demo-zonas',
    title: 'Zonas demostrativas GeoAT',
    summary: 'Capa de ejemplo con polígonos y un atributo numérico de valor del suelo para probar el visor y el panel estadístico.',
    type: 'Feature type',
    language: 'Español',
    categories: ['Economía', 'Planificación catastral', 'Ubicación'],
    license: 'Uso académico y demostrativo.',
    rights: 'Datos ficticios de demostración de GeoAT.',
    restrictions: 'No utilizar para decisiones oficiales.',
    extentMode: 'layer',
    extentText: '14.807000–14.817000 N; -89.555000–-89.525000 E',
    crs: 'EPSG:4326',
    contact: {
      name: 'GeoAT', phone: '', email: '', role: 'Administrador del prototipo',
      organization: 'CUNORI-USAC', address: '', city: 'Chiquimula', country: 'Guatemala'
    },
    link: '',
    linkDescription: 'Capa de prueba incluida con el prototipo.',
    history: { created: '2026-01-01', reviewed: '2026-01-01', published: '2026-01-01' },
    format: 'GeoJSON',
    crs: 'EPSG:4326',
    fileName: 'demo-zonas.geojson',
    source: 'data/demo-zonas.geojson',
    data: DEMO_ZONAS
  },
  {
    id: 'demo-puntos',
    title: 'Puntos de control demostrativos',
    summary: 'Capa de ejemplo con puntos y atributos para probar consultas, ventanas emergentes y estadísticas.',
    type: 'Feature type',
    language: 'Español',
    categories: ['Contornos', 'Ubicación'],
    license: 'Uso académico y demostrativo.',
    rights: 'Datos ficticios de demostración de GeoAT.',
    restrictions: 'No utilizar como coordenadas oficiales.',
    extentMode: 'layer',
    extentText: 'Extensión detectada automáticamente.',
    crs: 'EPSG:4326',
    contact: {
      name: 'GeoAT', phone: '', email: '', role: 'Administrador del prototipo',
      organization: 'CUNORI-USAC', address: '', city: 'Chiquimula', country: 'Guatemala'
    },
    link: '',
    linkDescription: 'Capa de prueba incluida con el prototipo.',
    history: { created: '2026-01-01', reviewed: '2026-01-01', published: '2026-01-01' },
    format: 'GeoJSON',
    crs: 'EPSG:4326',
    fileName: 'demo-puntos.geojson',
    source: 'data/demo-puntos.geojson',
    data: DEMO_PUNTOS
  }
];

const state = {
  layers: [],
  mapLayers: new Map(),
  metadata: new Map(),
  db: null,
  map: null,
  selectedId: null,
  measureGroup: null,
  measureStart: null,
  measureHandler: null,
  measureMode: null,
  currentStep: 1,
  layerFile: null,
  detected: null,
  editable: null,
  streets: null,
  satellite: null
};

const dom = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[c]));

function setStatus(msg) {
  if (dom('statusText')) dom('statusText').textContent = msg;
}

// Vincula eventos solo cuando el elemento existe. Esto evita que un botón
// opcional ausente detenga todo el portal con un error de JavaScript.
function bind(id, event, handler) {
  const el = dom(id);
  if (!el) return false;
  el.addEventListener(event, handler);
  return true;
}

function initCategories() {
  const box = dom('categoryGrid');
  if (!box) return;
  box.innerHTML = CATEGORIES.map(c => `
    <label class="category-option">
      <input type="checkbox" name="category" value="${escapeHtml(c)}">
      <span>${escapeHtml(c)}</span>
    </label>`).join('');
}

function initMap() {
  registerCRSDefinitions();
  if (!window.L) throw new Error('Leaflet no se cargó. Comprueba tu conexión a internet o usa la versión publicada en GitHub Pages.');
  const defaultCenter = [14.8105, -89.5345];
  const map = L.map('map', {
    zoomControl: true,
    preferCanvas: true,
    attributionControl: true,
    worldCopyJump: false,
    maxBounds: [[-85.05112878, -180], [85.05112878, 180]],
    maxBoundsViscosity: 1.0,
    minZoom: 2,
    maxZoom: 19
  }).setView(defaultCenter, 13);
  state.map = map;

  // Se usa Esri para evitar el 403 de tile.openstreetmap.org al abrir el HTML
  // directamente mediante file://. Ambos mapas traen contexto territorial.
  const streets = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      maxNativeZoom: 18,
      noWrap: true,
      attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
    }
  );

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      maxNativeZoom: 18,
      noWrap: true,
      attribution: 'Tiles &copy; Esri'
    }
  );

  streets.addTo(map);
  state.streets = streets;
  state.satellite = satellite;

  L.control.layers(
    { 'Calles': streets, 'Satélite': satellite },
    null,
    { position: 'topright', collapsed: false }
  ).addTo(map);

  state.editable = L.featureGroup().addTo(map);

  if (window.L?.Control?.Draw) {
    new L.Control.Draw({
      position: 'topright',
      draw: {
        polyline: { shapeOptions: { color: '#7c3aed', weight: 3 } },
        polygon: { allowIntersection: false, shapeOptions: { color: '#7c3aed', fillOpacity: 0.15 } },
        rectangle: { shapeOptions: { color: '#7c3aed', fillOpacity: 0.15 } },
        circle: false,
        marker: false,
        circlemarker: false
      },
      edit: { featureGroup: state.editable }
    }).addTo(map);
  }

  map.on('mousemove', e => {
    dom('coordBox').textContent = `Lat: ${e.latlng.lat.toFixed(6)} | Lon: ${e.latlng.lng.toFixed(6)}`;
  });

  map.on(L.Draw?.Event?.CREATED || 'draw:created', e => {
    state.editable.addLayer(e.layer);
    setStatus('Geometría creada. Puedes editarla con los controles de Leaflet Draw.');
  });
  map.on(L.Draw?.Event?.EDITED || 'draw:edited', () => setStatus('Geometría editada.'));
  map.on(L.Draw?.Event?.DELETED || 'draw:deleted', () => setStatus('Geometría eliminada.'));

  // Leaflet puede calcular el tamaño del mapa demasiado pronto cuando el layout
  // todavía está cambiando. Se fuerza el recálculo al iniciar, al redimensionar
  // la ventana y cuando el contenedor cambia de tamaño. Esto evita que las
  // teselas queden cortadas o aparezcan espacios vacíos entre ellas.
  const refreshMapSize = () => {
    try {
      map.invalidateSize({ pan: false, animate: false });
    } catch (_) {}
  };

  requestAnimationFrame(() => {
    refreshMapSize();
    requestAnimationFrame(refreshMapSize);
  });
  [80, 300, 800].forEach(ms => setTimeout(refreshMapSize, ms));
  window.addEventListener('load', refreshMapSize);
  window.addEventListener('resize', refreshMapSize);
  window.addEventListener('orientationchange', refreshMapSize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(refreshMapSize, 50);
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(refreshMapSize);
    const shell = document.getElementById('map-shell') || document.querySelector('.map-shell');
    if (shell) ro.observe(shell);
  }

  [streets, satellite].forEach(layer => layer.on('tileerror', () => {
    setStatus('El mapa base informó un error de teselas. Revisa tu conexión a internet.');
  }));
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    const req = indexedDB.open('GeoAT_DB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('layers')) {
        db.createObjectStore('layers', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error || new Error('No fue posible abrir IndexedDB.'));
  });
}

async function loadLocalLayers() {
  if (!state.db) return [];
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('layers', 'readonly');
    const req = tx.objectStore('layers').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('No fue posible leer capas locales.'));
  });
}

async function saveLocalLayer(record) {
  if (!state.db) throw new Error('El almacenamiento local no está disponible.');
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('layers', 'readwrite');
    tx.objectStore('layers').put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('No fue posible guardar la capa.'));
  });
}

function clearLocalLayerRecord(id) {
  if (!state.db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('layers', 'readwrite');
    tx.objectStore('layers').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('No fue posible borrar la capa.'));
  });
}

function cloneWithoutRuntimeProperties(layer) {
  const copy = { ...layer };
  delete copy.blob;
  delete copy.data;
  return copy;
}

async function loadCatalog() {
  let catalog = BUILTIN_CATALOG.map(l => ({ ...l }));

  // Nunca hacemos fetch() al usar file://; Chrome/Edge bloquean esa lectura.
  if (location.protocol !== 'file:') {
    try {
      const r = await fetch('data/layers.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const remote = await r.json();
      if (Array.isArray(remote.layers) && remote.layers.length) {
        catalog = remote.layers;
      }
    } catch (error) {
      console.warn('Catálogo externo no disponible; se usa el catálogo integrado.', error.message);
    }
  }

  const local = await loadLocalLayers();
  state.layers = [...catalog, ...local];
  state.layers.forEach(layer => state.metadata.set(layer.id, layer));
  dom('layerCount').textContent = state.layers.length;
  renderLayerList();

  // En la carga inicial no se descargan archivos de capa: se muestran solo cuando
  // el usuario pulsa "Mapa", reduciendo tráfico y evitando peticiones innecesarias.
  setStatus('GeoAT listo. Selecciona una capa para visualizarla.');
}

function renderLayerList(filter = '') {
  const q = filter.trim().toLowerCase();
  const list = state.layers.filter(l => String(l.title || '').toLowerCase().includes(q));
  dom('layerList').innerHTML = list.map(layer => {
    const isOn = state.mapLayers.has(layer.id);
    const local = !!layer.blob;
    const canDelete = String(layer.id).startsWith('local-');
    return `<article class="layer-card ${state.selectedId === layer.id ? 'active' : ''}" data-id="${escapeHtml(layer.id)}">
      <div class="layer-title">${escapeHtml(layer.title)}</div>
      <div class="layer-meta">${escapeHtml(layer.type || 'Dataset')} · ${escapeHtml(layer.format || 'GeoJSON')}${local ? ' · local' : ''}${layer.crs ? ` · ${escapeHtml(layer.crs)}` : ''}</div>
      <div class="layer-actions">
        <button class="small-btn" data-action="view" data-id="${escapeHtml(layer.id)}">${isOn ? 'Ocultar' : 'Mapa'}</button>
        <button class="small-btn" data-action="zoom" data-id="${escapeHtml(layer.id)}">Zoom</button>
        <button class="small-btn" data-action="info" data-id="${escapeHtml(layer.id)}">Info</button>
        <button class="small-btn" data-action="download" data-id="${escapeHtml(layer.id)}">Descargar</button>
        ${canDelete ? `<button class="small-btn danger-btn" data-action="delete" data-id="${escapeHtml(layer.id)}">Borrar</button>` : '<span></span>'}
      </div>
    </article>`;
  }).join('') || '<p class="muted">No hay capas para mostrar.</p>';
}
function featureStyle() {
  return { color: '#0e4f8b', weight: 2, fillColor: '#5aa4d8', fillOpacity: 0.35 };
}

function formatPropertyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function featurePopup(feature) {
  const rows = Object.entries(feature.properties || {})
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(formatPropertyValue(v))}</td></tr>`)
    .join('');
  return `<div class="feature-popup">
    <h4>${escapeHtml(feature.properties?.nombre || feature.properties?.zona || feature.properties?.codigo || 'Entidad geográfica')}</h4>
    <table>${rows || '<tr><td colspan="2">Sin atributos</td></tr>'}</table>
  </div>`;
}

function addGeoJSON(layer, geojson) {
  const mapLayer = L.geoJSON(geojson, {
    style: featureStyle,
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 7,
      color: '#0e4f8b',
      fillColor: '#1f8b57',
      fillOpacity: 0.85,
      weight: 2
    }),
    onEachFeature: (feature, featureLayer) => {
      featureLayer.bindPopup(featurePopup(feature));
      featureLayer.bindTooltip(
        feature.properties?.nombre || feature.properties?.zona || feature.properties?.codigo || 'Entidad',
        { sticky: true, direction: 'top' }
      );
      featureLayer.on('mouseover', () => {
        if (featureLayer.setStyle) featureLayer.setStyle({ weight: 4, fillOpacity: 0.55 });
      });
      featureLayer.on('mouseout', () => {
        if (featureLayer.setStyle) featureLayer.setStyle(featureStyle());
      });
    }
  });

  mapLayer.addTo(state.map);
  state.mapLayers.set(layer.id, mapLayer);

  try {
    const bounds = mapLayer.getBounds();
    if (bounds?.isValid?.()) state.map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17, animate: false });
  } catch (_) {
    // Algunas geometrías puntuales no proporcionan bounds utilizables.
  }
  return mapLayer;
}

async function readGeoJSONSource(layer) {
  // Preferimos el GeoJSON preparado en data (ya transformado a WGS84)
  // cuando existe. El blob original se conserva para descarga.
  if (layer.data) return layer.data;
  if (layer.blob) {
    const raw = JSON.parse(await layer.blob.text());
    const sourceCRS = layer.crs || extractCRSFromGeoJSON(raw) || 'EPSG:4326';
    return transformGeoJSONToWGS84(raw, sourceCRS).geojson;
  }
  if (!layer.source) throw new Error('La capa no tiene una fuente definida.');

  if (location.protocol === 'file:') {
    throw new Error('Esta capa requiere un servidor local. Usa la capa integrada o abre Geo AT con Live Server.');
  }

  const r = await fetch(layer.source);
  if (!r.ok) throw new Error(`HTTP ${r.status} al leer ${layer.source}`);
  const raw = await r.json();
  const sourceCRS = layer.crs || extractCRSFromGeoJSON(raw) || 'EPSG:4326';
  return transformGeoJSONToWGS84(raw, sourceCRS).geojson;
}

async function addGeoTIFF(layer) {
  try {
    if (!window.parseGeoraster || !window.GeoRasterLayer) {
      throw new Error('Las librerías raster no están disponibles. Revisa tu conexión a internet.');
    }

    const buffer = layer.blob
      ? await layer.blob.arrayBuffer()
      : await (await fetch(layer.source)).arrayBuffer();

    const georaster = await parseGeoraster(buffer);
    const rasterLayer = new GeoRasterLayer({ georaster, opacity: 0.75, resolution: 256 });
    rasterLayer.addTo(state.map);
    state.mapLayers.set(layer.id, rasterLayer);

    const bounds = rasterLayer.getBounds?.();
    if (bounds?.isValid?.()) state.map.fitBounds(bounds, { padding: [35, 35], animate: false });
    setStatus(`Raster visible: ${layer.title}`);
  } catch (e) {
    console.error('GeoAT GeoTIFF:', e);
    setStatus(`No se pudo cargar el GeoTIFF: ${e.message}`);
    alert(`No fue posible cargar el raster.\n\n${e.message}\n\nPara CRS locales o personalizados, exporta desde QGIS a un GeoTIFF correctamente georreferenciado y prueba nuevamente.`);
  }
}

async function toggleLayer(id) {
  const layer = state.layers.find(x => x.id === id);
  if (!layer) return;

  state.selectedId = id;

  if (state.mapLayers.has(id)) {
    state.map.removeLayer(state.mapLayers.get(id));
    state.mapLayers.delete(id);
    setStatus(`Capa oculta: ${layer.title}`);
  } else {
    try {
      if (layer.format === 'GeoJSON') {
        const geojson = await readGeoJSONSource(layer);
        addGeoJSON(layer, geojson);
        setStatus(`Capa visible: ${layer.title}`);
      } else if ((layer.format || '').toLowerCase() === 'geotiff') {
        await addGeoTIFF(layer);
      } else {
        throw new Error(`Formato no soportado: ${layer.format || 'desconocido'}`);
      }
    } catch (error) {
      console.error('GeoAT capa:', error);
      setStatus(`No se pudo cargar "${layer.title}": ${error.message}`);
      alert(`No se pudo cargar la capa.\n\n${error.message}`);
    }
  }
  renderLayerList(dom('layerSearch').value);
}

async function zoomToLayer(id) {
  const layer = state.layers.find(x => x.id === id);
  if (!layer) return;

  try {
    if (!state.mapLayers.has(id)) {
      if (layer.format === 'GeoJSON') {
        const geojson = await readGeoJSONSource(layer);
        addGeoJSON(layer, geojson);
      } else if ((layer.format || '').toLowerCase() === 'geotiff') {
        await addGeoTIFF(layer);
      } else {
        throw new Error(`Formato no soportado: ${layer.format || 'desconocido'}`);
      }
    }

    const mapLayer = state.mapLayers.get(id);
    const bounds = mapLayer?.getBounds?.();
    if (bounds?.isValid?.()) {
      state.map.fitBounds(bounds, { padding: [45, 45], maxZoom: 18, animate: true });
      state.selectedId = id;
      renderLayerList(dom('layerSearch')?.value || '');
      setStatus(`Zoom realizado a: ${layer.title}`);
    } else {
      setStatus(`No se pudo calcular la extensión de: ${layer.title}`);
    }
  } catch (error) {
    console.error('GeoAT zoom:', error);
    alert(`No fue posible hacer zoom a la capa.\n\n${error.message}`);
  }
}

async function deleteLocalLayer(id) {
  const layer = state.layers.find(x => x.id === id);
  if (!layer) return;
  if (!String(id).startsWith('local-')) {
    alert('Las capas del catálogo base no se pueden borrar desde este navegador.');
    return;
  }
  const ok = confirm(`¿Deseas borrar la capa "${layer.title}" de Geo AT en este navegador?\n\nEsta acción no borra un archivo de Google Drive.`);
  if (!ok) return;

  try {
    if (state.mapLayers.has(id)) {
      state.map.removeLayer(state.mapLayers.get(id));
      state.mapLayers.delete(id);
    }
    await clearLocalLayerRecord(id);
    state.metadata.delete(id);
    state.layers = state.layers.filter(x => x.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    dom('layerCount').textContent = state.layers.length;
    renderLayerList(dom('layerSearch')?.value || '');
    setStatus(`Capa borrada: ${layer.title}`);
  } catch (error) {
    console.error('GeoAT borrar:', error);
    alert(`No fue posible borrar la capa.\n\n${error.message}`);
  }
}

function linkHtml(url) {
  if (!url) return '—';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir enlace</a>`;
}

function showInfo(id) {
  const l = state.layers.find(x => x.id === id);
  if (!l) return;

  const cats = [...(l.categories || []), l.customCategory || '']
    .filter(Boolean)
    .map(c => `<span class="pill">${escapeHtml(c)}</span>`)
    .join('');

  const contact = l.contact || {};
  dom('infoTitle').textContent = l.title || 'Información';
  dom('infoBody').innerHTML = `<dl class="info-grid">
    <dt>Resumen</dt><dd>${escapeHtml(l.summary || '—')}</dd>
    <dt>Tipo</dt><dd>${escapeHtml(l.type || '—')}</dd>
    <dt>Idioma</dt><dd>${escapeHtml(l.language || '—')}</dd>
    <dt>Categorías</dt><dd>${cats || '—'}</dd>
    <dt>Licencias</dt><dd>${escapeHtml(l.license || '—')}</dd>
    <dt>Derechos</dt><dd>${escapeHtml(l.rights || '—')}</dd>
    <dt>Restricciones</dt><dd>${escapeHtml(l.restrictions || '—')}</dd>
    <dt>Extensión</dt><dd>${escapeHtml(l.extentText || 'Se detecta a partir del archivo al cargarlo.')}</dd>
    <dt>CRS</dt><dd>${escapeHtml(l.crs || 'No indicado')}</dd>
    <dt>Contacto</dt><dd>${escapeHtml([
      contact.name, contact.role, contact.organization, contact.phone,
      contact.email, contact.address, contact.city, contact.country
    ].filter(Boolean).join(' · ') || '—')}</dd>
    <dt>Enlace</dt><dd>${linkHtml(l.link)}</dd>
    <dt>Creación</dt><dd>${escapeHtml(l.history?.created || '—')}</dd>
    <dt>Revisión</dt><dd>${escapeHtml(l.history?.reviewed || '—')}</dd>
    <dt>Publicación</dt><dd>${escapeHtml(l.history?.published || '—')}</dd>
  </dl>`;
  dom('infoModal').classList.remove('hidden');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return String(s || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase() || 'archivo';
}

async function layerToBlob(layer) {
  if (layer.blob) return layer.blob;
  if (layer.data && layer.format === 'GeoJSON') {
    return new Blob([JSON.stringify(layer.data)], { type: 'application/geo+json' });
  }
  if (layer.source) {
    if (location.protocol === 'file:') {
      throw new Error('Para descargar esta capa desde file:// utiliza el servidor local Live Server.');
    }
    const r = await fetch(layer.source);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.blob();
  }
  throw new Error('No existe un archivo descargable para esta capa.');
}

function buildMetadata(layer) {
  return {
    titulo: layer.title,
    tipo: layer.type,
    idioma: layer.language,
    resumen: layer.summary,
    categorias: layer.categories,
    categoria_personalizada: layer.customCategory,
    licencias: layer.license,
    derechos: layer.rights,
    restricciones: layer.restrictions,
    extension: {
      modo: layer.extentMode,
      descripcion: layer.extentText,
      crs: layer.crs
    },
    contacto: layer.contact,
    enlace: layer.link,
    enlace_descripcion: layer.linkDescription,
    historial: layer.history,
    formato: layer.format,
    nombre_archivo: layer.fileName
  };
}

async function downloadLayer(id) {
  const l = state.layers.find(x => x.id === id);
  if (!l) return;
  try {
    const blob = await layerToBlob(l);
    downloadBlob(blob, l.fileName || `${slug(l.title)}.${(l.format || 'geojson').toLowerCase() === 'geotiff' ? 'tif' : 'geojson'}`);

    const mdBlob = new Blob([JSON.stringify(buildMetadata(l), null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(mdBlob, `${slug(l.title)}_metadatos.json`);
    setStatus(`Descargada: ${l.title} y sus metadatos.`);
  } catch (error) {
    console.error('GeoAT descarga:', error);
    alert(`No fue posible descargar la capa.\n\n${error.message}`);
  }
}

function openWizard() {
  state.currentStep = 1;
  state.layerFile = null;
  state.detected = null;
  const form = dom('metadataForm');
  form.reset();
  dom('fileName').textContent = 'Ningún archivo seleccionado';
  dom('finalFileSummary').textContent = 'Archivo seleccionado: —';
  dom('detectedExtentStep1').textContent = 'Todavía no se ha seleccionado un archivo.';
  dom('detectedExtent').textContent = 'Selecciona una capa en el Paso 1 para consultar la extensión detectada.';
  dom('customCRSWrap')?.classList.add('hidden');
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.querySelector('.step[data-step="1"]').classList.add('active');
  updateWizard();
  dom('modalBackdrop').classList.remove('hidden');
}

function closeWizard() {
  dom('modalBackdrop').classList.add('hidden');
}

function updateWizard() {
  dom('stepLabel').textContent = `Paso ${state.currentStep} de 8`;
  dom('progressBar').style.width = `${(state.currentStep / 8) * 100}%`;
  dom('btnPrev').disabled = state.currentStep === 1;
  dom('btnNext').classList.toggle('hidden', state.currentStep === 8);
  dom('btnSave').classList.toggle('hidden', state.currentStep !== 8);
}

function validateCurrentStep() {
  const step = document.querySelector(`.step[data-step="${state.currentStep}"]`);
  if (!step) return true;
  const required = [...step.querySelectorAll('[required]')];
  for (const el of required) {
    if (!el.value) {
      el.reportValidity?.();
      return false;
    }
  }
  return true;
}

function showWizardStep(step) {
  state.currentStep = Math.min(8, Math.max(1, step));
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('active', Number(s.dataset.step) === state.currentStep));
  if (state.currentStep === 5) refreshDetectedExtentBox();
  if (state.currentStep === 8 && state.layerFile) {
    dom('finalFileSummary').innerHTML = `<strong>Archivo:</strong> ${escapeHtml(state.layerFile.name)} · ${(state.layerFile.size / 1024 / 1024).toFixed(2)} MB`;
  }
  updateWizard();
}

function nextStep() {
  if (!validateCurrentStep()) return;
  if (state.currentStep === 1 && !state.layerFile) {
    alert('Selecciona el archivo geográfico antes de continuar.');
    return;
  }
  showWizardStep(state.currentStep + 1);
}

function prevStep() {
  showWizardStep(state.currentStep - 1);
}

function refreshDetectedExtentBox() {
  const source = dom('detectedExtentStep1');
  const target = dom('detectedExtent');
  if (source && target) target.innerHTML = source.innerHTML || source.textContent;
}

async function inspectSelectedFile() {
  const file = state.layerFile;
  if (!file) return;

  const sizeText = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  dom('fileName').textContent = `${file.name} · ${sizeText}`;
  dom('finalFileSummary').innerHTML = `<strong>Archivo:</strong> ${escapeHtml(file.name)} · ${sizeText}`;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'geojson' || ext === 'json') {
    try {
      const raw = JSON.parse(await file.text());
      const fc = raw.type === 'FeatureCollection'
        ? raw
        : { type: 'FeatureCollection', features: [raw] };

      const detected = detectCRSForGeoJSON(raw);
      state.detected = {
        crs: detected.code,
        confidence: detected.confidence,
        bbox: getCoordinateRange(raw),
        featureCount: fc.features.length,
        format: 'GeoJSON',
        raw
      };

      const detectedSelect = dom('sourceCRS');
      if (detectedSelect) {
        const option = [...detectedSelect.options].find(o => o.value === detected.code);
        detectedSelect.value = option ? detected.code : (detected.code ? 'CUSTOM' : 'AUTO');
      }

      const range = getCoordinateRange(raw);
      let message = `<strong>Detectado:</strong> GeoJSON · ${fc.features.length} entidad(es)`;
      if (detected.code) {
        message += ` · <strong>CRS:</strong> ${escapeHtml(crsLabel(detected.code))}`;
      } else {
        message += ` · <strong>CRS:</strong> no indicado`;
      }

      if (range) {
        message += `<br><strong>Coordenadas de origen:</strong> X ${range.minX.toFixed(3)} a ${range.maxX.toFixed(3)} · Y ${range.minY.toFixed(3)} a ${range.maxY.toFixed(3)}`;
      }

      if (detected.code) {
        try {
          const prepared = transformGeoJSONToWGS84(raw, detected.code);
          const preview = L.geoJSON(prepared.geojson);
          const bounds = preview.getBounds();
          if (bounds.isValid()) {
            message += `<br><strong>Ubicación WGS84:</strong> ${bounds.getSouth().toFixed(6)}, ${bounds.getWest().toFixed(6)} → ${bounds.getNorth().toFixed(6)}, ${bounds.getEast().toFixed(6)}`;
          }
        } catch (transformError) {
          message += `<br><strong>Advertencia:</strong> ${escapeHtml(transformError.message)}`;
        }
      } else if (!isGeographicRange(range)) {
        message += `<br><strong>Advertencia:</strong> los valores parecen coordenadas proyectadas. Selecciona GTM, UTM u otro CRS antes de continuar.`;
      } else {
        message += `<br><strong>Interpretación:</strong> las coordenadas están dentro del rango geográfico de WGS84.`;
      }

      dom('detectedExtentStep1').innerHTML = message;
      refreshDetectedExtentBox();
    } catch (e) {
      dom('detectedExtentStep1').textContent = 'El archivo no parece ser un GeoJSON válido.';
      state.detected = null;
    }
  } else if (ext === 'tif' || ext === 'tiff') {
    dom('detectedExtentStep1').innerHTML =
      '<strong>Detectado:</strong> GeoTIFF. El raster conserva su CRS en el archivo y la librería GeoRaster intentará leerlo y representarlo en Leaflet. Para CRS no estándar, se recomienda revisar el GeoTIFF en QGIS.';
    state.detected = { format: 'GeoTIFF', crs: 'Detectado por GeoRaster', bbox: null };
    refreshDetectedExtentBox();
  } else {
    dom('detectedExtentStep1').textContent =
      'Formato no soportado en esta versión. Usa GeoJSON o GeoTIFF.';
    state.detected = null;
  }
}
async function submitWizard(e) {
  e.preventDefault();
  if (!validateCurrentStep()) return;
  if (!state.layerFile) {
    alert('Selecciona el archivo geográfico en el Paso 1.');
    showWizardStep(1);
    return;
  }

  const fd = new FormData(e.target);
  const ext = state.layerFile.name.split('.').pop().toLowerCase();
  if (!['geojson', 'json', 'tif', 'tiff'].includes(ext)) {
    alert('Usa GeoJSON o GeoTIFF en esta versión.');
    showWizardStep(1);
    return;
  }

  let preparedData = null;
  let sourceCRS = state.detected?.crs || 'EPSG:4326';
  let detectedExtent = 'Detectada a partir de la capa';

  if (ext === 'geojson' || ext === 'json') {
    let raw = state.detected?.raw;
    if (!raw) raw = JSON.parse(await state.layerFile.text());

    const selectedCRS = fd.get('sourceCRS') || 'AUTO';
    if (selectedCRS === 'CUSTOM') {
      const custom = String(fd.get('customCRS') || '').trim();
      if (!custom) {
        alert('Seleccionaste \"Otro CRS\". Escribe un EPSG (por ejemplo EPSG:xxxxx) o una definición PROJ.4.');
        showWizardStep(1);
        return;
      }
      sourceCRS = custom;
    } else if (selectedCRS === 'AUTO') {
      sourceCRS = extractCRSFromGeoJSON(raw) || (isGeographicRange(getCoordinateRange(raw)) ? 'EPSG:4326' : '');
    } else {
      sourceCRS = selectedCRS;
    }

    if (!sourceCRS) {
      alert(
        'La capa tiene coordenadas proyectadas, pero no fue posible identificar su CRS.\\n\\n' +
        'Selecciona el sistema de coordenadas correcto en el Paso 1, por ejemplo:\\n' +
        '• GTM — ESRI:103598\\n' +
        '• WGS 84 — EPSG:4326\\n' +
        '• UTM 15N — EPSG:32615\\n' +
        '• UTM 16N — EPSG:32616'
      );
      showWizardStep(1);
      return;
    }

    try {
      const result = transformGeoJSONToWGS84(raw, sourceCRS);
      preparedData = result.geojson;
      sourceCRS = result.sourceCRS;

      const preview = L.geoJSON(preparedData);
      const bounds = preview.getBounds();
      if (bounds.isValid()) {
        detectedExtent =
          `Sur ${bounds.getSouth().toFixed(6)}, Oeste ${bounds.getWest().toFixed(6)}, ` +
          `Norte ${bounds.getNorth().toFixed(6)}, Este ${bounds.getEast().toFixed(6)}`;
      }
    } catch (error) {
      alert(`No fue posible transformar la capa desde ${sourceCRS}.\\n\\n${error.message}`);
      showWizardStep(1);
      return;
    }
  }

  const id = `local-${Date.now()}`;
  const layer = {
    id,
    title: fd.get('title'),
    summary: fd.get('summary'),
    type: fd.get('type'),
    language: fd.get('language'),
    categories: fd.getAll('category'),
    customCategory: fd.get('customCategory'),
    license: fd.get('license'),
    rights: fd.get('rights'),
    restrictions: fd.get('restrictions'),
    extentMode: fd.get('extentMode'),
    extentText: detectedExtent,
    crs: sourceCRS || state.detected?.crs || 'No indicado',
    contact: {
      name: fd.get('contactName'),
      phone: fd.get('phone'),
      email: fd.get('email'),
      role: fd.get('role'),
      organization: fd.get('organization'),
      address: fd.get('address'),
      city: fd.get('city'),
      country: fd.get('country'),
      website: fd.get('website')
    },
    link: fd.get('link'),
    linkDescription: fd.get('linkDescription'),
    history: {
      created: fd.get('created'),
      reviewed: fd.get('reviewed'),
      published: fd.get('published')
    },
    format: ['tif', 'tiff'].includes(ext) ? 'GeoTIFF' : 'GeoJSON',
    fileName: state.layerFile.name,
    blob: state.layerFile
  };

  // Para vectores guardamos una copia transformada a WGS84 para que Leaflet
  // no vuelva a interpretar los metros GTM/UTM como grados.
  if (preparedData) {
    layer.data = preparedData;
  }

  try {
    await saveLocalLayer(layer);
  } catch (error) {
    console.warn('GeoAT almacenamiento local:', error.message);
  }

  state.layers.push(layer);
  state.metadata.set(id, layer);
  dom('layerCount').textContent = state.layers.length;
  renderLayerList();
  closeWizard();
  setStatus(`Nueva capa agregada: ${layer.title}`);
  await toggleLayer(id);
}
function stopMeasurement() {
  if (state.measureHandler) {
    state.map.off('click', state.measureHandler.click);
    state.map.off('dblclick', state.measureHandler.dbl);
  }
  state.measureHandler = null;
  state.measureStart = null;
  state.measureMode = null;
}

function startMeasure(mode) {
  stopMeasurement();
  state.measureMode = mode;
  state.measureStart = null;
  if (!state.measureGroup) state.measureGroup = L.featureGroup().addTo(state.map);
  state.measureGroup.clearLayers();

  if (mode === 'distance') {
    setStatus('Haz clic en dos puntos para medir la distancia.');
    const click = e => {
      if (!state.measureStart) {
        state.measureStart = e.latlng;
        L.circleMarker(e.latlng, { radius: 5 }).addTo(state.measureGroup);
        setStatus('Primer punto seleccionado. Haz clic en el segundo punto.');
        return;
      }
      const end = e.latlng;
      L.polyline([state.measureStart, end], { color: '#d97706', weight: 4 }).addTo(state.measureGroup);
      L.circleMarker(end, { radius: 5 }).addTo(state.measureGroup);
      const meters = state.map.distance(state.measureStart, end);
      setStatus(`Distancia: ${(meters / 1000).toFixed(3)} km (${meters.toFixed(1)} m).`);
      state.map.off('click', click);
      state.measureHandler = null;
    };
    state.measureHandler = { click, dbl: null };
    state.map.on('click', click);
  } else {
    const points = [];
    setStatus('Haz clic para marcar los vértices y doble clic para terminar el polígono.');

    const click = e => {
      points.push(e.latlng);
      if (points.length > 1) {
        L.polyline(points, { color: '#7c3aed', weight: 3 }).addTo(state.measureGroup);
      }
    };

    const dbl = e => {
      L.DomEvent.stop(e);
      if (points.length < 2) return;
      points.push(e.latlng);
      const poly = L.polygon(points, { color: '#7c3aed', fillOpacity: 0.12 }).addTo(state.measureGroup);
      const area = areaInSquareMeters(points);
      setStatus(`Área: ${(area / 10000).toFixed(3)} ha (${area.toFixed(1)} m²).`);
      state.map.off('click', click);
      state.map.off('dblclick', dbl);
      state.measureHandler = null;
      void poly;
    };

    state.measureHandler = { click, dbl };
    state.map.on('click', click);
    state.map.on('dblclick', dbl);
  }
}

function areaInSquareMeters(points) {
  if (points.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const p1 = points[j];
    const p2 = points[i];
    area += (p2.lng - p1.lng) * Math.PI / 180 * (
      2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180)
    );
  }
  return Math.abs(area * R * R / 2);
}

function clearDrawings() {
  stopMeasurement();
  state.editable?.clearLayers();
  state.measureGroup?.clearLayers();
  setStatus('Dibujos y mediciones limpiados.');
}

function setupEvents() {
  bind('btnAddLayer', 'click', openWizard);
  bind('btnCloseModal', 'click', closeWizard);
  bind('btnNext', 'click', nextStep);
  bind('btnPrev', 'click', prevStep);
  bind('metadataForm', 'submit', submitWizard);
  bind('layerSearch', 'input', e => renderLayerList(e.target.value));
  bind('sourceCRS', 'change', e => {
    const wrap = dom('customCRSWrap');
    if (wrap) wrap.classList.toggle('hidden', e.target.value !== 'CUSTOM');
  });
  bind('customCRS', 'input', () => {
    // El valor se toma al guardar; este evento solo evita la necesidad
    // de recargar el paso cuando el usuario escribe un CRS personalizado.
  });

  bind('layerFile', 'change', async e => {
    state.layerFile = e.target.files?.[0] || null;
    if (!state.layerFile) {
      dom('fileName').textContent = 'Ningún archivo seleccionado';
      dom('detectedExtentStep1').textContent = 'Todavía no se ha seleccionado un archivo.';
      dom('finalFileSummary').textContent = 'Archivo seleccionado: —';
      state.detected = null;
      return;
    }
    await inspectSelectedFile();
    refreshDetectedExtentBox();
  });
  bind('btnHelp', 'click', () => alert(
    'Geo AT\n\n' +
    '1) Usa Mapa para visualizar una capa.\n' +
    '2) Usa Info para ver los metadatos.\n' +
    '3) Descargar obtiene la capa y un JSON con sus metadatos.\n' +
    '4) Agregar capa abre el asistente de 8 pasos.\n' +
    '5) El Paso 1 es Cargar capa; luego se completan sus metadatos.\n' +
    '6) Las capas subidas localmente se guardan en este navegador.\n\n' +
    'La integración con backend Java, Google Drive y Google Sheets se incorporará sobre esta misma estructura.'
  ));
  bind('btnLocateDefault', 'click', () => state.map?.setView([14.8105, -89.5345], 13));
  bind('btnToggleLabels', 'click', () => {
    if (state.map?.hasLayer(state.streets)) setStatus('Las etiquetas y carreteras están incluidas en el mapa de calles.');
    else setStatus('Cambia a "Calles" en el selector de mapas para volver a ver carreteras y etiquetas.');
  });
  bind('btnMeasureDistance', 'click', () => startMeasure('distance'));
  bind('btnMeasureArea', 'click', () => startMeasure('area'));
  bind('btnClearDraw', 'click', clearDrawings);

  document.addEventListener('click', async e => {
    const target = e.target.closest('[data-action]');
    const action = target?.dataset.action;
    const id = target?.dataset.id;
    if (!action || !id) return;
    if (action === 'view') await toggleLayer(id);
    if (action === 'zoom') await zoomToLayer(id);
    if (action === 'info') showInfo(id);
    if (action === 'download') await downloadLayer(id);
    if (action === 'delete') await deleteLocalLayer(id);
  });

  document.querySelectorAll('[data-close-info]').forEach(b => {
    b.addEventListener('click', () => dom('infoModal')?.classList.add('hidden'));
  });

  bind('modalBackdrop', 'click', e => {
    if (e.target === dom('modalBackdrop')) closeWizard();
  });
  bind('infoModal', 'click', e => {
    if (e.target === dom('infoModal')) dom('infoModal')?.classList.add('hidden');
  });
}

async function boot() {
  initCategories();
  initMap();
  setupEvents();
  try {
    state.db = await openDB();
  } catch (error) {
    console.warn('GeoAT IndexedDB:', error.message);
    state.db = null;
  }
  await loadCatalog();
}

boot().catch(error => {
  console.error('GeoAT inicio:', error);
  setStatus(`Error al iniciar GeoAT: ${error.message}`);
});

window.addEventListener('load', () => {
  setTimeout(() => state.map?.invalidateSize(true), 50);
});
window.addEventListener('resize', () => state.map?.invalidateSize(false));
