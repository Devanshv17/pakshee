"""
Pakshee - Spatial Audit: Validate GeoJSON integrity, spatial coverage, and AQI distributions
"""

from pathlib import Path
import json
import geopandas as gpd
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
STATIONS_PATH = BASE_DIR / "data" / "processed" / "stations.geojson"
DISTRICTS_PATH = BASE_DIR / "data" / "processed" / "districts.geojson"

# Bounding box of sovereign India territory
INDIA_BBOX = [68.0, 6.0, 98.0, 38.0]  # [min_lon, min_lat, max_lon, max_lat]


def audit_pipeline():
    print("==================================================")
    print("        PAKSHEE SPATIAL & DATA QUALITY AUDIT      ")
    print("==================================================")

    # 1. Audit Stations
    if not STATIONS_PATH.exists():
        print(f"[FAIL] stations.geojson not found at {STATIONS_PATH}")
        return False

    print(f"\n[1] Auditing Air Quality Stations ({STATIONS_PATH.name})...")
    with open(STATIONS_PATH, "r") as f:
        meta = json.load(f).get("metadata", {})
    
    print(f"    Metadata Source: {meta.get('source')}")
    print(f"    Generated: {meta.get('generated')}")

    gdf_stations = gpd.read_file(STATIONS_PATH)
    total_stations = len(gdf_stations)
    print(f"    Total Features: {total_stations}")

    # Geometry integrity
    null_geom = gdf_stations.geometry.isnull().sum()
    empty_geom = gdf_stations.geometry.is_empty.sum()
    invalid_geom = (~gdf_stations.geometry.is_valid).sum()
    print(f"    Geometry checks: null={null_geom}, empty={empty_geom}, invalid={invalid_geom}")

    # Spatial bounds
    bounds = gdf_stations.total_bounds  # [minx, miny, maxx, maxy]
    print(f"    Spatial Extent: lon [{bounds[0]:.2f}, {bounds[2]:.2f}], lat [{bounds[1]:.2f}, {bounds[3]:.2f}]")

    in_india = (
        (gdf_stations.geometry.x >= INDIA_BBOX[0]) & 
        (gdf_stations.geometry.x <= INDIA_BBOX[2]) &
        (gdf_stations.geometry.y >= INDIA_BBOX[1]) & 
        (gdf_stations.geometry.y <= INDIA_BBOX[3])
    ).sum()
    print(f"    Stations within India territory: {in_india}/{total_stations} ({round(in_india/total_stations*100, 1)}%)")

    # PM2.5 and AQI Breakdown
    pm25_vals = pd.to_numeric(gdf_stations["pm25"], errors="coerce").dropna()
    print(f"\n    PM2.5 Measurements:")
    print(f"      Valid Readings: {len(pm25_vals)}/{total_stations}")
    if len(pm25_vals) > 0:
        print(f"      Min: {pm25_vals.min():.1f} µg/m³")
        print(f"      Mean: {pm25_vals.mean():.1f} µg/m³")
        print(f"      Max: {pm25_vals.max():.1f} µg/m³")

    if "aqiCategory" in gdf_stations.columns:
        cat_counts = gdf_stations["aqiCategory"].value_counts().to_dict()
        print(f"\n    NAQI Category Distribution:")
        for cat, cnt in sorted(cat_counts.items(), key=lambda x: -x[1]):
            print(f"      {cat:<14}: {cnt:>4} stations")

    # 2. Audit Districts / Bias Layer
    if DISTRICTS_PATH.exists():
        print(f"\n[2] Auditing Districts Bias Layer ({DISTRICTS_PATH.name})...")
        gdf_dist = gpd.read_file(DISTRICTS_PATH)
        print(f"    Total Districts: {len(gdf_dist)}")
        if "station_count" in gdf_dist.columns:
            monitored = (gdf_dist["station_count"] > 0).sum()
            silent = (gdf_dist["station_count"] == 0).sum()
            print(f"    Monitored Districts: {monitored}")
            print(f"    Silent Zones (0 monitors): {silent}")
            if "bias_category" in gdf_dist.columns:
                print(f"\n    Bias Classification Breakdown:")
                for b_cat, b_cnt in gdf_dist["bias_category"].value_counts().items():
                    print(f"      {b_cat:<22}: {b_cnt:>4} districts")
    else:
        print(f"\n[2] districts.geojson not yet generated (run fetch_districts.py).")

    print("\n==================================================")
    print("                 AUDIT COMPLETE                   ")
    print("==================================================")
    return True


if __name__ == "__main__":
    audit_pipeline()
