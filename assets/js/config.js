const LEVEL1_DATA_URL = './assets/data/level1_nyc_noise.geojson';
    const LEVEL2_DATA_URL = './assets/data/level2_ridgeline.json';
    const LEVEL2_BUILDING_HOURLY_URL = './assets/data/level2_building_hourly.geojson';
    const LEVEL3_H3_URL = './assets/data/level3_h3_hourly.geojson';
    const LEVEL3_SOURCE_POINTS_URL = './assets/data/level3_source_points.geojson';
    const LEVEL3_SUMMARY_URL = './assets/data/level3_summary.json';
    const LEVEL3_SOURCE_LINES_URL = './assets/data/level3_source_lines.geojson';
    const REAL_BUS_ROUTES_URL = './assets/data/real_bus_routes_manhattan.geojson';
    const REAL_SUBWAY_STATIONS_URL = './assets/data/real_subway_stations_manhattan.geojson';
    const REAL_NIGHTLIFE_POI_URL = './assets/data/real_nightlife_poi_manhattan.geojson';
    const LEVEL4_CLUSTER_URL = './assets/data/level4_soundscape_clusters.geojson';
    const LEVEL4_SUMMARY_URL = './assets/data/level4_cluster_summary.json';
    const LEVEL5_TRACTS_URL = './assets/data/level5_noise_equity_tracts.geojson';
    const LEVEL5_SUMMARY_URL = './assets/data/level5_equity_summary.json';
    const LEVEL6_RISK_URL = './assets/data/level6_risk_field.geojson';
    const LEVEL6_GRAPH_URL = './assets/data/level6_route_graph.json';

    mapboxgl.accessToken = 'pk.eyJ1IjoidmFudGFnZXpjeSIsImEiOiJjbWw1a2VwdzcwMzB0M2dxeHVtc2M4dTlrIn0.siJahQOxZfH6G46LjEVDag';

    const views = {
      level1: { center: [-73.985, 40.748], zoom: 15.45, pitch: 67, bearing: -24 },
      level2: { center: [-73.985, 40.755], zoom: 14.35, pitch: 61, bearing: -18 },
      level3: { center: [-73.985, 40.755], zoom: 13.55, pitch: 58, bearing: -24 },
      level4: { center: [-73.985, 40.765], zoom: 12.85, pitch: 48, bearing: -20 },
      level5: { center: [-73.985, 40.765], zoom: 11.85, pitch: 0, bearing: 0 },
      level6: { center: [-73.991, 40.738], zoom: 12.35, pitch: 0, bearing: 0 },
      level7: { center: [-73.985, 40.755], zoom: 11.8, pitch: 0, bearing: 0 }
    };

    const layerIds = {
      level1: ['buildings-main', 'building-roof-outline', 'hotspot-halo', 'hotspot-core', 'building-hover-glow', 'building-hover-top'],
      level2: ['buildings-hourly-stage2'],
      level3: ['h3-hex-extrusion', 'h3-hex-outline', 'l3-source-lines', 'l3-source-line-glow', 'l3-source-halo', 'l3-source-core', 'l3-source-labels'],
      level4: ['l4-cluster-extrusion', 'l4-cluster-outline', 'l4-cluster-highlight', 'l4-cluster-centers'],
      level5: [],
      level6: ['l6-risk-fill', 'l6-risk-outline', 'l6-hotspot-halo', 'l6-hotspot-core', 'l6-route-shortest-glow', 'l6-route-shortest', 'l6-route-quiet-glow', 'l6-route-quiet', 'l6-route-anim-shortest', 'l6-route-anim-quiet', 'l6-marker-halo', 'l6-marker-core', 'l6-marker-label'],
      level7: []
    };

    const realSourcePointLayerIds = [
      'real-nightlife-halo', 'real-nightlife-core', 'real-nightlife-labels',
      'real-subway-halo', 'real-subway-core', 'real-subway-labels'
    ];
    const realTransitLineLayerIds = ['real-bus-routes-glow', 'real-bus-routes'];

    const sourceColors = {
      residential: '#00eaff',
      nightlife: '#ff2d6f',
      street: '#ff9f1c',
      transit: '#47ffb3',
      construction: '#fff37a',
      mechanical: '#b388ff',
      other: '#9aa4b2',
      none: '#9aa4b2'
    };

    const sourceLabels = {
      residential: 'Residential conflict',
      nightlife: 'Bar / nightlife',
      street: 'Street / sidewalk',
      transit: 'Transit / vehicle',
      construction: 'Construction',
      mechanical: 'Mechanical / alarm',
      other: 'Public / other',
      none: 'None'
    };

    const noiseValue = [
      'coalesce',
      ['to-number', ['get', 'noise_count']],
      ['to-number', ['get', 'Noise_Count']],
      ['to-number', ['get', 'NOISE_COUNT']],
      0
    ];

    const extrusionHeight = [
      'interpolate', ['linear'], noiseValue,
      0, 4, 1, 20, 3, 48, 5, 90, 10, 148, 15, 210, 25, 300, 40, 410, 70, 560
    ];
