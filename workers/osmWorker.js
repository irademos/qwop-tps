import { overpassToGeoJSON } from "../osmGeoJson.js";

self.addEventListener("message", (event) => {
  const { id, data } = event.data || {};
  if (id == null) return;

  try {
    const geojson = overpassToGeoJSON(data);
    self.postMessage({ id, geojson });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Failed to parse Overpass data." });
  }
});
