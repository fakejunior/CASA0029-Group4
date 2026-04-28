# The Manhattan Soundscape

This is the modular project folder for the final visualization.

## Folder structure

- `index.html`: main webpage
- `assets/css/main.css`: visual styles
- `assets/js/config.js`: map settings and data file paths
- `assets/js/app.js`: map interaction and chart logic
- `assets/data/`: GeoJSON and JSON data files
- `project-info/`: project information file

## Required data files

- `level1_nyc_noise.geojson`
- `level2_ridgeline.json`
- `level2_building_hourly.geojson`
- `level3_h3_hourly.geojson`
- `level3_source_points.geojson`
- `level3_summary.json`
- `level3_source_lines.geojson`
- `real_bus_routes_manhattan.geojson`
- `real_subway_stations_manhattan.geojson`
- `real_nightlife_poi_manhattan.geojson`
- `level4_soundscape_clusters.geojson`
- `level4_cluster_summary.json`
- `level5_noise_equity_tracts.geojson`
- `level5_equity_summary.json`
- `level6_risk_field.geojson`
- `level6_route_graph.json`
- `manhattan_boundary.geojson`
- `manhattan_outside_mask.geojson`

## Local preview

Run a local server in this folder:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

Upload this folder to a GitHub repository and enable GitHub Pages from the `main` branch and root folder.
