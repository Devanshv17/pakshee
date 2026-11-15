"""
Pakshee - Spatial Pipeline: Process India District Boundaries & Compute Monitoring Bias Layer
"""

import json
import os
from pathlib import Path
import requests
import geopandas as gpd

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DISTRICT_PATH = BASE_DIR / "data" / "raw" / "india_district.geojson"
PROCESSED_DISTRICT_PATH = BASE_DIR / "data" / "processed" / "districts.geojson"
STATIONS_PATH = BASE_DIR / "data" / "processed" / "stations.geojson"

DISTRICT_GEOJSON_URL = "https://raw.githubusercontent.com/geohacker/india/master/district/india_district.geojson"

# State-level baseline population density estimates (Census 2011, persons/sq km)
STATE_POP_DENSITY = {
    "Delhi": 11320,
    "Chandigarh": 9258,
    "Puducherry": 2547,
    "Bihar": 1106,
    "West Bengal": 1028,
    "Kerala": 860,
    "Uttar Pradesh": 829,
    "Haryana": 573,
    "Tamil Nadu": 555,
    "Punjab": 551,
    "Jharkhand": 414,
    "Assam": 398,
    "Goa": 394,
    "Maharashtra": 365,
    "Tripura": 350,
    "Karnataka": 319,
    "Gujarat": 308,
    "Andhra Pradesh": 303,
    "Rajasthan": 200,
    "Madhya Pradesh": 236,
    "Chhattisgarh": 189,
    "Uttarakhand": 189,
    "Odisha": 270,
    "Himachal Pradesh": 123,
    "Jammu and Kashmir": 56,
}


def build_districts_bias_layer():
    RAW_DISTRICT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROCESSED_DISTRICT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 1. Download if missing
    if not RAW_DISTRICT_PATH.exists():
        print(f"[1/4] Downloading raw India district boundaries from GitHub...")
        r = requests.get(DISTRICT_GEOJSON_URL, timeout=40)
        with open(RAW_DISTRICT_PATH, "wb") as f:
            f.write(r.content)
        print(f"      Downloaded {round(len(r.content)/1024/1024, 2)} MB.")
    else:
        print(f"[1/4] Using cached raw district boundaries.")

    # 2. Read and simplify
    print(f"[2/4] Reading and simplifying geometries for web rendering...")
    districts = gpd.read_file(RAW_DISTRICT_PATH)
    districts = districts[['NAME_1', 'NAME_2', 'geometry']].rename(
        columns={'NAME_1': 'state', 'NAME_2': 'district'}
    )
    if districts.crs is None:
        districts.set_crs(epsg=4326, inplace=True)
    elif districts.crs.to_epsg() != 4326:
        districts = districts.to_crs(epsg=4326)

    # Simplify coordinates (~1-2km tolerance) for lightweight browser rendering
    districts['geometry'] = districts['geometry'].simplify(0.015, preserve_topology=True)

    # 3. Spatial Join with Stations to count monitors per district
    print(f"[3/4] Performing spatial join against air quality stations...")
    station_counts = {}
    if STATIONS_PATH.exists():
        try:
            stations = gpd.read_file(STATIONS_PATH)
            if stations.crs is None:
                stations.set_crs(epsg=4326, inplace=True)
            elif stations.crs.to_epsg() != 4326:
                stations = stations.to_crs(epsg=4326)

            # Spatial join points inside polygons
            joined = gpd.sjoin(stations, districts, how="inner", predicate="intersects")
            # Count stations per district index
            counts = joined.groupby('index_right').size()
            station_counts = counts.to_dict()
            print(f"      Mapped stations to {len(station_counts)} monitored districts.")
        except Exception as e:
            print(f"      [Warning] Could not spatially join stations: {e}")

    # 4. Compute bias indicators
    print(f"[4/4] Calculating bias scores and silent zones...")
    districts['station_count'] = [station_counts.get(idx, 0) for idx in districts.index]

    def get_bias_tier(row):
        cnt = row['station_count']
        state = row['state']
        density = STATE_POP_DENSITY.get(state, 350)
        if cnt == 0 and density >= 400:
            return "Critical Silent Zone"  # High density, zero official monitors
        elif cnt == 0:
            return "Silent Zone"           # Moderate/low density, zero monitors
        elif cnt <= 2:
            return "Sparse Monitoring"
        else:
            return "Well Monitored"

    districts['bias_category'] = districts.apply(get_bias_tier, axis=1)
    districts['is_silent'] = districts['station_count'] == 0
    districts['density_est'] = [STATE_POP_DENSITY.get(s, 350) for s in districts['state']]

    # Write processed GeoJSON
    districts.to_file(PROCESSED_DISTRICT_PATH, driver="GeoJSON")
    size_kb = round(os.path.getsize(PROCESSED_DISTRICT_PATH) / 1024, 1)
    print(f"Successfully generated {PROCESSED_DISTRICT_PATH.name} ({size_kb} KB):")
    print(f"  - Total Districts: {len(districts)}")
    print(f"  - Silent Zones: {sum(districts['is_silent'])}")
    print(f"  - Monitored Districts: {len(districts) - sum(districts['is_silent'])}")


if __name__ == "__main__":
    build_districts_bias_layer()
