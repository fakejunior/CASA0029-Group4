const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/dark-v11',
      ...views.level1,
      antialias: true
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.scrollZoom.disable();
    map.dragPan.enable();
    map.dragRotate.enable();
    map.doubleClickZoom.enable();

    let activeStage = 'level1';
    let currentHour = 22;
    let currentL3Hour = 22;
    let currentMetric = 'total';
    let sourceVisible = true;
    let sourceLinesVisible = true;
    let topLevel1Feature = null;
    let isRotating = true;
    let userInteracting = false;
    let currentBearing = views.level1.bearing;
    let maxNoise = 30;
    let level2RawData = null;
    let level3Summary = null;
    let level4Summary = null;
    let level5Data = null;
    let level5Summary = null;
    let level6RiskData = null;
    let level6Graph = null;
    let level6Selected = { start: null, end: null };
    let level6Result = null;
    let level6Focus = 'compare';
    let level6RiskVisible = true;
    let level6AnimationFrame = null;
    let activeLevel5Geoid = null;
    let level5Mode = 'burden';
    let showPriorityOnly = false;
    let activeClusterId = null;
    let activeDayType = 'All days';
    let l2FocusCategory = 'Residential Music / Party';
    let useShapeMode = true;
    let l2PlayTimer = null;
    let l3PlayTimer = null;
    let l2HourMarker = null;
    let l2XScale = null;

    const loading = document.getElementById('loading');
    const tooltip = document.getElementById('tooltip');
    const navDots = document.querySelectorAll('.nav-dot');

    setTimeout(() => {
      if (loading && !loading.classList.contains('hidden')) loading.classList.add('hidden');
    }, 4500);

    function compactNumber(v) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0); }
    function hourLabel(h) { const suffix = h < 12 ? 'AM' : 'PM'; const hour12 = h % 12 === 0 ? 12 : h % 12; return `${hour12}${suffix}`; }
    function hourProp(h) { return `h${String(h).padStart(2, '0')}`; }
    function metricProp(metric, hour) { return metric === 'total' ? hourProp(hour) : `${metric}_${hourProp(hour)}`; }
    function getNoise(props) { return Number(props?.noise_count || props?.Noise_Count || props?.NOISE_COUNT || 0); }

    function setLayerVisibility(ids, visible) {
      ids.forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      });
    }

    function setPanel(id, count, source) {
      document.getElementById('panel-id').textContent = id || '--';
      document.getElementById('panel-count').textContent = compactNumber(count || 0);
      document.getElementById('panel-source').textContent = source || '--';
      document.getElementById('risk-fill').style.width = `${Math.min(100, Math.round((Number(count || 0) / Math.max(1, maxNoise)) * 100))}%`;
      const wrap = document.getElementById('panelRadarWrap');
      if (wrap) wrap.style.display = 'none';
      const title = document.getElementById('panel-title');
      if (title) title.textContent = 'Sound Object';
      document.getElementById('sidePanel').classList.add('active');
    }
    function closePanel() { document.getElementById('sidePanel').classList.remove('active'); }
    window.closePanel = closePanel;

    function showTooltip(point, html) {
      tooltip.innerHTML = html;
      tooltip.style.left = `${point.x + 18}px`;
      tooltip.style.top = `${point.y + 16}px`;
      tooltip.classList.add('visible');
    }
    function hideTooltip() { tooltip.classList.remove('visible'); }

    function polygonCentroid(feature) {
      const geom = feature.geometry;
      if (!geom) return null;
      let coords = [];
      if (geom.type === 'Polygon') coords = geom.coordinates?.[0] || [];
      if (geom.type === 'MultiPolygon') coords = geom.coordinates?.[0]?.[0] || [];
      if (!coords.length) return null;
      let x = 0, y = 0;
      coords.forEach(c => { x += c[0]; y += c[1]; });
      return [x / coords.length, y / coords.length];
    }

    function buildHotspotPoints(geojson) {
      const features = (geojson.features || [])
        .filter(f => getNoise(f.properties) >= 5)
        .sort((a, b) => getNoise(b.properties) - getNoise(a.properties))
        .slice(0, 260)
        .map(f => {
          const center = polygonCentroid(f);
          if (!center) return null;
          return { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: { bin: f.properties?.bin || 'N/A', noise_count: getNoise(f.properties) } };
        }).filter(Boolean);
      return { type: 'FeatureCollection', features };
    }

    async function fetchJSON(url, required = true) {
      const res = await fetch(url);
      if (!res.ok) {
        if (required) throw new Error(`Cannot load ${url}. Run through a local server and check file name.`);
        return { type: 'FeatureCollection', features: [] };
      }
      return res.json();
    }

    function updateLevel1Stats(geojson) {
      const features = geojson.features || [];
      const noises = features.map(f => getNoise(f.properties));
      const totalNoise = noises.reduce((a, b) => a + b, 0);
      maxNoise = Math.max(30, ...noises);
      document.getElementById('stat-buildings').textContent = compactNumber(features.length);
      document.getElementById('stat-noise').textContent = compactNumber(totalNoise);
      document.getElementById('stat-max').textContent = Math.round(maxNoise);
    }

    function addLevel1Layers(geojson) {
      updateLevel1Stats(geojson);
      topLevel1Feature = [...(geojson.features || [])].sort((a, b) => getNoise(b.properties) - getNoise(a.properties))[0] || null;
      map.addSource('buildings-data', { type: 'geojson', data: geojson, promoteId: 'bin' });
      map.addSource('hotspots-data', { type: 'geojson', data: buildHotspotPoints(geojson) });

      map.addLayer({ id: 'buildings-main', source: 'buildings-data', type: 'fill-extrusion', paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], noiseValue, 0, '#66dcff', 1, '#35c8ff', 3, '#00f2ff', 8, '#8b5cff', 15, '#ff3f9f', 25, '#ff8c1a', 40, '#fff37a', 70, '#ffffff'],
        'fill-extrusion-height': extrusionHeight,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false
      }});
      try { map.setPaintProperty('buildings-main', 'fill-extrusion-emissive-strength', .9); } catch(e) {}

      map.addLayer({ id: 'building-roof-outline', source: 'buildings-data', type: 'line', paint: {
        'line-color': ['interpolate', ['linear'], noiseValue, 0, 'rgba(165,235,255,.95)', 5, 'rgba(0,242,255,1)', 15, 'rgba(255,210,245,1)', 40, 'rgba(255,255,210,1)'],
        'line-width': ['interpolate', ['linear'], noiseValue, 0, 1.15, 20, 1.8, 60, 2.6],
        'line-opacity': .94
      }});

      map.addLayer({ id: 'building-hover-glow', source: 'buildings-data', type: 'fill-extrusion', filter: ['==', ['get', 'bin'], ''], paint: {
        'fill-extrusion-color': '#ffffff', 'fill-extrusion-height': ['+', extrusionHeight, 8], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': .45
      }});
      map.addLayer({ id: 'building-hover-top', source: 'buildings-data', type: 'line', filter: ['==', ['get', 'bin'], ''], paint: { 'line-color': '#ffffff', 'line-width': 2.4, 'line-opacity': .9 } });

      map.addLayer({ id: 'hotspot-halo', source: 'hotspots-data', type: 'circle', paint: {
        'circle-color': ['interpolate', ['linear'], ['to-number', ['get', 'noise_count']], 5, '#00f2ff', 15, '#ff3f9f', 30, '#ff8c1a', 70, '#fff37a'],
        'circle-radius': ['interpolate', ['linear'], ['to-number', ['get', 'noise_count']], 5, 7, 20, 18, 70, 36],
        'circle-opacity': ['interpolate', ['linear'], ['to-number', ['get', 'noise_count']], 5, .10, 20, .18, 70, .28],
        'circle-blur': .82,
        'circle-pitch-scale': 'map'
      }});
      map.addLayer({ id: 'hotspot-core', source: 'hotspots-data', type: 'circle', paint: {
        'circle-color': ['interpolate', ['linear'], ['to-number', ['get', 'noise_count']], 5, '#00f2ff', 15, '#ff3f9f', 30, '#ff8c1a', 70, '#fff37a'],
        'circle-radius': ['interpolate', ['linear'], ['to-number', ['get', 'noise_count']], 5, 2, 20, 3.8, 70, 6.4],
        'circle-opacity': .94,
        'circle-blur': .04,
        'circle-pitch-scale': 'map'
      }});

      map.on('mousemove', 'buildings-main', e => {
        if (activeStage !== 'level1' || !e.features.length) return;
        const f = e.features[0];
        map.getCanvas().style.cursor = 'crosshair';
        map.setFilter('building-hover-glow', ['==', ['get', 'bin'], f.properties?.bin || '']);
        map.setFilter('building-hover-top', ['==', ['get', 'bin'], f.properties?.bin || '']);
        showTooltip(e.point, `<div class="tooltip-title">Building Noise</div><div class="tooltip-row"><span>BIN</span><strong>${f.properties?.bin || 'N/A'}</strong></div><div class="tooltip-row"><span>Complaints</span><strong>${getNoise(f.properties)}</strong></div>`);
      });
      map.on('mouseleave', 'buildings-main', () => {
        map.getCanvas().style.cursor = '';
        hideTooltip();
        if (map.getLayer('building-hover-glow')) map.setFilter('building-hover-glow', ['==', ['get', 'bin'], '']);
        if (map.getLayer('building-hover-top')) map.setFilter('building-hover-top', ['==', ['get', 'bin'], '']);
      });
      map.on('click', 'buildings-main', e => {
        if (activeStage !== 'level1' || !e.features.length) return;
        const p = e.features[0].properties;
        setPanel(`BIN ${p.bin || 'N/A'}`, getNoise(p), 'Accumulated building noise');
      });
    }

    function addLevel2MapLayer(geojson) {
      map.addSource('buildings-hourly', { type: 'geojson', data: geojson });
      map.addLayer({ id: 'buildings-hourly-stage2', source: 'buildings-hourly', type: 'fill-extrusion', layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': '#00eaff',
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': .94,
        'fill-extrusion-vertical-gradient': false
      }});
      try { map.setPaintProperty('buildings-hourly-stage2', 'fill-extrusion-emissive-strength', .95); } catch(e) {}
      applyLevel2Hour(currentHour);
    }

    function applyLevel2Hour(hour) {
      if (!map.getLayer('buildings-hourly-stage2')) return;
      const prop = hourProp(hour);
      const val = ['coalesce', ['to-number', ['get', prop]], 0];
      map.setPaintProperty('buildings-hourly-stage2', 'fill-extrusion-height', ['interpolate', ['linear'], val, 0, 0, 1, 14, 3, 38, 6, 75, 10, 120, 20, 185]);
      map.setPaintProperty('buildings-hourly-stage2', 'fill-extrusion-color', ['interpolate', ['linear'], val, 0, '#172033', 1, '#35c8ff', 3, '#00f2ff', 6, '#8b5cff', 10, '#ff3f9f', 15, '#ff8c1a', 20, '#fff37a']);
    }

    function addLevel3Layers(h3Geojson, sourceGeojson, lineGeojson) {
      map.addSource('h3-hourly', { type: 'geojson', data: h3Geojson });
      map.addSource('l3-sources', { type: 'geojson', data: sourceGeojson });
      map.addSource('l3-lines', { type: 'geojson', data: lineGeojson || { type: 'FeatureCollection', features: [] } });

      map.addLayer({ id: 'h3-hex-extrusion', source: 'h3-hourly', type: 'fill-extrusion', layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': '#00eaff',
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': .76,
        'fill-extrusion-vertical-gradient': false
      }});
      try { map.setPaintProperty('h3-hex-extrusion', 'fill-extrusion-emissive-strength', .88); } catch(e) {}

      map.addLayer({ id: 'h3-hex-outline', source: 'h3-hourly', type: 'line', layout: { visibility: 'none' }, paint: {
        'line-color': 'rgba(190,245,255,.68)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, .35, 15, 1.0],
        'line-opacity': .55
      }});

      map.addLayer({ id: 'l3-source-line-glow', source: 'l3-lines', type: 'line', layout: { visibility: 'none' }, paint: { 'line-color': '#47ffb3', 'line-width': 7, 'line-opacity': .13, 'line-blur': 4 } });
      map.addLayer({ id: 'l3-source-lines', source: 'l3-lines', type: 'line', layout: { visibility: 'none' }, paint: { 'line-color': '#47ffb3', 'line-width': 2, 'line-opacity': .70 } });

      const colorMatch = ['match', ['get', 'source_group'], 'residential', sourceColors.residential, 'nightlife', sourceColors.nightlife, 'street', sourceColors.street, 'transit', sourceColors.transit, 'construction', sourceColors.construction, 'mechanical', sourceColors.mechanical, sourceColors.other];

      map.addLayer({ id: 'l3-source-halo', source: 'l3-sources', type: 'circle', layout: { visibility: 'none' }, paint: {
        'circle-color': colorMatch,
        'circle-radius': 0,
        'circle-opacity': .20,
        'circle-blur': .75,
        'circle-pitch-scale': 'map'
      }});
      map.addLayer({ id: 'l3-source-core', source: 'l3-sources', type: 'circle', layout: { visibility: 'none' }, paint: {
        'circle-color': colorMatch,
        'circle-radius': 0,
        'circle-opacity': .92,
        'circle-stroke-color': 'rgba(255,255,255,.70)',
        'circle-stroke-width': .8,
        'circle-pitch-scale': 'map'
      }});
      map.addLayer({ id: 'l3-source-labels', source: 'l3-sources', type: 'symbol', layout: { visibility: 'none', 'text-field': ['get', 'source_label'], 'text-size': 10, 'text-offset': [0, 1.35], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': 'rgba(255,255,255,.84)', 'text-halo-color': 'rgba(0,0,0,.75)', 'text-halo-width': 1.2 } });

      map.on('mousemove', 'h3-hex-extrusion', e => {
        if (activeStage !== 'level3' || !e.features.length) return;
        const p = e.features[0].properties;
        const prop = metricProp(currentMetric, currentL3Hour);
        const top = p[`top_${hourProp(currentL3Hour)}`] || 'none';
        showTooltip(e.point, `<div class="tooltip-title">H3 Cell / ${hourLabel(currentL3Hour)}</div><div class="tooltip-row"><span>Metric</span><strong>${currentMetric}</strong></div><div class="tooltip-row"><span>Count</span><strong>${compactNumber(Number(p[prop] || 0))}</strong></div><div class="tooltip-row"><span>Top source</span><strong>${sourceLabels[top] || top}</strong></div>`);
      });
      map.on('mouseleave', 'h3-hex-extrusion', hideTooltip);
      map.on('click', 'h3-hex-extrusion', e => {
        if (activeStage !== 'level3' || !e.features.length) return;
        const p = e.features[0].properties;
        const prop = metricProp(currentMetric, currentL3Hour);
        const top = p[`top_${hourProp(currentL3Hour)}`] || 'none';
        setPanel(p.h3, Number(p[prop] || 0), sourceLabels[top] || top);
      });

      map.on('mousemove', 'l3-source-core', e => {
        if (activeStage !== 'level3' || !e.features.length) return;
        const p = e.features[0].properties;
        const prop = hourProp(currentL3Hour);
        showTooltip(e.point, `<div class="tooltip-title">Noise Source Cluster</div><div class="tooltip-row"><span>Type</span><strong>${p.source_label}</strong></div><div class="tooltip-row"><span>${hourLabel(currentL3Hour)}</span><strong>${compactNumber(Number(p[prop] || 0))}</strong></div><div class="tooltip-row"><span>Top detail</span><strong>${p.top_detail || '--'}</strong></div>`);
      });
      map.on('mouseleave', 'l3-source-core', hideTooltip);
      map.on('click', 'l3-source-core', e => {
        if (activeStage !== 'level3' || !e.features.length) return;
        const p = e.features[0].properties;
        setPanel(p.source_label, Number(p[hourProp(currentL3Hour)] || 0), p.top_detail || p.top_category || '--');
      });

      applyLevel3Hour(currentL3Hour);
    }

    function addRealSourceLayers(busRoutesGeojson, subwayStationsGeojson, nightlifeGeojson) {
      const empty = { type: 'FeatureCollection', features: [] };
      map.addSource('real-bus-routes', { type: 'geojson', data: busRoutesGeojson || empty });
      map.addSource('real-subway-stations', { type: 'geojson', data: subwayStationsGeojson || empty });
      map.addSource('real-nightlife-poi', { type: 'geojson', data: nightlifeGeojson || empty });

      map.addLayer({
        id: 'real-bus-routes-glow',
        source: 'real-bus-routes',
        type: 'line',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#47ffb3',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.4, 14, 5.5, 16, 8],
          'line-opacity': .12,
          'line-blur': 4
        }
      });
      map.addLayer({
        id: 'real-bus-routes',
        source: 'real-bus-routes',
        type: 'line',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'route_color_hex'], '#47ffb3'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, .55, 14, 1.4, 16, 2.4],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, .22, 14, .58, 16, .78]
        }
      });

      const nightlifeColor = ['match', ['get', 'poi_group'],
        'nightclub', '#ff2d6f',
        'bar', '#ff5d91',
        'pub', '#ff8ab0',
        'restaurant_bar', '#ffc1d1',
        '#ff5d91'
      ];

      map.addLayer({
        id: 'real-nightlife-halo',
        source: 'real-nightlife-poi',
        type: 'circle',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': nightlifeColor,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 7, 16, 14],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, .06, 14, .18, 16, .26],
          'circle-blur': .72,
          'circle-pitch-scale': 'map'
        }
      });
      map.addLayer({
        id: 'real-nightlife-core',
        source: 'real-nightlife-poi',
        type: 'circle',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': nightlifeColor,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.0, 14, 2.9, 16, 4.8],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, .32, 14, .82, 16, .95],
          'circle-stroke-color': 'rgba(255,255,255,.62)',
          'circle-stroke-width': .55,
          'circle-pitch-scale': 'map'
        }
      });
      map.addLayer({
        id: 'real-nightlife-labels',
        source: 'real-nightlife-poi',
        type: 'symbol',
        minzoom: 15.2,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'venue_name'],
          'text-size': 10,
          'text-offset': [0, 1.25],
          'text-anchor': 'top',
          'text-allow-overlap': false
        },
        paint: {
          'text-color': 'rgba(255,255,255,.88)',
          'text-halo-color': 'rgba(0,0,0,.78)',
          'text-halo-width': 1.2
        }
      });

      map.addLayer({
        id: 'real-subway-halo',
        source: 'real-subway-stations',
        type: 'circle',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#7df9ff',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 8, 16, 13],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, .08, 14, .18, 16, .25],
          'circle-blur': .68,
          'circle-pitch-scale': 'map'
        }
      });
      map.addLayer({
        id: 'real-subway-core',
        source: 'real-subway-stations',
        type: 'circle',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#7df9ff',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 14, 3.7, 16, 5.6],
          'circle-opacity': .92,
          'circle-stroke-color': 'rgba(5,8,18,.9)',
          'circle-stroke-width': 1,
          'circle-pitch-scale': 'map'
        }
      });
      map.addLayer({
        id: 'real-subway-labels',
        source: 'real-subway-stations',
        type: 'symbol',
        minzoom: 14.8,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'station_name'],
          'text-size': 10,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false
        },
        paint: {
          'text-color': 'rgba(230,255,255,.90)',
          'text-halo-color': 'rgba(0,0,0,.78)',
          'text-halo-width': 1.2
        }
      });

      map.on('mousemove', 'real-nightlife-core', e => {
        if (!['level3', 'level4'].includes(activeStage) || !e.features.length) return;
        const p = e.features[0].properties || {};
        map.getCanvas().style.cursor = 'crosshair';
        showTooltip(e.point, `<div class="tooltip-title">Real nightlife POI</div><div class="tooltip-row"><span>Name</span><strong>${p.venue_name || 'Unnamed venue'}</strong></div><div class="tooltip-row"><span>Type</span><strong>${p.poi_label || p.amenity || 'Venue'}</strong></div>`);
      });
      map.on('mouseleave', 'real-nightlife-core', () => { map.getCanvas().style.cursor = ''; hideTooltip(); });
      map.on('click', 'real-nightlife-core', e => {
        if (!['level3', 'level4'].includes(activeStage) || !e.features.length) return;
        const p = e.features[0].properties || {};
        setPanel(p.venue_name || 'Nightlife venue', 1, p.poi_label || 'Real nightlife source');
      });

      map.on('mousemove', 'real-subway-core', e => {
        if (!['level3', 'level4'].includes(activeStage) || !e.features.length) return;
        const p = e.features[0].properties || {};
        map.getCanvas().style.cursor = 'crosshair';
        showTooltip(e.point, `<div class="tooltip-title">Subway station</div><div class="tooltip-row"><span>Station</span><strong>${p.station_name || 'Subway station'}</strong></div><div class="tooltip-row"><span>Line</span><strong>${p.line_name || '--'}</strong></div>`);
      });
      map.on('mouseleave', 'real-subway-core', () => { map.getCanvas().style.cursor = ''; hideTooltip(); });
      map.on('click', 'real-subway-core', e => {
        if (!['level3', 'level4'].includes(activeStage) || !e.features.length) return;
        const p = e.features[0].properties || {};
        setPanel(p.station_name || 'Subway station', 1, 'Transit infrastructure source');
      });

      map.on('mousemove', 'real-bus-routes', e => {
        if (!['level3', 'level4'].includes(activeStage) || !e.features.length) return;
        const p = e.features[0].properties || {};
        map.getCanvas().style.cursor = 'crosshair';
        showTooltip(e.point, `<div class="tooltip-title">Manhattan bus corridor</div><div class="tooltip-row"><span>Route</span><strong>${p.route_short_name || p.route_id || 'Manhattan bus route'}</strong></div><div class="tooltip-row"><span>Type</span><strong>${p.route_type || '--'}</strong></div>`);
      });
      map.on('mouseleave', 'real-bus-routes', () => { map.getCanvas().style.cursor = ''; hideTooltip(); });

      applyRealSourceVisibility();
    }

    function applyRealSourceVisibility() {
      const showOnMap = activeStage === 'level3' || activeStage === 'level4';
      const nightlifeOn = showOnMap && sourceVisible && (activeStage === 'level4' || currentMetric === 'total' || currentMetric === 'nightlife');
      const transitPointsOn = showOnMap && sourceVisible && (activeStage === 'level4' || currentMetric === 'total' || currentMetric === 'transit');
      const transitLinesOn = showOnMap && sourceLinesVisible && (activeStage === 'level4' || currentMetric === 'total' || currentMetric === 'transit');
      setLayerVisibility(['real-nightlife-halo', 'real-nightlife-core', 'real-nightlife-labels'], nightlifeOn);
      setLayerVisibility(['real-subway-halo', 'real-subway-core', 'real-subway-labels'], transitPointsOn);
      setLayerVisibility(realTransitLineLayerIds, transitLinesOn);
    }

    function applyLevel3Hour(hour) {
      currentL3Hour = Number(hour);
      const prop = metricProp(currentMetric, currentL3Hour);
      const val = ['coalesce', ['to-number', ['get', prop]], 0];

      if (map.getLayer('h3-hex-extrusion')) {
        map.setPaintProperty('h3-hex-extrusion', 'fill-extrusion-height', ['interpolate', ['linear'], val, 0, 0, 1, 30, 3, 78, 6, 135, 10, 210, 20, 330, 40, 520]);
        map.setPaintProperty('h3-hex-extrusion', 'fill-extrusion-opacity', ['interpolate', ['linear'], val, 0, .08, 1, .34, 3, .55, 8, .76, 20, .92]);
        map.setPaintProperty('h3-hex-extrusion', 'fill-extrusion-color', ['interpolate', ['linear'], val, 0, '#111827', 1, '#35c8ff', 3, '#00f2ff', 6, '#8b5cff', 10, '#ff3f9f', 18, '#ff8c1a', 30, '#fff37a']);
      }

      const sourceVal = ['coalesce', ['to-number', ['get', hourProp(currentL3Hour)]], 0];
      if (map.getLayer('l3-source-halo')) {
        map.setPaintProperty('l3-source-halo', 'circle-radius', ['interpolate', ['linear'], sourceVal, 0, 0, 1, 11, 3, 22, 8, 42, 18, 68]);
        map.setPaintProperty('l3-source-core', 'circle-radius', ['interpolate', ['linear'], sourceVal, 0, 0, 1, 3.2, 3, 5.2, 8, 8.5, 18, 12]);
      }

      document.getElementById('hourSlider3').value = currentL3Hour;
      document.getElementById('l3-hour-pill').textContent = hourLabel(currentL3Hour);
      updateLevel3Stats(currentL3Hour);
      renderLevel3BarChart();
    }

    function updateLevel3Stats(hour) {
      if (!level3Summary) return;
      const item = level3Summary.hours.find(d => Number(d.hour) === Number(hour));
      if (!item) return;
      document.getElementById('l3-total').textContent = compactNumber(item.total);
      document.getElementById('l3-hexes').textContent = compactNumber(item.active_hexes);
      document.getElementById('l3-source').textContent = sourceLabels[item.top_source_group] || item.top_source_label || '--';
      document.getElementById('l3-subtitle').textContent = `${hourLabel(hour)} · Top hex: ${item.top_hex_count} complaints · Metric: ${currentMetric}`;
    }

    function applySourceFilter() {
      if (!map.getLayer('l3-source-core')) return;
      const sourceFilter = currentMetric === 'total' ? ['all'] : ['==', ['get', 'source_group'], currentMetric];
      ['l3-source-halo', 'l3-source-core', 'l3-source-labels'].forEach(id => map.setFilter(id, sourceFilter));
    }

    function renderLevel3BarChart() {
      if (!level3Summary) return;
      const svg = d3.select('#level3BarChart');
      svg.selectAll('*').remove();
      const node = document.getElementById('level3BarChart');
      const width = Math.max(520, node.clientWidth || 520);
      const height = Math.max(220, node.clientHeight || 220);
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      const margin = { top: 20, right: 20, bottom: 48, left: 94 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      const item = level3Summary.hours.find(d => Number(d.hour) === Number(currentL3Hour));
      const entries = Object.entries(item?.category_counts || {}).map(([k, v]) => ({ key: k, label: sourceLabels[k] || k, value: Number(v || 0) })).sort((a,b) => b.value - a.value);
      const x = d3.scaleLinear().domain([0, d3.max(entries, d => d.value) || 1]).range([0, innerW]);
      const y = d3.scaleBand().domain(entries.map(d => d.key)).range([0, innerH]).padding(.28);

      g.selectAll('rect.bg').data(entries).join('rect').attr('x', 0).attr('y', d => y(d.key)).attr('width', innerW).attr('height', y.bandwidth()).attr('rx', 9).attr('fill', 'rgba(255,255,255,.055)');
      g.selectAll('rect.bar').data(entries).join('rect').attr('x', 0).attr('y', d => y(d.key)).attr('width', d => x(d.value)).attr('height', y.bandwidth()).attr('rx', 9).attr('fill', d => sourceColors[d.key] || '#9aa4b2').attr('opacity', .86);
      g.selectAll('text.label').data(entries).join('text').attr('x', -12).attr('y', d => y(d.key) + y.bandwidth()/2 + 4).attr('text-anchor', 'end').attr('fill', 'rgba(255,255,255,.72)').attr('font-size', 12).attr('font-weight', 900).text(d => d.label);
      g.selectAll('text.value').data(entries).join('text').attr('x', d => Math.min(innerW - 4, x(d.value) + 8)).attr('y', d => y(d.key) + y.bandwidth()/2 + 4).attr('fill', '#fff').attr('font-size', 12).attr('font-weight', 900).text(d => compactNumber(d.value));
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(5).tickFormat(d => compactNumber(d)));
    }

    function setLevel1Narrative(title, text) {
      const titleEl = document.getElementById('l1-callout-title');
      const textEl = document.getElementById('l1-callout-text');
      if (titleEl) titleEl.textContent = title;
      if (textEl) textEl.textContent = text;
    }

    function setLevel1Story(story) {
      document.querySelectorAll('[data-l1-story]').forEach(btn => btn.classList.toggle('active', btn.dataset.l1Story === story));
      closePanel();
      hideTooltip();

      if (story === 'overview') {
        document.getElementById('hotspotBtn').classList.add('active');
        if (activeStage === 'level1') setLayerVisibility(['hotspot-halo', 'hotspot-core'], true);
        setLevel1Narrative('Building Noise Surface', 'Noise is treated as a visible pollutant attached to the city fabric. The skyline becomes a cumulative risk surface rather than a neutral 3D map.');
        resetLevel1View(false);
      }

      if (story === 'hotspots') {
        document.getElementById('hotspotBtn').classList.add('active');
        setLayerVisibility(['hotspot-halo', 'hotspot-core'], activeStage === 'level1');
        setLevel1Narrative('Hotspot Reading Mode', 'Bright nodes reveal representative high-complaint buildings. This mode helps the audience immediately see where noise risk accumulates most strongly.');
        userInteracting = true;
        map.stop();
        map.flyTo({ center: [-73.986, 40.754], zoom: 15.9, pitch: 70, bearing: -34, duration: 1000, essential: true });
        map.once('moveend', () => { currentBearing = map.getBearing(); userInteracting = false; });
      }

      if (story === 'inspect') {
        setLevel1Narrative('Single-building Inspection', 'A building can be read as a local sound object: complaint count, symbolic extrusion height and risk interpretation are shown in the side panel.');
        if (!topLevel1Feature) return;
        const center = polygonCentroid(topLevel1Feature);
        const p = topLevel1Feature.properties || {};
        setPanel(`BIN ${p.bin || 'N/A'}`, getNoise(p), 'Highest accumulated building noise');
        if (center) {
          userInteracting = true;
          map.stop();
          map.flyTo({ center, zoom: 17.2, pitch: 74, bearing: map.getBearing() + 12, duration: 1100, essential: true });
          map.once('moveend', () => { currentBearing = map.getBearing(); userInteracting = false; });
        }
      }
    }

    function resetLevel1View(reactivateStory = true) {
      stopL2Play();
      stopL3Play();
      closePanel();
      hideTooltip();
      userInteracting = true;
      isRotating = false;
      document.getElementById('rotateBtn').classList.remove('active');
      map.stop();
      map.flyTo({ ...views.level1, duration: 1200, essential: true });
      map.once('moveend', () => {
        currentBearing = views.level1.bearing;
        userInteracting = false;
        isRotating = true;
        document.getElementById('rotateBtn').classList.add('active');
        if (reactivateStory) {
          document.querySelectorAll('[data-l1-story]').forEach(btn => btn.classList.toggle('active', btn.dataset.l1Story === 'overview'));
          setLevel1Narrative('Building Noise Surface', 'Use the story cards on the left to switch from an overview, to hotspot discovery, to single-building inspection. The map responds to each reading mode.');
        }
        if (activeStage === 'level1' && document.getElementById('hotspotBtn').classList.contains('active')) {
          setLayerVisibility(['hotspot-halo', 'hotspot-core'], true);
        }
      });
    }

    const l3Scenarios = {
      nightlife: {
        metric: 'nightlife',
        hour: 22,
        center: [-73.9855, 40.7590],
        zoom: 14.25,
        pitch: 61,
        bearing: -28,
        title: 'Nightlife pulse',
        text: 'At night, the grid emphasizes entertainment and commercial clusters. Pink nightlife venues act as an evidence layer, so the map shows not only where noise is high, but also which urban activities may be producing it.'
      },
      commute: {
        metric: 'transit',
        hour: 8,
        center: [-73.9890, 40.7510],
        zoom: 13.95,
        pitch: 58,
        bearing: -18,
        title: 'Transit corridor',
        text: 'During the morning commute, transit and vehicle-related complaints become the active layer. Green bus corridors are clipped to Manhattan only, and cyan subway stations help connect noise exposure to movement infrastructure.'
      },
      daywork: {
        metric: 'construction',
        hour: 10,
        center: [-73.9820, 40.7480],
        zoom: 14.1,
        pitch: 60,
        bearing: -36,
        title: 'Construction hours',
        text: 'In daytime, construction and equipment complaints reveal a different spatial logic. The same H3 grid becomes a working-hours risk terrain, while real source layers remain as context rather than replacing 311 evidence.'
      }
    };

    function setL3Metric(metric) {
      currentMetric = metric;
      document.querySelectorAll('[data-metric]').forEach(b => b.classList.toggle('active', b.dataset.metric === currentMetric));
      applyLevel3Hour(currentL3Hour);
      applySourceFilter();
      applyRealSourceVisibility();
    }

    function setLevel3Scenario(name) {
      const sc = l3Scenarios[name];
      if (!sc) return;
      document.querySelectorAll('[data-l3-scenario]').forEach(btn => btn.classList.toggle('active', btn.dataset.l3Scenario === name));
      const calloutTitle = document.querySelector('#callout-level3 .callout-title');
      const calloutText = document.querySelector('#callout-level3 .callout-text');
      if (calloutTitle) calloutTitle.textContent = sc.title;
      if (calloutText) calloutText.textContent = sc.text;
      setL3Metric(sc.metric);
      applyLevel3Hour(sc.hour);
      if (activeStage === 'level3') {
        map.stop();
        map.flyTo({ center: sc.center, zoom: sc.zoom, pitch: sc.pitch, bearing: sc.bearing, duration: 950, essential: true });
      }
    }

    const radarAxes = ['Residential', 'Nightlife', 'Street', 'Transit', 'Construction', 'Night share'];

    function addLevel4Layers(clusterGeojson) {
      map.addSource('l4-clusters', { type: 'geojson', data: clusterGeojson });
      map.addSource('l4-centers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({ id: 'l4-cluster-extrusion', source: 'l4-clusters', type: 'fill-extrusion', layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': ['coalesce', ['get', 'cluster_color'], '#8b5cff'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'total_count']], 0], 0, 3, 2, 20, 5, 44, 10, 86, 20, 150, 40, 240],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': .78,
        'fill-extrusion-vertical-gradient': false
      }});
      try { map.setPaintProperty('l4-cluster-extrusion', 'fill-extrusion-emissive-strength', .68); } catch(e) {}

      map.addLayer({ id: 'l4-cluster-outline', source: 'l4-clusters', type: 'line', layout: { visibility: 'none' }, paint: {
        'line-color': 'rgba(255,255,255,.55)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, .25, 14, .8],
        'line-opacity': .50
      }});

      map.addLayer({ id: 'l4-cluster-highlight', source: 'l4-clusters', type: 'line', layout: { visibility: 'none' }, filter: ['==', ['get', 'cluster_id'], -999], paint: {
        'line-color': '#ffffff',
        'line-width': 3.0,
        'line-opacity': .95,
        'line-blur': .4
      }});

      map.addLayer({ id: 'l4-cluster-centers', source: 'l4-centers', type: 'symbol', layout: {
        visibility: 'none',
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-anchor': 'center',
        'text-allow-overlap': false
      }, paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,.80)',
        'text-halo-width': 1.4
      }});

      map.on('mousemove', 'l4-cluster-extrusion', e => {
        if (activeStage !== 'level4' || !e.features.length) return;
        const p = e.features[0].properties;
        map.getCanvas().style.cursor = 'crosshair';
        showTooltip(e.point, `<div class="tooltip-title">Soundscape Cluster</div><div class="tooltip-row"><span>Type</span><strong>${p.cluster_label}</strong></div><div class="tooltip-row"><span>Complaints</span><strong>${compactNumber(Number(p.total_count || 0))}</strong></div><div class="tooltip-row"><span>Peak hour</span><strong>${hourLabel(Number(p.peak_hour || 0))}</strong></div>`);
      });
      map.on('mouseleave', 'l4-cluster-extrusion', () => { map.getCanvas().style.cursor = ''; hideTooltip(); });
      map.on('click', 'l4-cluster-extrusion', e => {
        if (activeStage !== 'level4' || !e.features.length) return;
        const p = e.features[0].properties;
        focusCluster(Number(p.cluster_id), false);
        setClusterPanelFromFeature(p);
      });
    }

    function updateLevel4Stats() {
      if (!level4Summary) return;
      document.getElementById('l4-cells').textContent = compactNumber(level4Summary.meta.total_cells);
      document.getElementById('l4-types').textContent = compactNumber(level4Summary.meta.n_clusters);
      const cluster = level4Summary.clusters.find(c => Number(c.cluster_id) === Number(activeClusterId)) || level4Summary.clusters[0];
      document.getElementById('l4-selected').textContent = cluster ? cluster.label.replace(' zone','').replace(' belt','') : '--';
    }

    function renderLevel4Cards() {
      if (!level4Summary) return;
      const wrap = document.getElementById('level4ClusterCards');
      wrap.innerHTML = '';
      level4Summary.clusters.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'cluster-card';
        btn.dataset.clusterId = c.cluster_id;
        btn.innerHTML = `<div class="cluster-label"><span class="cluster-swatch" style="background:${c.color};color:${c.color}"></span>${c.label}</div><div class="cluster-meta">${compactNumber(c.total_count)} complaints · ${c.cell_count} H3 cells · ${c.share_percent}% share</div>`;
        btn.addEventListener('click', () => focusCluster(Number(c.cluster_id), true));
        wrap.appendChild(btn);
      });
    }

    function radarFromFeatureProps(p) {
      return {
        'Residential': Number(p.radar_residential || 0),
        'Nightlife': Number(p.radar_nightlife || 0),
        'Street': Number(p.radar_street || 0),
        'Transit': Number(p.radar_transit || 0),
        'Construction': Number(p.radar_construction || 0),
        'Night share': Number(p.radar_night || p.night_share || 0)
      };
    }

    function renderRadar(selector, radar, color = '#00eaff') {
      const svg = d3.select(selector);
      svg.selectAll('*').remove();
      const node = document.querySelector(selector);
      if (!node) return;
      const width = Math.max(280, node.clientWidth || 320);
      const height = Math.max(250, node.clientHeight || 280);
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      const cx = width / 2;
      const cy = height / 2 + 6;
      const r = Math.min(width, height) * 0.34;
      const g = svg.append('g');
      [0.25, 0.5, 0.75, 1].forEach(t => {
        const points = radarAxes.map((axis, i) => {
          const a = -Math.PI / 2 + i * Math.PI * 2 / radarAxes.length;
          return [cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t];
        });
        g.append('polygon').attr('points', points.map(d => d.join(',')).join(' ')).attr('fill', 'none').attr('stroke', 'rgba(255,255,255,.12)').attr('stroke-width', 1);
      });
      radarAxes.forEach((axis, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / radarAxes.length;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        g.append('line').attr('x1', cx).attr('y1', cy).attr('x2', x).attr('y2', y).attr('stroke', 'rgba(255,255,255,.12)');
        g.append('text').attr('x', cx + Math.cos(a) * (r + 28)).attr('y', cy + Math.sin(a) * (r + 28) + 4).attr('text-anchor', Math.cos(a) > .25 ? 'start' : Math.cos(a) < -.25 ? 'end' : 'middle').attr('fill', 'rgba(255,255,255,.78)').attr('font-size', 12).attr('font-weight', 800).text(axis);
      });
      const dataPoints = radarAxes.map((axis, i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / radarAxes.length;
        const v = Math.max(0, Math.min(1, Number(radar[axis] || 0)));
        return { x: cx + Math.cos(a) * r * v, y: cy + Math.sin(a) * r * v, v };
      });
      g.append('polygon').attr('points', dataPoints.map(d => `${d.x},${d.y}`).join(' ')).attr('fill', color).attr('fill-opacity', .22).attr('stroke', color).attr('stroke-width', 2.4).attr('filter', 'drop-shadow(0 0 10px rgba(0,234,255,.28))');
      g.selectAll('circle.radar-dot').data(dataPoints).join('circle').attr('class', 'radar-dot').attr('cx', d => d.x).attr('cy', d => d.y).attr('r', 3.5).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', .6);
    }

    function renderClusterPca() {
      if (!level4Summary) return;
      const svg = d3.select('#clusterPca');
      svg.selectAll('*').remove();
      const node = document.getElementById('clusterPca');
      const width = Math.max(280, node.clientWidth || 320);
      const height = Math.max(250, node.clientHeight || 280);
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      const margin = { top: 18, right: 18, bottom: 34, left: 38 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      const pts = level4Summary.clusters.map(c => ({ id: c.cluster_id, label: c.label, color: c.color, x: c.pca_center[0], y: c.pca_center[1], count: c.total_count }));
      const xExtent = d3.extent(pts, d => d.x);
      const yExtent = d3.extent(pts, d => d.y);
      const x = d3.scaleLinear().domain(xExtent[0] === xExtent[1] ? [xExtent[0]-1, xExtent[1]+1] : xExtent).nice().range([0, innerW]);
      const y = d3.scaleLinear().domain(yExtent[0] === yExtent[1] ? [yExtent[0]-1, yExtent[1]+1] : yExtent).nice().range([innerH, 0]);
      const r = d3.scaleSqrt().domain([0, d3.max(pts, d => d.count) || 1]).range([7, 22]);
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(4));
      g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4));
      g.selectAll('circle').data(pts).join('circle').attr('cx', d => x(d.x)).attr('cy', d => y(d.y)).attr('r', d => r(d.count)).attr('fill', d => d.color).attr('fill-opacity', d => Number(d.id) === Number(activeClusterId) ? .95 : .45).attr('stroke', d => Number(d.id) === Number(activeClusterId) ? '#fff' : 'rgba(255,255,255,.45)').attr('stroke-width', d => Number(d.id) === Number(activeClusterId) ? 2 : 1);
      g.selectAll('text.pt').data(pts).join('text').attr('class', 'pt').attr('x', d => x(d.x) + r(d.count) + 4).attr('y', d => y(d.y) + 4).attr('fill', 'rgba(255,255,255,.78)').attr('font-size', 11).attr('font-weight', 800).text(d => String(d.label).split(' ')[0]);
    }

    function setClusterPanelFromFeature(p) {
      const wrap = document.getElementById('panelRadarWrap');
      const title = document.getElementById('panel-title');
      if (title) title.textContent = 'Soundscape Cluster';
      document.getElementById('panel-id').textContent = p.h3 || `Cluster ${p.cluster_id}`;
      document.getElementById('panel-count').textContent = compactNumber(Number(p.total_count || 0));
      document.getElementById('panel-source').textContent = p.cluster_label || '--';
      document.getElementById('risk-fill').style.width = `${Math.min(100, Math.round((Number(p.total_count || 0) / Math.max(1, maxNoise)) * 100))}%`;
      if (wrap) wrap.style.display = 'block';
      renderRadar('#panelRadar', radarFromFeatureProps(p), p.cluster_color || '#00eaff');
      document.getElementById('sidePanel').classList.add('active');
    }

    function focusCluster(clusterId, openPanel = false) {
      if (!level4Summary) return;
      activeClusterId = Number(clusterId);
      const cluster = level4Summary.clusters.find(c => Number(c.cluster_id) === activeClusterId) || level4Summary.clusters[0];
      if (!cluster) return;
      document.querySelectorAll('.cluster-card').forEach(card => card.classList.toggle('active', Number(card.dataset.clusterId) === activeClusterId));
      if (map.getLayer('l4-cluster-highlight')) map.setFilter('l4-cluster-highlight', ['==', ['get', 'cluster_id'], activeClusterId]);
      if (map.getSource('l4-centers')) {
        const centerFeatures = level4Summary.clusters.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c.center }, properties: { label: c.label, cluster_id: c.cluster_id } }));
        map.getSource('l4-centers').setData({ type: 'FeatureCollection', features: centerFeatures });
      }
      document.getElementById('l4-subtitle').textContent = `${cluster.label}: ${cluster.narrative}`;
      document.getElementById('l4-callout-title').textContent = cluster.label;
      document.getElementById('l4-callout-text').textContent = cluster.narrative;
      updateLevel4Stats();
      renderClusterPca();
      if (activeStage === 'level4') {
        map.flyTo({ center: cluster.center, zoom: 13.65, pitch: 52, bearing: views.level4.bearing, duration: 900, essential: true });
      }
      if (openPanel) {
        document.getElementById('panel-title').textContent = 'Soundscape Cluster';
        document.getElementById('panel-id').textContent = `Cluster ${cluster.cluster_id}`;
        document.getElementById('panel-count').textContent = compactNumber(cluster.total_count);
        document.getElementById('panel-source').textContent = cluster.label;
        document.getElementById('risk-fill').style.width = `${Math.min(100, Math.round(cluster.share_percent))}%`;
        document.getElementById('panelRadarWrap').style.display = 'block';
        renderRadar('#panelRadar', cluster.radar, cluster.color);
        document.getElementById('sidePanel').classList.add('active');
      }
    }

    function updateLevel2Stats(summary) {
      if (!summary) return;
      document.getElementById('level2-total').textContent = compactNumber(summary.total_count);
      document.getElementById('level2-peak').textContent = hourLabel(summary.peak_hour);
      document.getElementById('level2-night').textContent = `${summary.night_share}%`;
    }

    const level2Colors = {
      'Residential Banging / Pounding': '#00eaff',
      'Residential Music / Party': '#ff2d6f',
      'Street / Sidewalk': '#ff9f1c',
      'Commercial / Nightlife': '#8b5cff',
      'Vehicle / Aerial Traffic': '#47ffb3',
      'Residential Talking / TV': '#66dcff',
      'Construction / Equipment': '#fff37a',
      'Mechanical / Alarm': '#b388ff',
      'Animal Noise': '#7df9ff',
      'Public / Other Sources': '#9aa4b2'
    };

    function renderLevel2Chart() {
      if (!level2RawData) return;
      const svg = d3.select('#level2Chart');
      svg.selectAll('*').remove();
      const node = document.getElementById('level2Chart');
      const width = Math.max(760, node.clientWidth || 760);
      const height = Math.max(420, node.clientHeight || 420);
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      const margin = { top: 24, right: 28, bottom: 40, left: 190 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      const data = level2RawData.data.filter(d => d.day_type === activeDayType);
      const categories = level2RawData.meta.categories;
      const x = d3.scaleLinear().domain([0,23]).range([0, innerW]);
      l2XScale = x;
      const rowStep = innerH / categories.length;
      const y = d3.scalePoint().domain(categories).range([rowStep * .55, innerH - rowStep * .45]);
      const valueKey = useShapeMode ? 'ridge_norm' : 'log_norm';
      const maxVal = d3.max(data, d => Number(d[valueKey] || 0)) || 1;
      const amp = d3.scaleLinear().domain([0, maxVal]).range([0, rowStep * .72]);

      g.selectAll('.grid-line').data(d3.range(0,24,3)).join('line').attr('x1', d => x(d)).attr('x2', d => x(d)).attr('y1', 0).attr('y2', innerH).attr('stroke', 'rgba(255,255,255,.06)');
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).tickValues([0,3,6,9,12,15,18,21,23]).tickFormat(d => hourLabel(d)));

      const area = d3.area().x(d => x(+d.hour)).y0(d => y(d.category)).y1(d => y(d.category) - amp(Number(d[valueKey] || 0))).curve(d3.curveCatmullRom.alpha(.55));
      const line = d3.line().x(d => x(+d.hour)).y(d => y(d.category) - amp(Number(d[valueKey] || 0))).curve(d3.curveCatmullRom.alpha(.55));
      categories.forEach(cat => {
        const catData = data.filter(d => d.category === cat).sort((a,b) => +a.hour - +b.hour);
        g.append('line').attr('class', 'baseline').attr('x1', 0).attr('x2', innerW).attr('y1', y(cat)).attr('y2', y(cat));
        const isFocused = !l2FocusCategory || cat === l2FocusCategory;
        g.append('text').attr('class', 'category-label').attr('x', -14).attr('y', y(cat)-5).attr('text-anchor', 'end').attr('opacity', isFocused ? 1 : .42).text(cat);
        g.append('path').datum(catData).attr('class', 'ridge-fill').attr('d', area).attr('fill', level2Colors[cat] || '#fff').attr('opacity', isFocused ? .95 : .18);
        g.append('path').datum(catData).attr('class', 'ridge-outline').attr('d', line).attr('stroke', level2Colors[cat] || '#fff').attr('opacity', isFocused ? 1 : .24);
      });
      l2HourMarker = g.append('line').attr('class', 'hour-line').attr('y1', 0).attr('y2', innerH).attr('x1', x(currentHour)).attr('x2', x(currentHour));
      g.selectAll('.hover-rect').data(d3.range(24)).join('rect').attr('x', d => x(d) - innerW/48).attr('y', 0).attr('width', innerW/24).attr('height', innerH).attr('fill', 'transparent').on('mousemove', (event, hour) => setLevel2Hour(hour)).on('mouseleave', hideTooltip);
    }

    function setLevel2Hour(hour) {
      currentHour = Number(hour);
      document.getElementById('hourSlider').value = currentHour;
      document.getElementById('hourReadout').textContent = hourLabel(currentHour);
      if (document.getElementById('l2-hour-context') && !document.querySelector('[data-l2-story].active')) {
        document.getElementById('l2-hour-context').innerHTML = `<strong>${hourLabel(currentHour)} reading:</strong> move through the daily cycle to compare when each noise category becomes active.`;
      }
      if (l2HourMarker && l2XScale) l2HourMarker.attr('x1', l2XScale(currentHour)).attr('x2', l2XScale(currentHour));
      applyLevel2Hour(currentHour);
    }

    const l5BivarColors = {
      '1-1': '#0b6e78',
      '1-2': '#2c8a8d',
      '1-3': '#7ab6c2',
      '2-1': '#7a4d75',
      '2-2': '#9a7aa6',
      '2-3': '#b7b8c9',
      '3-1': '#c1376f',
      '3-2': '#d17c8e',
      '3-3': '#f0c8c8',
      '0-0': '#2f3444'
    };

    function money(value) {
      const v = Number(value);
      if (!Number.isFinite(v)) return '--';
      return '$' + compactNumber(v);
    }

    function plainNumber(value, digits = 1) {
      const v = Number(value);
      if (!Number.isFinite(v)) return '--';
      return v.toFixed(digits);
    }

    function percent(value, digits = 1) {
      const v = Number(value);
      if (!Number.isFinite(v)) return '--';
      return v.toFixed(digits) + '%';
    }

    function l5Props(feature) {
      return feature?.properties || {};
    }

    function l5MetricColor(p) {
      if (level5Mode === 'income') {
        const v = Number(p.median_income);
        const t = level5Summary?.thresholds || {};
        if (!Number.isFinite(v)) return '#2f3444';
        if (v <= t.income_q1) return '#c1376f';
        if (v <= t.income_q2) return '#9a7aa6';
        return '#7ab6c2';
      }
      if (level5Mode === 'poverty') {
        const v = Number(p.poverty_rate);
        if (!Number.isFinite(v)) return '#2f3444';
        if (v >= 25) return '#ff2d6f';
        if (v >= 12) return '#ff9f1c';
        return '#47ffb3';
      }
      return p.bivar_color || l5BivarColors[p.bivar_key] || '#2f3444';
    }

    function isPriorityBurden(p) {
      return p.quadrant === 'low_income_high_noise' || Number(p.burden_rank || 99999) <= 10;
    }

    function buildLevel5FallbackSummary() {
      if (!level5Data?.features?.length) return null;
      const vals = level5Data.features.map(f => l5Props(f));
      const finite = arr => arr.map(Number).filter(Number.isFinite).sort(d3.ascending);
      const median = arr => {
        const a = finite(arr);
        if (!a.length) return 0;
        const m = Math.floor(a.length / 2);
        return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
      };
      const incomes = vals.map(d => d.median_income);
      const noises = vals.map(d => d.complaints_per_1000);
      const mx = median(incomes);
      const my = median(noises);
      const pairs = vals.map(d => [Number(d.median_income), Number(d.complaints_per_1000)]).filter(d => Number.isFinite(d[0]) && Number.isFinite(d[1]));
      let corr = NaN;
      if (pairs.length > 2) {
        const ax = d3.mean(pairs, d => d[0]);
        const ay = d3.mean(pairs, d => d[1]);
        const num = d3.sum(pairs, d => (d[0] - ax) * (d[1] - ay));
        const den = Math.sqrt(d3.sum(pairs, d => (d[0] - ax) ** 2) * d3.sum(pairs, d => (d[1] - ay) ** 2));
        corr = den ? num / den : NaN;
      }
      return {
        tract_count: vals.length,
        median_income: mx,
        median_noise_per_1000: my,
        correlation_income_noise: corr,
        thresholds: { median_income: mx, median_noise: my }
      };
    }

    function l5GetPropsArray() {
      return (level5Data?.features || []).map(f => l5Props(f));
    }

    function l5Correlation(xVals, yVals) {
      const pairs = xVals.map((x, i) => [Number(x), Number(yVals[i])])
        .filter(d => Number.isFinite(d[0]) && Number.isFinite(d[1]));
      if (pairs.length < 3) return NaN;
      const mx = d3.mean(pairs, d => d[0]);
      const my = d3.mean(pairs, d => d[1]);
      const num = d3.sum(pairs, d => (d[0] - mx) * (d[1] - my));
      const den = Math.sqrt(
        d3.sum(pairs, d => Math.pow(d[0] - mx, 2)) *
        d3.sum(pairs, d => Math.pow(d[1] - my, 2))
      );
      return den ? num / den : NaN;
    }

    function l5Median(values) {
      const arr = values.map(Number).filter(Number.isFinite).sort(d3.ascending);
      return arr.length ? d3.median(arr) : NaN;
    }

    function l5SetStat(label1, value1, label2, value2, label3, value3) {
      document.getElementById('l5-stat1-label').textContent = label1;
      document.getElementById('l5-tracts').textContent = value1;
      document.getElementById('l5-stat2-label').textContent = label2;
      document.getElementById('l5-med-income').textContent = value2;
      document.getElementById('l5-stat3-label').textContent = label3;
      document.getElementById('l5-corr').textContent = value3;
    }

    function updateLevel5Stats() {
      if (!level5Summary || !level5Data) return;

      const props = l5GetPropsArray();
      const tractCount = level5Summary.tract_count || props.length;
      const incomes = props.map(p => Number(p.median_income));
      const noise = props.map(p => Number(p.complaints_per_1000));
      const poverty = props.map(p => Number(p.poverty_rate));

      const priorityCount = props.filter(isPriorityBurden).length;
      const lowIncomeCount = props.filter(p => Number(p.income_class) === 1).length;
      const highIncomeCount = props.filter(p => Number(p.income_class) === 3).length;
      const highNoiseCount = props.filter(p => Number(p.noise_class) === 3).length;

      const povertySorted = poverty.filter(Number.isFinite).sort(d3.ascending);
      const highPovertyCut = povertySorted.length ? d3.quantile(povertySorted, 2 / 3) : NaN;
      const highPovertyCount = props.filter(p => Number(p.poverty_rate) >= highPovertyCut).length;

      const incomeNoiseR = Number(level5Summary.correlation_income_noise);
      const povertyNoiseR = l5Correlation(poverty, noise);

      if (level5Mode === 'income') {
        l5SetStat(
          'Low-income Tracts',
          compactNumber(lowIncomeCount),
          'Median Income',
          money(level5Summary.median_income || l5Median(incomes)),
          'High-income Tracts',
          compactNumber(highIncomeCount)
        );
      } else if (level5Mode === 'poverty') {
        l5SetStat(
          'High-poverty Tracts',
          compactNumber(highPovertyCount),
          'Median Poverty',
          percent(l5Median(poverty), 1),
          'Poverty × Noise r',
          Number.isFinite(povertyNoiseR) ? povertyNoiseR.toFixed(2) : '--'
        );
      } else {
        l5SetStat(
          'Priority Tracts',
          compactNumber(priorityCount),
          'High-noise Tracts',
          compactNumber(highNoiseCount),
          'Income × Noise r',
          Number.isFinite(incomeNoiseR) ? incomeNoiseR.toFixed(2) : '--'
        );
      }
    }

    function selectLevel5Tract(geoid) {
      activeLevel5Geoid = geoid;
      renderLevel5Selection();
      const f = (level5Data?.features || []).find(d => l5Props(d).GEOID === geoid);
      if (f) updateLevel5Profile(f);
    }

    function updateLevel5Profile(feature) {
      const p = l5Props(feature);
      document.getElementById('l5-profile-title').textContent = p.tract_name || `Tract ${p.GEOID || ''}`;
      document.getElementById('l5-profile-subtitle').textContent = p.quadrant_label || 'Socio-acoustic profile';
      document.getElementById('l5-profile-income').textContent = money(p.median_income);
      document.getElementById('l5-profile-noise').textContent = plainNumber(p.complaints_per_1000, 1);
      document.getElementById('l5-profile-pop').textContent = compactNumber(p.population);
      document.getElementById('l5-profile-poverty').textContent = percent(p.poverty_rate, 1);
    }

    function updateLevel5DefaultProfile() {
      if (!level5Data?.features?.length) return;
      const top = [...level5Data.features].sort((a,b) => Number(l5Props(a).burden_score || 0) - Number(l5Props(b).burden_score || 0)).pop();
      if (top) selectLevel5Tract(l5Props(top).GEOID);
    }

    function renderLevel5Legend() {
      const wrap = d3.select('#l5-bivar-legend');
      wrap.selectAll('*').remove();
      const keys = ['3-1','3-2','3-3','2-1','2-2','2-3','1-1','1-2','1-3'];
      wrap.selectAll('div')
        .data(keys)
        .join('div')
        .attr('class', 'bivar-cell')
        .style('background', d => l5BivarColors[d] || '#2f3444')
        .attr('title', d => `noise-income class ${d}`);
    }

    function renderLevel5Scatter() {
      if (!level5Data || !level5Summary) return;
      const svg = d3.select('#level5Scatter');
      svg.selectAll('*').remove();

      const node = document.getElementById('level5Scatter');
      const width = Math.max(720, node.clientWidth || 720);
      const height = Math.max(520, node.clientHeight || 520);
      svg.attr('viewBox', `0 0 ${width} ${height}`);

      const margin = { top: 34, right: 34, bottom: 68, left: 86 };
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      const raw = level5Data.features.map(f => ({ feature: f, ...l5Props(f) }))
        .filter(d => Number.isFinite(Number(d.median_income)) && Number.isFinite(Number(d.complaints_per_1000)));

      const data = showPriorityOnly ? raw.filter(isPriorityBurden) : raw;
      const xMax = d3.quantile(raw.map(d => Number(d.median_income)).sort(d3.ascending), .98) || d3.max(raw, d => Number(d.median_income)) || 1;
      const yMax = d3.quantile(raw.map(d => Number(d.complaints_per_1000)).sort(d3.ascending), .98) || d3.max(raw, d => Number(d.complaints_per_1000)) || 1;

      const x = d3.scaleLinear().domain([0, xMax * 1.06]).nice().range([0, innerW]);
      const y = d3.scaleLinear().domain([0, yMax * 1.08]).nice().range([innerH, 0]);
      const r = d3.scaleSqrt().domain([0, d3.max(raw, d => Number(d.population || 0)) || 1]).range([4, 18]);

      const tx = level5Summary.thresholds?.median_income ?? d3.median(raw, d => Number(d.median_income));
      const ty = level5Summary.thresholds?.median_noise ?? d3.median(raw, d => Number(d.complaints_per_1000));

      const bg = [
        { x0: 0, x1: tx, y0: ty, y1: y.domain()[1], label: 'LOW INCOME / HIGH NOISE', color: 'rgba(255,45,111,.08)' },
        { x0: tx, x1: x.domain()[1], y0: ty, y1: y.domain()[1], label: 'HIGH INCOME / HIGH NOISE', color: 'rgba(255,159,28,.06)' },
        { x0: 0, x1: tx, y0: 0, y1: ty, label: 'LOW INCOME / LOW NOISE', color: 'rgba(0,234,255,.045)' },
        { x0: tx, x1: x.domain()[1], y0: 0, y1: ty, label: 'HIGH INCOME / LOW NOISE', color: 'rgba(71,255,179,.045)' }
      ];

      g.selectAll('rect.quad-bg')
        .data(bg)
        .join('rect')
        .attr('x', d => x(d.x0))
        .attr('y', d => y(d.y1))
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0)))
        .attr('height', d => Math.max(0, y(d.y0) - y(d.y1)))
        .attr('fill', d => d.color);

      g.selectAll('text.quad-label')
        .data(bg)
        .join('text')
        .attr('class', 'level5-quadrant-label')
        .attr('x', d => x((d.x0 + d.x1) / 2))
        .attr('y', d => y(d.y1) + 22)
        .attr('text-anchor', 'middle')
        .text(d => d.label);

      g.selectAll('line.xgrid')
        .data(x.ticks(6))
        .join('line')
        .attr('class', 'level5-grid-line')
        .attr('x1', d => x(d)).attr('x2', d => x(d))
        .attr('y1', 0).attr('y2', innerH);

      g.selectAll('line.ygrid')
        .data(y.ticks(6))
        .join('line')
        .attr('class', 'level5-grid-line')
        .attr('x1', 0).attr('x2', innerW)
        .attr('y1', d => y(d)).attr('y2', d => y(d));

      g.append('line')
        .attr('class', 'level5-threshold')
        .attr('x1', x(tx)).attr('x2', x(tx))
        .attr('y1', 0).attr('y2', innerH);

      g.append('line')
        .attr('class', 'level5-threshold')
        .attr('x1', 0).attr('x2', innerW)
        .attr('y1', y(ty)).attr('y2', y(ty));

      g.append('g')
        .attr('class', 'level5-axis')
        .attr('transform', `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(6).tickFormat(d => '$' + compactNumber(d)));

      g.append('g')
        .attr('class', 'level5-axis')
        .call(d3.axisLeft(y).ticks(6));

      g.append('text')
        .attr('class', 'level5-axis-title')
        .attr('x', innerW / 2)
        .attr('y', innerH + 50)
        .attr('text-anchor', 'middle')
        .text('Median household income');

      g.append('text')
        .attr('class', 'level5-axis-title')
        .attr('transform', 'rotate(-90)')
        .attr('x', -innerH / 2)
        .attr('y', -58)
        .attr('text-anchor', 'middle')
        .text('Noise complaints per 1,000 residents');

      const dots = g.selectAll('circle.scatter-dot')
        .data(data, d => d.GEOID)
        .join('circle')
        .attr('class', d => 'scatter-dot' + (d.GEOID === activeLevel5Geoid ? ' selected' : ''))
        .attr('cx', d => x(Math.min(Number(d.median_income), x.domain()[1])))
        .attr('cy', d => y(Math.min(Number(d.complaints_per_1000), y.domain()[1])))
        .attr('r', d => r(Number(d.population || 0)))
        .attr('fill', d => l5MetricColor(d))
        .attr('opacity', d => showPriorityOnly ? .96 : (isPriorityBurden(d) ? .95 : .58))
        .on('mousemove', (event, d) => {
          showTooltip({ x: event.clientX, y: event.clientY }, `<div class="tooltip-title">${d.tract_name || d.GEOID}</div><div class="tooltip-row"><span>Income</span><strong>${money(d.median_income)}</strong></div><div class="tooltip-row"><span>Noise / 1k</span><strong>${plainNumber(d.complaints_per_1000, 1)}</strong></div><div class="tooltip-row"><span>Quadrant</span><strong>${d.quadrant_label || '--'}</strong></div>`);
        })
        .on('mouseleave', hideTooltip)
        .on('click', (event, d) => selectLevel5Tract(d.GEOID));

      const selected = raw.find(d => d.GEOID === activeLevel5Geoid);
      if (selected) {
        g.append('circle')
          .attr('class', 'burden-ring')
          .attr('cx', x(Math.min(Number(selected.median_income), x.domain()[1])))
          .attr('cy', y(Math.min(Number(selected.complaints_per_1000), y.domain()[1])))
          .attr('r', r(Number(selected.population || 0)) + 7);
      }
    }

    function renderLevel5MiniMap() {
      if (!level5Data) return;
      const svg = d3.select('#level5MiniMap');
      svg.selectAll('*').remove();
      const node = document.getElementById('level5MiniMap');
      const width = Math.max(280, node.clientWidth || 280);
      const height = Math.max(280, node.clientHeight || 280);
      svg.attr('viewBox', `0 0 ${width} ${height}`);

      const projection = d3.geoMercator().fitSize([width, height], level5Data);
      const path = d3.geoPath(projection);

      svg.append('g')
        .selectAll('path')
        .data(level5Data.features)
        .join('path')
        .attr('class', d => 'tract-mini' + (l5Props(d).GEOID === activeLevel5Geoid ? ' selected' : ''))
        .attr('d', path)
        .attr('fill', d => l5MetricColor(l5Props(d)))
        .attr('opacity', d => showPriorityOnly && !isPriorityBurden(l5Props(d)) ? .22 : .82)
        .on('mousemove', (event, d) => {
          const p = l5Props(d);
          showTooltip({ x: event.clientX, y: event.clientY }, `<div class="tooltip-title">${p.tract_name || p.GEOID}</div><div class="tooltip-row"><span>Income</span><strong>${money(p.median_income)}</strong></div><div class="tooltip-row"><span>Noise / 1k</span><strong>${plainNumber(p.complaints_per_1000, 1)}</strong></div>`);
        })
        .on('mouseleave', hideTooltip)
        .on('click', (event, d) => selectLevel5Tract(l5Props(d).GEOID));
    }

    function renderLevel5Selection() {
      updateLevel5Stats();
      renderLevel5Scatter();
      renderLevel5MiniMap();
    }

    function renderLevel5() {
      if (!level5Data || !level5Summary) return;
      updateLevel5Stats();
      renderLevel5Legend();
      renderLevel5Scatter();
      renderLevel5MiniMap();
      if (!activeLevel5Geoid) updateLevel5DefaultProfile();
    }

    function setLevel5Mode(mode) {
      level5Mode = mode;
      document.querySelectorAll('[data-l5-mode]').forEach(b => b.classList.toggle('active', b.dataset.l5Mode === mode));
      const subtitle = document.getElementById('l5-chart-subtitle');
      if (mode === 'income') subtitle.textContent = 'Dots are colored by income tertile while retaining the same income–noise coordinate system.';
      else if (mode === 'poverty') subtitle.textContent = 'Dots are colored by poverty rate to add a second vulnerability signal to the noise exposure space.';
      else subtitle.textContent = 'Bivariate colors combine income and noise exposure; the lower-income / higher-noise quadrant is treated as the main burden area.';
      updateLevel5Stats();
      renderLevel5Scatter();
      renderLevel5MiniMap();
    }

    function formatSigned(v) { const n = Number(v || 0); return `${n > 0 ? '+' : ''}${n.toFixed(1)}`; }
    function l6FeatureCollection(features) { return { type: 'FeatureCollection', features: features.filter(Boolean) }; }
    function l6Haversine(lon1, lat1, lon2, lat2) {
      const R = 6371000;
      const p1 = lon1 * Math.PI / 180, p2 = lon2 * Math.PI / 180;
      const a1 = lat1 * Math.PI / 180, a2 = lat2 * Math.PI / 180;
      const dLat = a2 - a1, dLon = p2 - p1;
      const a = Math.sin(dLat/2)**2 + Math.cos(a1)*Math.cos(a2)*Math.sin(dLon/2)**2;
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function l6NearestNode(lngLat) {
      if (!level6Graph?.nodes?.length) return null;
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < level6Graph.nodes.length; i++) {
        const n = level6Graph.nodes[i];
        const d = l6Haversine(lngLat.lng, lngLat.lat, n.lon, n.lat);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      return { index: bestIdx, distance: bestDist, node: level6Graph.nodes[bestIdx] };
    }
    function l6Dijkstra(startIdx, endIdx, mode) {
      const nodes = level6Graph.nodes;
      const adj = level6Graph.adjacency;
      const meta = level6Graph.meta || {};
      const riskWeight = Number(meta.safe_risk_weight ?? 22.0);
      const riskPower = Number(meta.safe_risk_power ?? 1.15);
      const hotspotThreshold = Number(meta.hotspot_threshold ?? 0.68);
      const hotspotMultiplier = Number(meta.hotspot_multiplier ?? 5.0);
      const n = nodes.length;

      class MinHeap {
        constructor() { this.data = []; }
        push(item) {
          this.data.push(item);
          let i = this.data.length - 1;
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.data[p].cost <= item.cost) break;
            this.data[i] = this.data[p];
            i = p;
          }
          this.data[i] = item;
        }
        pop() {
          if (!this.data.length) return null;
          const top = this.data[0];
          const last = this.data.pop();
          if (this.data.length && last) {
            let i = 0;
            while (true) {
              let l = i * 2 + 1, r = l + 1;
              if (l >= this.data.length) break;
              let c = r < this.data.length && this.data[r].cost < this.data[l].cost ? r : l;
              if (this.data[c].cost >= last.cost) break;
              this.data[i] = this.data[c];
              i = c;
            }
            this.data[i] = last;
          }
          return top;
        }
        get length() { return this.data.length; }
      }

      const dist = new Float64Array(n);
      dist.fill(Infinity);
      const prev = new Int32Array(n);
      prev.fill(-1);
      const visited = new Uint8Array(n);
      dist[startIdx] = 0;
      const heap = new MinHeap();
      heap.push({ idx: startIdx, cost: 0 });

      while (heap.length) {
        const cur = heap.pop();
        if (!cur || visited[cur.idx]) continue;
        visited[cur.idx] = 1;
        if (cur.idx === endIdx) break;

        const curNode = nodes[cur.idx];
        for (const edge of adj[cur.idx] || []) {
          const nbIdx = Number(edge[0]);
          if (visited[nbIdx]) continue;
          const nbNode = nodes[nbIdx];
          const distM = Number(edge[1]);
          const edgeRisk = Number.isFinite(Number(edge[2]))
            ? Number(edge[2])
            : (((Number(curNode.risk) || 0) + (Number(nbNode.risk) || 0)) / 2);

          let edgeCost = distM;
          if (mode === 'quiet') {
            edgeCost = distM * (1 + riskWeight * Math.pow(edgeRisk, riskPower));
            if (edgeRisk >= hotspotThreshold) edgeCost *= hotspotMultiplier;
          }

          const newCost = cur.cost + edgeCost;
          if (newCost < dist[nbIdx]) {
            dist[nbIdx] = newCost;
            prev[nbIdx] = cur.idx;
            heap.push({ idx: nbIdx, cost: newCost });
          }
        }
      }

      if (!Number.isFinite(dist[endIdx])) return [];
      const path = [];
      let at = endIdx;
      while (at !== -1) {
        path.push(at);
        if (at === startIdx) break;
        at = prev[at];
      }
      return path.reverse();
    }

    function l6EdgeRisk(aIdx, bIdx) {
      const edge = (level6Graph.adjacency?.[aIdx] || []).find(e => Number(e[0]) === Number(bIdx));
      if (edge && Number.isFinite(Number(edge[2]))) return Number(edge[2]);
      const a = level6Graph.nodes[aIdx], b = level6Graph.nodes[bIdx];
      return ((Number(a.risk) || 0) + (Number(b.risk) || 0)) / 2;
    }

    function l6PathToFeature(pathIdx, routeType) {
      const coords = pathIdx.map(i => [level6Graph.nodes[i].lon, level6Graph.nodes[i].lat]);
      return { type: 'Feature', properties: { route_type: routeType }, geometry: { type: 'LineString', coordinates: coords } };
    }
    function l6Metrics(pathIdx, routeType) {
      const nodes = level6Graph.nodes;
      const threshold = Number(level6Graph.meta?.hotspot_threshold ?? 0.68);
      let lengthM = 0, exposure = 0, hot = 0;
      for (let i = 0; i < pathIdx.length - 1; i++) {
        const a = nodes[pathIdx[i]], b = nodes[pathIdx[i + 1]];
        const edge = (level6Graph.adjacency?.[pathIdx[i]] || []).find(e => Number(e[0]) === Number(pathIdx[i + 1]));
        const d = edge ? Number(edge[1]) : l6Haversine(a.lon, a.lat, b.lon, b.lat);
        const r = l6EdgeRisk(pathIdx[i], pathIdx[i + 1]);
        lengthM += d;
        exposure += d * r;
        if (r >= threshold) hot += 1;
      }
      return {
        route_type: routeType,
        length_m: lengthM,
        length_km: lengthM / 1000,
        noise_integral: exposure,
        avg_norm_risk: lengthM ? exposure / lengthM : 0,
        hotspot_crossings: hot,
        node_count: pathIdx.length
      };
    }
    function l6UpdateMarkerSource() {
      if (!map.getSource('level6-click-markers')) return;
      const features = [];
      if (level6Selected.start) {
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [level6Selected.start.node.lon, level6Selected.start.node.lat] }, properties: { marker_type: 'start', name: 'Origin' } });
      }
      if (level6Selected.end) {
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [level6Selected.end.node.lon, level6Selected.end.node.lat] }, properties: { marker_type: 'end', name: 'Destination' } });
      }
      map.getSource('level6-click-markers').setData(l6FeatureCollection(features));
    }
    function l6ClearRoutes() {
      level6Selected = { start: null, end: null };
      level6Result = null;
      activeStage === 'level6' && updateLevel6Status();
      ['level6-route-shortest', 'level6-route-quiet', 'level6-route-anim-shortest', 'level6-route-anim-quiet'].forEach(id => {
        if (map.getSource(id)) map.getSource(id).setData(l6FeatureCollection([]));
      });
      l6UpdateMarkerSource();
      l6ResetMetrics();
    }
    function l6ResetMetrics() {
      ['l6-shortest-distance','l6-shortest-risk','l6-shortest-hot','l6-shortest-cost','l6-quiet-distance','l6-quiet-risk','l6-quiet-hot','l6-quiet-cost','l6-stat-reduction','l6-stat-distance','l6-stat-hotspots'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
      });
      ['l6-bar-short-distance','l6-bar-quiet-distance','l6-bar-short-risk','l6-bar-quiet-risk'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.width = '0%';
      });
      document.getElementById('l6-route-status').textContent = 'Waiting for two map clicks';
    }
    function updateLevel6Status() {
      document.getElementById('l6-start-name').textContent = level6Selected.start ? 'Selected' : 'Not selected';
      document.getElementById('l6-end-name').textContent = level6Selected.end ? 'Selected' : 'Not selected';
      const steps = document.querySelectorAll('#l6-click-status .status-step');
      steps.forEach(s => s.classList.remove('active'));
      if (!level6Selected.start) steps[0]?.classList.add('active');
      else if (!level6Selected.end) steps[1]?.classList.add('active');
      else steps[2]?.classList.add('active');
    }
    function l6UpdateMetrics() {
      if (!level6Result) return;
      const s = level6Result.metrics.shortest;
      const q = level6Result.metrics.quiet;
      document.getElementById('l6-shortest-distance').textContent = `${s.length_km.toFixed(2)} km`;
      document.getElementById('l6-shortest-risk').textContent = s.avg_norm_risk.toFixed(2);
      document.getElementById('l6-shortest-hot').textContent = s.hotspot_crossings;
      document.getElementById('l6-shortest-cost').textContent = compactNumber(s.noise_integral);
      document.getElementById('l6-quiet-distance').textContent = `${q.length_km.toFixed(2)} km`;
      document.getElementById('l6-quiet-risk').textContent = q.avg_norm_risk.toFixed(2);
      document.getElementById('l6-quiet-hot').textContent = q.hotspot_crossings;
      document.getElementById('l6-quiet-cost').textContent = compactNumber(q.noise_integral);
      const exposureReduction = 100 * (s.noise_integral - q.noise_integral) / Math.max(1e-9, s.noise_integral);
      const extraDistance = 100 * (q.length_m - s.length_m) / Math.max(1e-9, s.length_m);
      const hotspotsAvoided = s.hotspot_crossings - q.hotspot_crossings;
      document.getElementById('l6-stat-reduction').textContent = `${formatSigned(exposureReduction)}%`;
      document.getElementById('l6-stat-distance').textContent = `${formatSigned(extraDistance)}%`;
      document.getElementById('l6-stat-hotspots').textContent = hotspotsAvoided;
      const maxDist = Math.max(s.length_m, q.length_m, 1);
      const maxRisk = Math.max(s.noise_integral, q.noise_integral, 1);
      document.getElementById('l6-bar-short-distance').style.width = `${100 * s.length_m / maxDist}%`;
      document.getElementById('l6-bar-quiet-distance').style.width = `${100 * q.length_m / maxDist}%`;
      document.getElementById('l6-bar-short-risk').style.width = `${100 * s.noise_integral / maxRisk}%`;
      document.getElementById('l6-bar-quiet-risk').style.width = `${100 * q.noise_integral / maxRisk}%`;
      document.getElementById('l6-route-status').textContent = `Routes computed: ${formatSigned(exposureReduction)}% exposure change`;
    }
    function computeLevel6Routes() {
      if (!level6Selected.start || !level6Selected.end || !level6Graph) return;
      const startIdx = level6Selected.start.index;
      const endIdx = level6Selected.end.index;
      const shortestIdx = l6Dijkstra(startIdx, endIdx, 'shortest');
      const quietIdx = l6Dijkstra(startIdx, endIdx, 'quiet');
      if (!shortestIdx.length || !quietIdx.length) {
        document.getElementById('l6-route-status').textContent = 'No route found for the selected points';
        return;
      }
      const shortestFeature = l6PathToFeature(shortestIdx, 'shortest');
      const quietFeature = l6PathToFeature(quietIdx, 'quiet');
      level6Result = {
        shortestFeature,
        quietFeature,
        metrics: {
          shortest: l6Metrics(shortestIdx, 'shortest'),
          quiet: l6Metrics(quietIdx, 'quiet')
        }
      };
      map.getSource('level6-route-shortest').setData(l6FeatureCollection([shortestFeature]));
      map.getSource('level6-route-quiet').setData(l6FeatureCollection([quietFeature]));
      l6UpdateMetrics();
      setLevel6Focus('compare');
      startLevel6Animation();
    }
    function handleLevel6Click(lngLat) {
      if (activeStage !== 'level6') return;
      if (!level6Graph?.nodes?.length) {
        const status = document.getElementById('l6-route-status');
        if (status) status.textContent = 'Routing graph not loaded. Run level6_interactive_preprocess.py and refresh.';
        return;
      }
      const nearest = l6NearestNode(lngLat);
      if (!nearest) return;
      document.getElementById('l6-route-status').textContent = !level6Selected.start || (level6Selected.start && level6Selected.end) ? `Origin selected and snapped to H3 cell. Now click a destination.` : `Destination selected. Computing routes...`;
      if (!level6Selected.start || (level6Selected.start && level6Selected.end)) {
        l6ClearRoutes();
        level6Selected.start = nearest;
      } else {
        level6Selected.end = nearest;
      }
      l6UpdateMarkerSource();
      updateLevel6Status();
      if (level6Selected.start && level6Selected.end) computeLevel6Routes();
    }
    function lineSliceCoords(coords, progress) {
      if (!coords || coords.length <= 1) return coords || [];
      const p = Math.max(0, Math.min(1, progress));
      if (p <= 0) return [coords[0]];
      if (p >= 1) return coords.slice();
      const segLens = [];
      let total = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        segLens.push(len);
        total += len;
      }
      const target = total * p;
      let acc = 0;
      const out = [coords[0]];
      for (let i = 0; i < segLens.length; i++) {
        const len = segLens[i];
        const a = coords[i], b = coords[i + 1];
        if (acc + len < target) {
          out.push(b);
          acc += len;
          continue;
        }
        const remain = Math.max(0, target - acc);
        const t = len === 0 ? 0 : remain / len;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      return out;
    }
    function startLevel6Animation() {
      if (!level6Result || !map.getSource('level6-route-anim-shortest') || !map.getSource('level6-route-anim-quiet')) return;
      cancelAnimationFrame(level6AnimationFrame);
      const sCoords = level6Result.shortestFeature.geometry.coordinates || [];
      const qCoords = level6Result.quietFeature.geometry.coordinates || [];
      const sSource = map.getSource('level6-route-anim-shortest');
      const qSource = map.getSource('level6-route-anim-quiet');
      const duration = 4300;
      const startTs = performance.now();
      function frame(ts) {
        const t = Math.max(0, Math.min(1.08, (ts - startTs) / duration));
        const pShort = Math.max(0, Math.min(1, t / 0.58));
        const pQuiet = Math.max(0, Math.min(1, (t - 0.14) / 0.78));
        sSource.setData(l6FeatureCollection([{ type: 'Feature', properties: { route_type: 'shortest' }, geometry: { type: 'LineString', coordinates: lineSliceCoords(sCoords, pShort) } }]));
        qSource.setData(l6FeatureCollection([{ type: 'Feature', properties: { route_type: 'quiet' }, geometry: { type: 'LineString', coordinates: lineSliceCoords(qCoords, pQuiet) } }]));
        if (t < 1.05) level6AnimationFrame = requestAnimationFrame(frame);
      }
      level6AnimationFrame = requestAnimationFrame(frame);
    }
    function setLevel6Focus(mode) {
      level6Focus = mode;
      document.querySelectorAll('[data-l6-focus]').forEach(btn => btn.classList.toggle('active', btn.dataset.l6Focus === mode));
      ['l6-card-shortest', 'l6-card-quiet'].forEach(id => document.getElementById(id)?.classList.remove('active'));
      if (mode === 'shortest') document.getElementById('l6-card-shortest')?.classList.add('active');
      else if (mode === 'quiet') document.getElementById('l6-card-quiet')?.classList.add('active');
      else {
        document.getElementById('l6-card-shortest')?.classList.add('active');
        document.getElementById('l6-card-quiet')?.classList.add('active');
      }
      const shortMain = mode === 'quiet' ? 0.18 : 0.92;
      const quietMain = mode === 'shortest' ? 0.18 : 0.98;
      if (map.getLayer('l6-route-shortest')) map.setPaintProperty('l6-route-shortest', 'line-opacity', shortMain);
      if (map.getLayer('l6-route-quiet')) map.setPaintProperty('l6-route-quiet', 'line-opacity', quietMain);
      if (map.getLayer('l6-route-shortest-glow')) map.setPaintProperty('l6-route-shortest-glow', 'line-opacity', mode === 'quiet' ? 0.06 : 0.18);
      if (map.getLayer('l6-route-quiet-glow')) map.setPaintProperty('l6-route-quiet-glow', 'line-opacity', mode === 'shortest' ? 0.06 : 0.18);
    }
    function toggleLevel6Risk() {
      level6RiskVisible = !level6RiskVisible;
      document.getElementById('l6-toggle-risk').classList.toggle('active', level6RiskVisible);
      document.getElementById('l6-toggle-risk').textContent = level6RiskVisible ? 'Risk Field On' : 'Risk Field Off';
      setLayerVisibility(['l6-risk-fill', 'l6-risk-outline', 'l6-hotspot-halo', 'l6-hotspot-core'], activeStage === 'level6' && level6RiskVisible);
    }

    function addManhattanFocusLayers(boundaryGeojson, maskGeojson) {
      if (!boundaryGeojson?.features?.length || !maskGeojson?.features?.length) return;
      if (!map.getSource('manhattan-mask')) map.addSource('manhattan-mask', { type: 'geojson', data: maskGeojson });
      if (!map.getSource('manhattan-boundary')) map.addSource('manhattan-boundary', { type: 'geojson', data: boundaryGeojson });

      if (!map.getLayer('manhattan-outside-mask')) {
        map.addLayer({
          id: 'manhattan-outside-mask',
          type: 'fill',
          source: 'manhattan-mask',
          paint: {
            'fill-color': '#020712',
            'fill-opacity': 0.62
          }
        });
      }
      if (!map.getLayer('manhattan-focus-fill')) {
        map.addLayer({
          id: 'manhattan-focus-fill',
          type: 'fill',
          source: 'manhattan-boundary',
          paint: {
            'fill-color': 'rgba(0,234,255,0.018)',
            'fill-opacity': 1
          }
        });
      }
      if (!map.getLayer('manhattan-boundary-glow')) {
        map.addLayer({
          id: 'manhattan-boundary-glow',
          type: 'line',
          source: 'manhattan-boundary',
          paint: {
            'line-color': '#00eaff',
            'line-width': 7,
            'line-opacity': 0.22,
            'line-blur': 2.4
          }
        });
      }
      if (!map.getLayer('manhattan-boundary-line')) {
        map.addLayer({
          id: 'manhattan-boundary-line',
          type: 'line',
          source: 'manhattan-boundary',
          paint: {
            'line-color': '#00eaff',
            'line-width': 1.6,
            'line-opacity': 0.88
          }
        });
      }
    }

    function buildLevel6GraphFromRisk(riskGeojson) {
      const features = (riskGeojson?.features || []).filter(f => f.geometry);
      const nodes = features.map((f, i) => {
        const p = f.properties || {};
        const center = polygonCentroid(f) || (f.geometry.type === 'Point' ? f.geometry.coordinates : null);
        return {
          id: String(p.h3 || p.id || i),
          lon: Number(center?.[0]),
          lat: Number(center?.[1]),
          risk: Number(p.risk_norm || 0),
          risk_raw: Number(p.risk_raw || 0),
          risk_class: Number(p.risk_class || 1)
        };
      }).filter(n => Number.isFinite(n.lon) && Number.isFinite(n.lat));
      const adjacency = nodes.map(() => []);
      for (let i = 0; i < nodes.length; i++) {
        const candidates = [];
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const d = l6Haversine(nodes[i].lon, nodes[i].lat, nodes[j].lon, nodes[j].lat);
          candidates.push([j, d]);
        }
        candidates.sort((a, b) => a[1] - b[1]);
        adjacency[i] = candidates.slice(0, 6).map(d => [d[0], Math.round(d[1] * 1000) / 1000]);
      }
      const hotspots = [...nodes]
        .sort((a, b) => (Number(b.risk) || 0) - (Number(a.risk) || 0))
        .slice(0, 18)
        .map((n, idx) => ({ rank: idx + 1, id: n.id, lon: n.lon, lat: n.lat, risk: n.risk, risk_raw: n.risk_raw }));
      return {
        meta: {
          scenario_name: 'Interactive noise-aware routing',
          scenario_description: 'Click two points on the Manhattan sound field. Routes are computed in the browser.',
          routing_hour_label: '22:00',
          safe_risk_weight: 7.0,
          safe_risk_power: 1.8,
          hotspot_threshold: 0.78,
          hotspot_multiplier: 2.2,
          fallback_graph: true
        },
        nodes,
        adjacency,
        hotspots,
        stats: {
          node_count: nodes.length,
          edge_count: adjacency.reduce((s, a) => s + a.length, 0)
        }
      };
    }

    function addLevel6Layers(riskGeojson, graphJson) {
      level6Graph = graphJson;
      const hotspotFeatures = (graphJson.hotspots || []).map(h => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: { rank: h.rank, risk: h.risk, risk_raw: h.risk_raw }
      }));
      map.addSource('level6-risk', { type: 'geojson', data: riskGeojson });
      map.addSource('level6-hotspots', { type: 'geojson', data: l6FeatureCollection(hotspotFeatures) });
      map.addSource('level6-click-markers', { type: 'geojson', data: l6FeatureCollection([]) });
      map.addSource('level6-route-shortest', { type: 'geojson', data: l6FeatureCollection([]) });
      map.addSource('level6-route-quiet', { type: 'geojson', data: l6FeatureCollection([]) });
      map.addSource('level6-route-anim-shortest', { type: 'geojson', data: l6FeatureCollection([]) });
      map.addSource('level6-route-anim-quiet', { type: 'geojson', data: l6FeatureCollection([]) });

      map.addLayer({ id: 'l6-risk-fill', type: 'fill', source: 'level6-risk',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'risk_norm']], 0], 0, 'rgba(15,40,80,0.03)', 0.18, 'rgba(0,234,255,0.16)', 0.42, 'rgba(70,255,180,0.24)', 0.65, 'rgba(255,190,64,0.38)', 0.82, 'rgba(255,90,76,0.55)', 1, 'rgba(255,45,111,0.72)'],
          'fill-opacity': 0.96
        }
      });
      map.addLayer({ id: 'l6-risk-outline', type: 'line', source: 'level6-risk',
        paint: { 'line-color': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'risk_norm']], 0], 0, 'rgba(60,120,160,.18)', 1, 'rgba(255,110,130,.45)'], 'line-width': 0.7, 'line-opacity': 0.62 }
      });
      map.addLayer({ id: 'l6-hotspot-halo', type: 'circle', source: 'level6-hotspots',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'risk']], 0], 0, 10, 1, 28], 'circle-color': 'rgba(255,73,116,0.16)', 'circle-blur': 0.75 }
      });
      map.addLayer({ id: 'l6-hotspot-core', type: 'circle', source: 'level6-hotspots',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'risk']], 0], 0, 2, 1, 6], 'circle-color': '#ff547b', 'circle-stroke-color': 'rgba(255,255,255,.9)', 'circle-stroke-width': 0.8 }
      });
      map.addLayer({ id: 'l6-route-shortest-glow', type: 'line', source: 'level6-route-shortest', paint: { 'line-color': '#ffb84d', 'line-width': 12, 'line-opacity': 0.18, 'line-blur': 1.2 } });
      map.addLayer({ id: 'l6-route-shortest', type: 'line', source: 'level6-route-shortest', paint: { 'line-color': '#ffd24d', 'line-width': 4.3, 'line-opacity': 0.88 } });
      map.addLayer({ id: 'l6-route-quiet-glow', type: 'line', source: 'level6-route-quiet', paint: { 'line-color': '#00f5ff', 'line-width': 14, 'line-opacity': 0.18, 'line-blur': 1.3 } });
      map.addLayer({ id: 'l6-route-quiet', type: 'line', source: 'level6-route-quiet', paint: { 'line-color': '#00f5ff', 'line-width': 4.8, 'line-opacity': 0.96 } });
      map.addLayer({ id: 'l6-route-anim-shortest', type: 'line', source: 'level6-route-anim-shortest', paint: { 'line-color': '#ffef99', 'line-width': 7, 'line-opacity': 0.98, 'line-blur': 0.2 } });
      map.addLayer({ id: 'l6-route-anim-quiet', type: 'line', source: 'level6-route-anim-quiet', paint: { 'line-color': '#7effff', 'line-width': 8, 'line-opacity': 0.98, 'line-blur': 0.1 } });
      map.addLayer({ id: 'l6-marker-halo', type: 'circle', source: 'level6-click-markers', paint: { 'circle-radius': 16, 'circle-color': 'rgba(255,255,255,.18)', 'circle-blur': 0.65 } });
      map.addLayer({ id: 'l6-marker-core', type: 'circle', source: 'level6-click-markers',
        paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'marker_type'], 'start', '#ffffff', 'end', '#9ed8ff', '#ffffff'], 'circle-stroke-width': 1.2, 'circle-stroke-color': '#0b1628' }
      });
      map.addLayer({ id: 'l6-marker-label', type: 'symbol', source: 'level6-click-markers',
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-offset': [0, 1.5], 'text-anchor': 'top' },
        paint: { 'text-color': '#f7fbff', 'text-halo-color': 'rgba(5,10,19,.92)', 'text-halo-width': 1.2 }
      });

      setLayerVisibility(layerIds.level6, false);
      document.getElementById('l6-hour').textContent = graphJson.meta?.routing_hour_label || '--';
      document.getElementById('l6-cell-count').textContent = compactNumber(graphJson.stats?.node_count || graphJson.nodes?.length || 0);
      document.getElementById('l6-route-status').textContent = 'Click the map to choose origin';
      updateLevel6Status();
    }

    function setStage(stage) {
      if (activeStage === stage) return;
      activeStage = stage;
      document.body.dataset.stage = stage;
      closePanel();
      hideTooltip();
      navDots.forEach(dot => dot.classList.toggle('active', dot.dataset.target === stage));

      if (stage === 'level1') map.scrollZoom.disable();
      else map.scrollZoom.enable();

      setLayerVisibility(layerIds.level1, stage === 'level1');
      setLayerVisibility(layerIds.level2, stage === 'level2');
      setLayerVisibility(layerIds.level3, stage === 'level3');
      setLayerVisibility(layerIds.level4, stage === 'level4');
      setLayerVisibility(layerIds.level5, stage === 'level5');
      setLayerVisibility(layerIds.level6, stage === 'level6');
      setLayerVisibility(layerIds.level7, stage === 'level7');
      if (stage === 'level2') {
        setLevel2Hour(currentHour);
      }
      if (stage === 'level1') {
        if (!document.getElementById('hotspotBtn').classList.contains('active')) {
          setLayerVisibility(['hotspot-halo', 'hotspot-core'], false);
        }
      }
      if (stage === 'level3') {
        applyLevel3Hour(currentL3Hour);
        applySourceFilter();
        setLayerVisibility(['l3-source-halo', 'l3-source-core', 'l3-source-labels'], sourceVisible);
        setLayerVisibility(['l3-source-lines', 'l3-source-line-glow'], sourceLinesVisible);
      }
      if (stage === 'level4') {
        if (activeClusterId === null && level4Summary?.clusters?.length) activeClusterId = level4Summary.clusters[0].cluster_id;
        if (activeClusterId !== null) focusCluster(activeClusterId, false);
      }
      if (stage === 'level5') {
        stopL2Play();
        stopL3Play();
        setLayerVisibility(realSourcePointLayerIds, false);
        setLayerVisibility(realTransitLineLayerIds, false);
        if (level5Data && level5Summary) {
          renderLevel5();
        }
      }
      if (stage === 'level6') {
        stopL2Play();
        stopL3Play();
        setLayerVisibility(realSourcePointLayerIds, false);
        setLayerVisibility(realTransitLineLayerIds, false);
        level6RiskVisible = true;
        document.getElementById('l6-toggle-risk').classList.add('active');
        document.getElementById('l6-toggle-risk').textContent = 'Risk Field On';
        setLayerVisibility(['l6-risk-fill', 'l6-risk-outline', 'l6-hotspot-halo', 'l6-hotspot-core'], true);
        setLevel6Focus(level6Focus);
        updateLevel6Status();
        if (!level6Graph?.nodes?.length) {
          document.getElementById('l6-route-status').textContent = 'Routing graph not loaded. Run level6_interactive_preprocess.py first, then reload the page';
        } else if (!level6Selected.start) {
          document.getElementById('l6-route-status').textContent = `Ready: click anywhere on the map to select an origin (${compactNumber(level6Graph.nodes.length)} graph cells loaded)`;
        }
      }
      if (stage === 'level7') {
        stopL2Play();
        stopL3Play();
        setLayerVisibility(realSourcePointLayerIds, false);
        setLayerVisibility(realTransitLineLayerIds, false);
      }
      applyRealSourceVisibility();

      map.stop();
      map.flyTo({ ...(views[stage] || views.level1), duration: 1100, essential: true });
    }

    document.getElementById('rotateBtn').addEventListener('click', () => {
      isRotating = !isRotating;
      document.getElementById('rotateBtn').classList.toggle('active', isRotating);
      currentBearing = map.getBearing();
    });
    document.getElementById('hotspotBtn').addEventListener('click', () => {
      const btn = document.getElementById('hotspotBtn');
      btn.classList.toggle('active');
      const visible = btn.classList.contains('active') && activeStage === 'level1';
      setLayerVisibility(['hotspot-halo', 'hotspot-core'], visible);
    });
    document.getElementById('resetBtn').addEventListener('click', () => resetLevel1View(true));
    document.querySelectorAll('[data-l1-story]').forEach(btn => btn.addEventListener('click', () => setLevel1Story(btn.dataset.l1Story)));

    document.getElementById('hourSlider').addEventListener('input', e => {
      stopL2Play();
      document.querySelectorAll('[data-l2-story]').forEach(b => b.classList.remove('active'));
      l2FocusCategory = null;
      renderLevel2Chart();
      setLevel2Hour(e.target.value);
    });
    document.getElementById('playHourBtn').addEventListener('click', () => l2PlayTimer ? stopL2Play() : startL2Play());
    function startL2Play() {
      document.querySelectorAll('[data-l2-story]').forEach(b => b.classList.remove('active'));
      l2FocusCategory = null;
      renderLevel2Chart();
      document.getElementById('playHourBtn').textContent = '❚❚ Pause';
      document.getElementById('playHourBtn').classList.add('active');
      l2PlayTimer = setInterval(() => setLevel2Hour((currentHour + 1) % 24), 850);
    }
    function stopL2Play() { if (l2PlayTimer) clearInterval(l2PlayTimer); l2PlayTimer = null; document.getElementById('playHourBtn').textContent = '▶ Play'; document.getElementById('playHourBtn').classList.remove('active'); }

    function selectLevel2DayType(dayType) {
      activeDayType = dayType;
      document.querySelectorAll('[data-day]').forEach(b => b.classList.toggle('active', b.dataset.day === activeDayType));
      updateLevel2Stats(level2RawData?.meta?.summaries?.[activeDayType]);
      renderLevel2Chart();
      setLevel2Hour(currentHour);
    }

    const level2Stories = {
      night: {
        hour: 22,
        day: 'All days',
        focus: 'Residential Music / Party',
        title: 'Night rhythm: social noise becomes the dominant temporal signature.',
        text: 'Late evening is where residential party/music complaints and commercial nightlife begin to separate from daytime urban activity. The right map now acts as a quiet spatial echo of the selected hour, while the ridgeline remains the main temporal argument.'
      },
      morning: {
        hour: 8,
        day: 'Weekday',
        focus: 'Vehicle / Aerial Traffic',
        title: 'Morning rhythm: mobility noise starts shaping the day.',
        text: 'The selected weekday morning view highlights transport-related and street activity as the city shifts from residential quietness into commuting and service movement.'
      },
      daywork: {
        hour: 10,
        day: 'Weekday',
        focus: 'Construction / Equipment',
        title: 'Daytime rhythm: construction has its own clock.',
        text: 'Construction and equipment complaints are not simply high-noise places. They are time-regulated pulses that rise during working hours and fade at night.'
      },
      quiet: {
        hour: 4,
        day: 'All days',
        focus: null,
        title: 'Quiet trough: the baseline of the acoustic city.',
        text: 'The pre-dawn trough provides a reference condition. It helps the audience see later peaks as deviations from the city’s low-noise baseline.'
      }
    };

    function setLevel2Story(key) {
      const story = level2Stories[key];
      if (!story) return;
      stopL2Play();
      document.querySelectorAll('[data-l2-story]').forEach(b => b.classList.toggle('active', b.dataset.l2Story === key));
      l2FocusCategory = story.focus;
      currentHour = story.hour;
      selectLevel2DayType(story.day);
      setLevel2Hour(story.hour);
      document.getElementById('l2-hour-context').innerHTML = `<strong>${story.title}</strong><br>${story.text}`;
      document.getElementById('l2-callout-title').textContent = story.title.split(':')[0];
      document.getElementById('l2-callout-text').textContent = story.text;
      map.stop();
      map.flyTo({ ...views.level2, bearing: views.level2.bearing + (story.hour - 12) * 0.35, duration: 900, essential: true });
    }

    document.querySelectorAll('[data-day]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('[data-l2-story]').forEach(b => b.classList.remove('active'));
      l2FocusCategory = null;
      selectLevel2DayType(btn.dataset.day);
    }));
    document.querySelectorAll('[data-l2-story]').forEach(btn => btn.addEventListener('click', () => setLevel2Story(btn.dataset.l2Story)));
    document.getElementById('modeBtn').addEventListener('click', () => {
      useShapeMode = !useShapeMode;
      document.getElementById('modeBtn').textContent = useShapeMode ? 'Shape Mode' : 'Volume Mode';
      document.getElementById('modeBtn').classList.toggle('active', useShapeMode);
      renderLevel2Chart();
    });

    document.getElementById('hourSlider3').addEventListener('input', e => { stopL3Play(); applyLevel3Hour(e.target.value); });
    document.getElementById('playL3Btn').addEventListener('click', () => l3PlayTimer ? stopL3Play() : startL3Play());
    function startL3Play() { document.getElementById('playL3Btn').textContent = '❚❚ Pause'; document.getElementById('playL3Btn').classList.add('active'); l3PlayTimer = setInterval(() => applyLevel3Hour((currentL3Hour + 1) % 24), 850); }
    function stopL3Play() { if (l3PlayTimer) clearInterval(l3PlayTimer); l3PlayTimer = null; document.getElementById('playL3Btn').textContent = '▶ Play'; document.getElementById('playL3Btn').classList.remove('active'); }

    document.querySelectorAll('[data-metric]').forEach(btn => btn.addEventListener('click', () => {
      setL3Metric(btn.dataset.metric);
      document.querySelectorAll('[data-l3-scenario]').forEach(b => b.classList.remove('active'));
    }));
    document.querySelectorAll('[data-l3-scenario]').forEach(btn => btn.addEventListener('click', () => setLevel3Scenario(btn.dataset.l3Scenario)));
    document.getElementById('sourceToggleBtn').addEventListener('click', () => {
      sourceVisible = !sourceVisible;
      document.getElementById('sourceToggleBtn').classList.toggle('active', sourceVisible);
      if (activeStage === 'level3') setLayerVisibility(['l3-source-halo', 'l3-source-core', 'l3-source-labels'], sourceVisible);
      applyRealSourceVisibility();
    });
    document.getElementById('lineToggleBtn').addEventListener('click', () => {
      sourceLinesVisible = !sourceLinesVisible;
      document.getElementById('lineToggleBtn').classList.toggle('active', sourceLinesVisible);
      if (activeStage === 'level3') setLayerVisibility(['l3-source-lines', 'l3-source-line-glow'], sourceLinesVisible);
      applyRealSourceVisibility();
    });

    document.querySelectorAll('[data-l5-mode]').forEach(btn => btn.addEventListener('click', () => setLevel5Mode(btn.dataset.l5Mode)));

    document.querySelectorAll('[data-l6-focus]').forEach(btn => btn.addEventListener('click', () => setLevel6Focus(btn.dataset.l6Focus)));
    document.getElementById('l6-clear-btn').addEventListener('click', () => l6ClearRoutes());
    document.getElementById('l6-replay-btn').addEventListener('click', () => startLevel6Animation());
    document.getElementById('l6-toggle-risk').addEventListener('click', () => toggleLevel6Risk());
    ['l6-card-shortest', 'l6-card-quiet'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => setLevel6Focus(el.dataset.l6Focus));
    });

    document.getElementById('l5-priority-btn').addEventListener('click', () => {
      showPriorityOnly = !showPriorityOnly;
      document.getElementById('l5-priority-btn').classList.toggle('active', showPriorityOnly);
      updateLevel5Stats();
      renderLevel5Scatter();
      renderLevel5MiniMap();
    });
    document.getElementById('l5-reset-selection').addEventListener('click', () => {
      showPriorityOnly = false;
      document.getElementById('l5-priority-btn').classList.remove('active');
      updateLevel5DefaultProfile();
      renderLevel5Scatter();
      renderLevel5MiniMap();
    });

    document.querySelectorAll('.cover-actions [data-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const el = document.getElementById(target);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
        if (target && target !== activeStage) setStage(target);
      });
    });

    navDots.forEach(dot => dot.addEventListener('click', () => {
      const target = dot.dataset.target;
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      if (target && target !== activeStage) setStage(target);
    }));

    document.querySelectorAll('.spine-step').forEach(step => {
      step.addEventListener('click', () => {
        const target = step.dataset.stage;
        const el = target ? document.getElementById(target) : null;
        if (el) el.scrollIntoView({ behavior: 'smooth' });
        if (target && target !== activeStage) setStage(target);
      });
    });

    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setStage(visible.target.dataset.stage);
    }, { threshold: [0.45, 0.58, 0.72] });
    document.querySelectorAll('.scroll-step').forEach(step => observer.observe(step));

    map.on('click', e => { if (activeStage === 'level6') handleLevel6Click(e.lngLat); });

    let level6LastPickTs = 0;
    function isLevel6MapPickEvent(event) {
      if (activeStage !== 'level6') return false;
      const target = event.target;
      if (target && target.closest) {
        if (target.closest('.level6-left, .level6-right, .story-spine, .side-panel, .level-nav, .mapboxgl-ctrl, .tooltip')) return false;
      }
      const rect = map.getContainer().getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }
    function pickLevel6PointFromScreen(event) {
      const now = performance.now();
      if (now - level6LastPickTs < 120) return;
      level6LastPickTs = now;
      const rect = map.getContainer().getBoundingClientRect();
      const point = [event.clientX - rect.left, event.clientY - rect.top];
      const lngLat = map.unproject(point);
      handleLevel6Click(lngLat);
    }

    document.addEventListener('pointerdown', event => {
      if (!isLevel6MapPickEvent(event)) return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pickLevel6PointFromScreen(event);
    }, true);

    map.getCanvas().addEventListener('pointerdown', event => {
      if (activeStage !== 'level6') return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pickLevel6PointFromScreen(event);
    }, true);

    document.addEventListener('click', event => {
      if (!isLevel6MapPickEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      pickLevel6PointFromScreen(event);
    }, true);

    map.getContainer().addEventListener('wheel', event => {
      if (activeStage === 'level1') {
        event.preventDefault();
        event.stopPropagation();
        const level2 = document.getElementById('level2');
        if (level2) level2.scrollIntoView({ behavior: 'smooth' });
        if (activeStage !== 'level2') setStage('level2');
        return;
      }
      if (!event.target.closest('.stage-ui, .story-spine, .side-panel')) {
        event.stopPropagation();
      }
    }, { passive: false });

    ['dragstart','rotatestart','pitchstart','zoomstart'].forEach(evt => map.on(evt, e => { if (e.originalEvent) userInteracting = true; }));
    ['dragend','rotateend','pitchend','zoomend'].forEach(evt => map.on(evt, e => { if (e.originalEvent) setTimeout(() => { userInteracting = false; currentBearing = map.getBearing(); }, 700); }));

    map.on('load', async () => {
      try {
        map.setFog({ range: [.4, 9], color: '#06101f', 'high-color': '#1b335f', 'space-color': '#000000', 'star-intensity': .05 });
        try { map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 1.65, position: [1.2, 180, 45] }); } catch(e) {}
        map.getStyle().layers.forEach(layer => { if (layer.id.includes('building')) map.setLayoutProperty(layer.id, 'visibility', 'none'); });

        const [level1, level2Building, h3Grid, sourcePoints, sourceLines, level4Clusters, realBusRoutes, realSubwayStations, realNightlifePoi, level5Tracts, level6Risk, level6GraphJson, manhattanBoundary, manhattanMask] = await Promise.all([
          fetchJSON(LEVEL1_DATA_URL),
          fetchJSON(LEVEL2_BUILDING_HOURLY_URL),
          fetchJSON(LEVEL3_H3_URL),
          fetchJSON(LEVEL3_SOURCE_POINTS_URL),
          fetchJSON(LEVEL3_SOURCE_LINES_URL, false),
          fetchJSON(LEVEL4_CLUSTER_URL),
          fetchJSON(REAL_BUS_ROUTES_URL, false),
          fetchJSON(REAL_SUBWAY_STATIONS_URL, false),
          fetchJSON(REAL_NIGHTLIFE_POI_URL, false),
          fetchJSON(LEVEL5_TRACTS_URL),
          fetchJSON(LEVEL6_RISK_URL, false),
          fetchJSON(LEVEL6_GRAPH_URL, false),
        ]);

        addLevel1Layers(level1);
        addLevel2MapLayer(level2Building);
        addLevel3Layers(h3Grid, sourcePoints, sourceLines);
        addLevel4Layers(level4Clusters);
        addRealSourceLayers(realBusRoutes, realSubwayStations, realNightlifePoi);
        if ((level6Risk?.features || []).length) {
          const l6GraphForUse = (level6GraphJson?.nodes || []).length ? level6GraphJson : buildLevel6GraphFromRisk(level6Risk);
          addLevel6Layers(level6Risk, l6GraphForUse);
        }

        level2RawData = await fetchJSON(LEVEL2_DATA_URL);
        updateLevel2Stats(level2RawData.meta.summaries[activeDayType]);
        renderLevel2Chart();
        setLevel2Hour(currentHour);

        level3Summary = await fetchJSON(LEVEL3_SUMMARY_URL);
        updateLevel3Stats(currentL3Hour);
        renderLevel3BarChart();
        applyLevel3Hour(currentL3Hour);

        level4Summary = await fetchJSON(LEVEL4_SUMMARY_URL);
        level5Data = level5Tracts;
        level5Summary = await fetchJSON(LEVEL5_SUMMARY_URL, false);
        if (!level5Summary || !level5Summary.tract_count) level5Summary = buildLevel5FallbackSummary();
        renderLevel4Cards();
        if (level4Summary.clusters && level4Summary.clusters.length) {
          activeClusterId = level4Summary.clusters[0].cluster_id;
          focusCluster(activeClusterId, false);
        }
        updateLevel4Stats();
        renderLevel5();
        setLevel3Scenario('nightlife');
        setLayerVisibility(['hotspot-halo', 'hotspot-core', 'building-hover-glow', 'building-hover-top'], false);

        setLayerVisibility(layerIds.level2, false);
        setLayerVisibility(layerIds.level3, false);
        setLayerVisibility(layerIds.level4, false);
        setLayerVisibility(layerIds.level6, false);
        setLayerVisibility(realSourcePointLayerIds, false);
        setLayerVisibility(realTransitLineLayerIds, false);

        requestAnimationFrame(function animate(ts) {
          if (isRotating && !userInteracting && activeStage === 'level1') {
            currentBearing = (currentBearing + .035) % 360;
            map.rotateTo(currentBearing, { duration: 0 });
          }
          if (map.getLayer('hotspot-halo') && activeStage === 'level1') {
            const breath = 1 + .16 * Math.sin(ts / 650);
            map.setPaintProperty('hotspot-halo', 'circle-radius', ['interpolate', ['linear'], ['to-number', ['get', 'noise_count']], 5, 7 * breath, 20, 18 * breath, 70, 36 * breath]);
          }
          requestAnimationFrame(animate);
        });

        setTimeout(() => loading.classList.add('hidden'), 450);
      } catch (err) {
        console.error(err);
        const title = loading.querySelector('.loader-title');
        const sub = loading.querySelector('.loader-sub');
        if (title) title.textContent = 'Some optional data did not load';
        if (sub) sub.textContent = err.message || 'Check filenames and run through a local server.';
        setTimeout(() => loading.classList.add('hidden'), 900);
      }
    });

    window.addEventListener('resize', () => { renderLevel2Chart(); renderLevel3BarChart(); if (level4Summary) renderClusterPca(); if (level5Data) { renderLevel5Scatter(); renderLevel5MiniMap(); } });
