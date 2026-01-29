import { overpassToGeoJSON } from "../osmGeoJson.js";

function buildOsmSubsets(geojson) {
  const highways = [];
  const buildings = [];
  const features = geojson?.features ?? [];
  for (const feature of features) {
    const props = feature?.properties;
    if (!props) continue;
    if (props.highway) {
      highways.push(feature);
    }
    if (props.building) {
      buildings.push(feature);
    }
  }
  return {
    highways: { type: "FeatureCollection", features: highways },
    buildings: { type: "FeatureCollection", features: buildings }
  };
}

self.addEventListener("message", (event) => {
  const { id, data } = event.data || {};
  if (id == null) return;

  try {
    const geojson = overpassToGeoJSON(data);
    const subsets = buildOsmSubsets(geojson);
    self.postMessage({ id, geojson, subsets });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Failed to parse Overpass data." });
  }
});
