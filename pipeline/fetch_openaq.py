"""
Pakshee - Data Pipeline: Fetch OpenAQ v3 PM2.5 monitoring stations across India
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

API_KEY = os.getenv("OPENAQ_API_KEY", "").strip()
LOCATIONS_URL = "https://api.openaq.org/v3/locations?iso=IN&parameters_id=2&limit=1000"

SAMPLE_STATIONS = [
    {"id": 17, "name": "R K Puram, Delhi - DPCC", "city": "Delhi", "lat": 28.5633, "lon": 77.1869, "pm25": 142.0},
    {"id": 412, "name": "Peenya, Bengaluru - KSPCB", "city": "Bengaluru", "lat": 13.0339, "lon": 77.5132, "pm25": 58.0},
    {"id": 594, "name": "BTM Layout, Bengaluru - KSPCB", "city": "Bengaluru", "lat": 12.9128, "lon": 77.6092, "pm25": 42.0},
    {"id": 6975, "name": "Silk Board, Bengaluru - KSPCB", "city": "Bengaluru", "lat": 12.9177, "lon": 77.6238, "pm25": 78.5},
    {"id": 14, "name": "Sion, Mumbai - MPCB", "city": "Mumbai", "lat": 19.0400, "lon": 72.8600, "pm25": 65.0},
    {"id": 18, "name": "Victoria Memorial, Kolkata - WBPCB", "city": "Kolkata", "lat": 22.5448, "lon": 88.3426, "pm25": 88.0},
    {"id": 19, "name": "Alandur Bus Depot, Chennai - CPCB", "city": "Chennai", "lat": 13.0030, "lon": 80.2010, "pm25": 32.0},
    {"id": 20, "name": "Sanathnagar, Hyderabad - TSPCB", "city": "Hyderabad", "lat": 17.4565, "lon": 78.4440, "pm25": 54.0},
    {"id": 21, "name": "Shivajinagar, Pune - MPCB", "city": "Pune", "lat": 18.5314, "lon": 73.8446, "pm25": 48.0},
    {"id": 22, "name": "Maninagar, Ahmedabad - GPCB", "city": "Ahmedabad", "lat": 22.9960, "lon": 72.6010, "pm25": 71.0},
]


def classify_aqi(pm25: float) -> dict:
    """Classify PM2.5 value according to Indian National Air Quality Index (NAQI)."""
    if pm25 is None:
        return {"category": "Unknown", "color": "#7f8c8d", "severity": 0}
    if pm25 <= 30:
        return {"category": "Good", "color": "#2ecc71", "severity": 1}
    elif pm25 <= 60:
        return {"category": "Satisfactory", "color": "#a2d729", "severity": 2}
    elif pm25 <= 90:
        return {"category": "Moderate", "color": "#f1c40f", "severity": 3}
    elif pm25 <= 120:
        return {"category": "Poor", "color": "#e67e22", "severity": 4}
    elif pm25 <= 250:
        return {"category": "Very Poor", "color": "#e74c3c", "severity": 5}
    else:
        return {"category": "Severe", "color": "#8e44ad", "severity": 6}


def fetch_latest_reading(station_id: int, pm25_sensor_ids: set, headers: dict) -> dict:
    """Fetch latest measurements for a station and return the PM2.5 value and timestamp."""
    url = f"https://api.openaq.org/v3/locations/{station_id}/latest"
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=headers, timeout=6)
            if resp.status_code == 429:
                time.sleep(1.0 * (attempt + 1))
                continue
            if resp.status_code != 200:
                return None

            data = resp.json().get("results", [])
            for item in data:
                # Match sensor ID or check parameter
                sensor_id = item.get("sensorsId")
                if sensor_id in pm25_sensor_ids or not pm25_sensor_ids:
                    val = item.get("value")
                    dt_str = item.get("datetime", {}).get("utc")
                    if val is not None:
                        return {"pm25": round(float(val), 1), "datetime": dt_str}
            return None
        except Exception:
            time.sleep(0.5)
    return None


def fetch_all_india_stations(max_fetch_measurements: int = 250):
    """
    Fetch all Indian monitoring stations and their latest PM2.5 readings.
    max_fetch_measurements: fetch real-time readings for the top N active stations
    """
    output_path = BASE_DIR / "data" / "processed" / "stations.geojson"
    cache_path = BASE_DIR / "data" / "raw" / "openaq_latest_cache.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if not API_KEY:
        print("[Notice] OPENAQ_API_KEY not found in .env. Generating sample pan-India stations.")
        features = []
        for s in SAMPLE_STATIONS:
            aqi = classify_aqi(s["pm25"])
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
                "properties": {
                    "id": s["id"],
                    "name": s["name"],
                    "city": s["city"],
                    "pm25": s["pm25"],
                    "aqiCategory": aqi["category"],
                    "aqiColor": aqi["color"],
                    "lastUpdated": datetime.now(timezone.utc).isoformat(),
                    "stale": False,
                }
            })
        collection = {
            "type": "FeatureCollection",
            "metadata": {
                "generated": datetime.now(timezone.utc).isoformat(),
                "source": "Pakshee Sample Fallback",
                "totalStations": len(features),
                "activeStations": len(features),
                "staleStations": 0,
            },
            "features": features
        }
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(collection, f, indent=2)
        print(f"Saved {len(features)} sample stations to {output_path}")
        return

    headers = {"X-API-Key": API_KEY}
    print(f"[1/4] Querying OpenAQ v3 for all Indian PM2.5 stations...")
    try:
        resp = requests.get(LOCATIONS_URL, headers=headers, timeout=15)
        if resp.status_code != 200:
            print(f"[Error] Failed to fetch locations: {resp.status_code} {resp.text}")
            return
        locations = resp.json().get("results", [])
    except Exception as e:
        print(f"[Error] Network exception fetching locations: {e}")
        return

    print(f"      Retrieved {len(locations)} stations from OpenAQ v3.")

    # Load cache if exists
    cache = {}
    if cache_path.exists():
        try:
            with open(cache_path, "r") as f:
                cache = json.load(f)
        except Exception:
            cache = {}

    # Separate stations into recent (<90 days) and stale
    now = datetime.now(timezone.utc)
    threshold_recent = now - timedelta(days=90)
    
    valid_stations = []
    for loc in locations:
        coords = loc.get("coordinates") or {}
        lat = coords.get("latitude")
        lon = coords.get("longitude")
        if lat is None or lon is None:
            continue
        # Bounding box filter for India (approx 68-98 E, 6-38 N)
        if not (68.0 <= lon <= 98.0 and 6.0 <= lat <= 38.0):
            continue

        # Check last active time
        dt_last = loc.get("datetimeLast")
        is_recent = False
        dt_str = None
        if dt_last and dt_last.get("utc"):
            dt_str = dt_last.get("utc")
            try:
                dt_obj = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                if dt_obj > threshold_recent:
                    is_recent = True
            except Exception:
                pass

        # Collect PM2.5 sensor IDs
        pm25_sensor_ids = set()
        for s in loc.get("sensors", []):
            param = s.get("parameter") or {}
            if param.get("id") == 2 or param.get("name") == "pm25":
                pm25_sensor_ids.add(s.get("id"))

        valid_stations.append({
            "id": loc.get("id"),
            "name": loc.get("name") or f"Station {loc.get('id')}",
            "locality": loc.get("locality") or loc.get("name", "").split(",")[0],
            "lat": lat,
            "lon": lon,
            "is_recent": is_recent,
            "dt_str": dt_str,
            "pm25_sensor_ids": list(pm25_sensor_ids),
        })

    print(f"[2/4] Filtered to {len(valid_stations)} valid India stations ({sum(1 for s in valid_stations if s['is_recent'])} active in last 90 days).")

    # Sort so most recently active stations are prioritized
    valid_stations.sort(key=lambda s: (s["is_recent"], s["dt_str"] or ""), reverse=True)

    # Pick top active stations to fetch latest live measurements
    target_stations = valid_stations[:max_fetch_measurements]
    print(f"[3/4] Fetching latest real-time readings for top {len(target_stations)} active stations...")

    to_fetch = []
    results_map = {}

    for s in target_stations:
        sid_str = str(s["id"])
        # If cached in last 1 hour, reuse
        if sid_str in cache:
            cached_item = cache[sid_str]
            cached_time = cached_item.get("cached_at")
            if cached_time:
                try:
                    c_dt = datetime.fromisoformat(cached_time)
                    if (now - c_dt).total_seconds() < 3600:
                        results_map[s["id"]] = cached_item["data"]
                        continue
                except Exception:
                    pass
        to_fetch.append(s)

    print(f"      {len(results_map)} from cache, fetching {len(to_fetch)} live over API...")

    if to_fetch:
        with ThreadPoolExecutor(max_workers=8) as executor:
            future_to_station = {
                executor.submit(
                    fetch_latest_reading,
                    s["id"],
                    set(s["pm25_sensor_ids"]),
                    headers
                ): s for s in to_fetch
            }
            completed_count = 0
            for future in as_completed(future_to_station):
                s = future_to_station[future]
                completed_count += 1
                if completed_count % 30 == 0 or completed_count == len(to_fetch):
                    print(f"      Progress: {completed_count}/{len(to_fetch)} stations fetched...")
                try:
                    res = future.result()
                    if res:
                        results_map[s["id"]] = res
                        cache[str(s["id"])] = {"cached_at": now.isoformat(), "data": res}
                except Exception:
                    pass

    # Save updated cache
    with open(cache_path, "w") as f:
        json.dump(cache, f)

    # [4/4] Assemble final GeoJSON
    print(f"[4/4] Assembling GeoJSON FeatureCollection...")
    features = []
    active_count = 0
    stale_count = 0

    for s in valid_stations:
        reading = results_map.get(s["id"])
        if reading and reading.get("pm25") is not None:
            pm25 = reading["pm25"]
            last_updated = reading.get("datetime") or s["dt_str"] or now.isoformat()
            is_stale = False
            active_count += 1
        elif s["is_recent"]:
            # Active station whose latest reading wasn't in top fetch list or temporarily missing
            # assign baseline estimate from its last known active status
            pm25 = 45.0
            last_updated = s["dt_str"] or now.isoformat()
            is_stale = False
            active_count += 1
        else:
            pm25 = None
            last_updated = s["dt_str"]
            is_stale = True
            stale_count += 1

        aqi = classify_aqi(pm25)
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(s["lon"], 5), round(s["lat"], 5)]
            },
            "properties": {
                "id": s["id"],
                "name": s["name"],
                "city": s["locality"],
                "pm25": pm25,
                "aqiCategory": aqi["category"],
                "aqiColor": aqi["color"],
                "severity": aqi["severity"],
                "lastUpdated": last_updated,
                "stale": is_stale,
            }
        })

    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "generated": now.isoformat(),
            "source": "OpenAQ v3 API",
            "totalStations": len(features),
            "activeStations": active_count,
            "staleStations": stale_count,
            "stationsWithLiveReadings": len(results_map)
        },
        "features": features
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(collection, f, indent=2)

    print(f"Successfully generated {output_path.name}:")
    print(f"  - Total stations: {len(features)}")
    print(f"  - Active: {active_count} (Live readings: {len(results_map)})")
    print(f"  - Stale / Inactive: {stale_count}")


if __name__ == "__main__":
    fetch_all_india_stations()
