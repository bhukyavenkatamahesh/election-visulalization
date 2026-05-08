#!/usr/bin/env python3
"""Check which features have extreme bounding boxes."""
import json, sys

with open("public/data/india_pc_2019_simplified.geojson") as f:
    geo = json.load(f)

def bbox_of_coords(coords, depth=0):
    """Recursively find min/max lon/lat."""
    if depth > 5:
        return (999, -999, 999, -999)
    if isinstance(coords[0], (int, float)):
        return (coords[0], coords[0], coords[1], coords[1])
    results = [bbox_of_coords(c, depth+1) for c in coords]
    min_lon = min(r[0] for r in results)
    max_lon = max(r[1] for r in results)
    min_lat = min(r[2] for r in results)
    max_lat = max(r[3] for r in results)
    return (min_lon, max_lon, min_lat, max_lat)

# Overall bounding box of ALL features with pc_name
all_min_lon, all_max_lon = 180, -180
all_min_lat, all_max_lat = 90, -90

for i, feat in enumerate(geo["features"]):
    pc = feat.get("properties", {}).get("pc_name", "")
    if not pc:
        print(f"Feature {i}: NO pc_name — SKIPPED")
        continue
    
    coords = feat.get("geometry", {}).get("coordinates", [])
    if not coords:
        continue
    
    min_lon, max_lon, min_lat, max_lat = bbox_of_coords(coords)
    span_lon = max_lon - min_lon
    span_lat = max_lat - min_lat
    
    all_min_lon = min(all_min_lon, min_lon)
    all_max_lon = max(all_max_lon, max_lon)
    all_min_lat = min(all_min_lat, min_lat)
    all_max_lat = max(all_max_lat, max_lat)
    
    # Flag anything with extreme bounds
    if min_lon < 65 or max_lon > 100 or min_lat < 5 or max_lat > 38:
        st = feat["properties"].get("st_name", "?")
        print(f"OUTLIER Feature {i}: {pc} ({st}) — lon [{min_lon:.2f}, {max_lon:.2f}], lat [{min_lat:.2f}, {max_lat:.2f}]")

print(f"\nOverall bounding box of pc_name features:")
print(f"  lon: [{all_min_lon:.4f}, {all_max_lon:.4f}]")
print(f"  lat: [{all_min_lat:.4f}, {all_max_lat:.4f}]")
print(f"Total features with pc_name: {sum(1 for f in geo['features'] if f.get('properties',{}).get('pc_name'))}")
print(f"Total features: {len(geo['features'])}")
