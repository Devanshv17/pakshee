/**
 * Pakshee — MapLibre GL JS Visualization Engine
 * Interactive cartography with station acoustic markers and district bias layers.
 */

window.pakshee = window.pakshee || {};

(function () {
  'use strict';

  let map;
  let stationsData = null;
  let districtsData = null;
  let isBiasLayerVisible = false;

  const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const STATIONS_PATHS = ['../data/processed/stations.geojson', 'data/processed/stations.geojson', '/pakshee/data/processed/stations.geojson'];
  const DISTRICTS_PATHS = ['../data/processed/districts.geojson', 'data/processed/districts.geojson', '/pakshee/data/processed/districts.geojson'];

  async function fetchWithFallback(paths) {
    for (const p of paths) {
      try {
        const resp = await fetch(p);
        if (resp.ok) return await resp.json();
      } catch (err) {
        // try next path
      }
    }
    return null;
  }

  /**
   * Initialize MapLibre GL map centered on the Indian Subcontinent
   */
  function initMap(onStationSelect, onDistrictSelect) {
    map = new maplibregl.Map({
      container: 'map',
      style: DARK_STYLE,
      center: [78.9629, 21.5000],
      zoom: 4.6,
      minZoom: 3.5,
      maxZoom: 14,
      pitch: 20,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', async () => {
      console.log('[Pakshee Map] Map loaded. Adding spatial data sources...');
      await loadDataSources();
      setupLayerInteractions(onStationSelect, onDistrictSelect);
    });

    return map;
  }

  /**
   * Load GeoJSON layers for stations and districts
   */
  async function loadDataSources() {
    // 1. Load Districts (Bias Layer)
    districtsData = await fetchWithFallback(DISTRICTS_PATHS);
    if (districtsData) {
      map.addSource('districts-source', {
        type: 'geojson',
        data: districtsData
      });

        // District Fill Layer (Silent Zones vs Monitored)
        map.addLayer({
          id: 'districts-fill',
          type: 'fill',
          source: 'districts-source',
          layout: {
            visibility: 'none'
          },
          paint: {
            'fill-color': [
              'match',
              ['get', 'bias_category'],
              'Critical Silent Zone', '#e74c3c',
              'Silent Zone', '#d35400',
              'Sparse Monitoring', '#34495e',
              'Well Monitored', '#27ae60',
              '#1e272e'
            ],
            'fill-opacity': [
              'match',
              ['get', 'bias_category'],
              'Critical Silent Zone', 0.28,
              'Silent Zone', 0.18,
              0.06
            ]
          }
        });

        // District Outline Layer
        map.addLayer({
          id: 'districts-line',
          type: 'line',
          source: 'districts-source',
          layout: {
            visibility: 'none'
          },
          paint: {
            'line-color': 'rgba(255, 255, 255, 0.1)',
            'line-width': 0.8
          }
        });
      }
    }

    // 2. Load Air Quality Stations
    stationsData = await fetchWithFallback(STATIONS_PATHS);
    if (!stationsData) {
      stationsData = { type: 'FeatureCollection', features: [] };
    }

    map.addSource('stations-source', {
      type: 'geojson',
      data: stationsData
    });

    // Outer Glow / Blur Ring
    map.addLayer({
      id: 'stations-glow',
      type: 'circle',
      source: 'stations-source',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['coalesce', ['get', 'pm25'], 30],
          0, 8,
          60, 14,
          120, 22,
          250, 32,
          500, 45
        ],
        'circle-color': [
          'case',
          ['boolean', ['get', 'stale'], false],
          '#7f8c8d',
          ['coalesce', ['get', 'aqiColor'], '#2ecc71']
        ],
        'circle-opacity': 0.28,
        'circle-blur': 0.85
      }
    });

    // Core Solid Marker
    map.addLayer({
      id: 'stations-point',
      type: 'circle',
      source: 'stations-source',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['coalesce', ['get', 'pm25'], 30],
          0, 4,
          60, 6,
          120, 9,
          250, 13,
          500, 18
        ],
        'circle-color': [
          'case',
          ['boolean', ['get', 'stale'], false],
          '#95a5a6',
          ['coalesce', ['get', 'aqiColor'], '#2ecc71']
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.7
      }
    });
  }

  /**
   * Set up hover and click triggers
   */
  function setupLayerInteractions(onStationSelect, onDistrictSelect) {
    // Station interactions
    map.on('click', 'stations-point', (e) => {
      if (!e.features || !e.features.length) return;
      const feat = e.features[0];
      if (onStationSelect) {
        onStationSelect(feat.properties, feat.geometry.coordinates);
      }
    });

    map.on('mouseenter', 'stations-point', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'stations-point', () => {
      map.getCanvas().style.cursor = '';
    });

    // District / Bias Layer interactions
    map.on('click', 'districts-fill', (e) => {
      if (!isBiasLayerVisible || !e.features || !e.features.length) return;
      const feat = e.features[0];
      if (onDistrictSelect) {
        onDistrictSelect(feat.properties);
      }
    });
  }

  /**
   * Toggle visibility of the Monitoring Bias Layer
   */
  function toggleBiasLayer(forceState) {
    if (!map.getLayer('districts-fill')) return isBiasLayerVisible;

    isBiasLayerVisible = (forceState !== undefined) ? forceState : !isBiasLayerVisible;
    const visibilityVal = isBiasLayerVisible ? 'visible' : 'none';

    map.setLayoutProperty('districts-fill', 'visibility', visibilityVal);
    map.setLayoutProperty('districts-line', 'visibility', visibilityVal);

    return isBiasLayerVisible;
  }

  /**
   * Smooth camera flyTo transition
   */
  function flyTo(coordinates, zoom = 9) {
    map.flyTo({
      center: coordinates,
      zoom: zoom,
      speed: 0.8,
      curve: 1.4,
      essential: true
    });
  }

  /**
   * Find first station matching a city name and fly to it
   */
  function findStationByCity(cityName) {
    if (!stationsData || !stationsData.features) return null;
    return stationsData.features.find(f => {
      const city = f.properties.city || '';
      const name = f.properties.name || '';
      return city.toLowerCase().includes(cityName.toLowerCase()) ||
             name.toLowerCase().includes(cityName.toLowerCase());
    });
  }

  window.pakshee.map = {
    init: initMap,
    flyTo: flyTo,
    toggleBiasLayer: toggleBiasLayer,
    findStationByCity: findStationByCity,
    getStations: () => stationsData,
    getDistricts: () => districtsData
  };

})();
