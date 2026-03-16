// ─── ECDIS Route Parser ───────────────────────────────────────────────────────
// Supports: RTZ (IEC 61174 / S-421), CSV waypoints, GeoJSON
// Compatible with: FURUNO FMD-3x00, JRC JAN-9201/7201, Transas/Wärtsilä ECDIS,
//                  Raytheon Anschütz, Simrad, Kongsberg, MARIS, SAM Electronics

/**
 * Parse RTZ (Route Exchange Format) - IEC 61174 Ed.4 / S-421
 * This is the universal ECDIS route exchange standard
 */
export function parseRTZ(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Invalid RTZ XML: " + parseError.textContent.slice(0, 100));

  // Handle namespaced and non-namespaced RTZ
  const ns = doc.documentElement.namespaceURI;
  const q = (parent, tag) => {
    let els = parent.getElementsByTagNameNS(ns, tag);
    if (els.length === 0) els = parent.getElementsByTagName(tag);
    return els;
  };

  // Route info
  const routeInfoEl = q(doc, "routeInfo")[0] || doc.documentElement;
  const routeName = routeInfoEl?.getAttribute("routeName") || "Unnamed Route";
  const routeVersion = doc.documentElement.getAttribute("version") || "unknown";

  // Parse waypoints
  const waypointEls = q(doc, "waypoint");
  const waypoints = [];

  for (let i = 0; i < waypointEls.length; i++) {
    const wp = waypointEls[i];
    const posEls = q(wp, "position");
    const legEls = q(wp, "leg");

    if (posEls.length === 0) continue;
    const pos = posEls[0];

    const lat = parseFloat(pos.getAttribute("lat"));
    const lon = parseFloat(pos.getAttribute("lon"));
    if (isNaN(lat) || isNaN(lon)) continue;

    const leg = legEls.length > 0 ? legEls[0] : null;

    waypoints.push({
      id: wp.getAttribute("id") || String(i + 1),
      name: wp.getAttribute("name") || `WP${String(i + 1).padStart(3, "0")}`,
      lat, lon,
      radius: parseFloat(wp.getAttribute("radius")) || null,
      speed: leg ? parseFloat(leg.getAttribute("planSpeedMin") || leg.getAttribute("speedMin")) || null : null,
      speedMax: leg ? parseFloat(leg.getAttribute("planSpeedMax") || leg.getAttribute("speedMax")) || null : null,
      xtdPort: leg ? parseFloat(leg.getAttribute("xtdPort")) || null : null,
      xtdStarboard: leg ? parseFloat(leg.getAttribute("xtdStarboard")) || null : null,
    });
  }

  if (waypoints.length < 2) throw new Error("RTZ route must contain at least 2 waypoints");

  return {
    format: "RTZ",
    version: routeVersion,
    name: routeName,
    waypoints,
    totalLegs: waypoints.length - 1,
  };
}

/**
 * Parse CSV waypoint list
 * Accepts: lat,lon,name,speed or name,lat,lon,speed
 * Auto-detects header row and column order
 */
export function parseCSV(csvString) {
  const lines = csvString.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 3) throw new Error("CSV must have header + at least 2 waypoints");

  const header = lines[0].toLowerCase().split(/[,;\t]/);
  const latIdx = header.findIndex(h => /^lat/.test(h.trim()));
  const lonIdx = header.findIndex(h => /^(lon|lng)/.test(h.trim()));
  const nameIdx = header.findIndex(h => /^(name|wp|waypoint|id)/.test(h.trim()));
  const spdIdx = header.findIndex(h => /^(speed|spd|sog)/.test(h.trim()));

  if (latIdx === -1 || lonIdx === -1) throw new Error("CSV must have 'lat' and 'lon' columns");

  const waypoints = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/);
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (isNaN(lat) || isNaN(lon)) continue;
    waypoints.push({
      id: String(i),
      name: nameIdx >= 0 ? cols[nameIdx]?.trim() || `WP${String(i).padStart(3, "0")}` : `WP${String(i).padStart(3, "0")}`,
      lat, lon,
      speed: spdIdx >= 0 ? parseFloat(cols[spdIdx]) || null : null,
    });
  }
  if (waypoints.length < 2) throw new Error("CSV must contain at least 2 valid waypoints");
  return { format: "CSV", version: "1.0", name: "Imported CSV Route", waypoints, totalLegs: waypoints.length - 1 };
}

/**
 * Parse GeoJSON LineString or FeatureCollection with Point features
 */
export function parseGeoJSON(jsonString) {
  const geo = typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;
  const waypoints = [];

  if (geo.type === "FeatureCollection") {
    geo.features.forEach((f, i) => {
      if (f.geometry?.type === "Point") {
        const [lon, lat] = f.geometry.coordinates;
        waypoints.push({ id: String(i + 1), name: f.properties?.name || `WP${String(i + 1).padStart(3, "0")}`, lat, lon, speed: f.properties?.speed || null });
      }
    });
  } else if (geo.type === "Feature" && geo.geometry?.type === "LineString") {
    geo.geometry.coordinates.forEach(([lon, lat], i) => {
      waypoints.push({ id: String(i + 1), name: `WP${String(i + 1).padStart(3, "0")}`, lat, lon, speed: null });
    });
  } else if (geo.type === "LineString") {
    geo.coordinates.forEach(([lon, lat], i) => {
      waypoints.push({ id: String(i + 1), name: `WP${String(i + 1).padStart(3, "0")}`, lat, lon, speed: null });
    });
  }

  if (waypoints.length < 2) throw new Error("GeoJSON must contain at least 2 waypoints/coordinates");
  return { format: "GeoJSON", version: "1.0", name: geo.properties?.name || "Imported GeoJSON Route", waypoints, totalLegs: waypoints.length - 1 };
}

/**
 * Auto-detect format and parse
 */
export function autoDetectAndParse(content, filename = "") {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const trimmed = content.trim();

  // RTZ detection: XML with <route> root or .rtz extension
  if (ext === "rtz" || trimmed.startsWith("<?xml") || trimmed.startsWith("<route")) {
    return parseRTZ(trimmed);
  }
  // GeoJSON detection
  if (ext === "geojson" || ext === "json" || trimmed.startsWith("{")) {
    try { return parseGeoJSON(trimmed); } catch (e) { /* fall through */ }
  }
  // CSV fallback
  if (ext === "csv" || ext === "txt" || trimmed.includes(",")) {
    return parseCSV(trimmed);
  }
  throw new Error(`Unrecognized route format. Supported: RTZ (.rtz), CSV (.csv), GeoJSON (.geojson/.json)`);
}

/**
 * Haversine distance between two points in nautical miles
 */
export function haversineNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in NM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate bearing from point A to point B in degrees true
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Compute route statistics: total distance, leg distances, bearings
 */
export function computeRouteStats(waypoints) {
  let totalNM = 0;
  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const dist = haversineNM(a.lat, a.lon, b.lat, b.lon);
    const brg = bearing(a.lat, a.lon, b.lat, b.lon);
    totalNM += dist;
    legs.push({ from: a.name, to: b.name, distNM: dist, bearing: brg, cumNM: totalNM });
  }
  return { totalNM, legs };
}

/**
 * Spherical linear interpolation between two lat/lon points (slerp).
 * More accurate than flat linear on long legs (>200 NM).
 */
function slerpLatLon(lat1, lon1, lat2, lon2, frac) {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const φ1 = lat1*toR, λ1 = lon1*toR, φ2 = lat2*toR, λ2 = lon2*toR;
  const dφ = φ2-φ1, dλ = λ2-λ1;
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  const Δ = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  if (Δ < 1e-10) return { lat: lat1, lon: lon1 };
  const sinΔ = Math.sin(Δ);
  const A = Math.sin((1-frac)*Δ)/sinΔ, B = Math.sin(frac*Δ)/sinΔ;
  const x = A*Math.cos(φ1)*Math.cos(λ1) + B*Math.cos(φ2)*Math.cos(λ2);
  const y = A*Math.cos(φ1)*Math.sin(λ1) + B*Math.cos(φ2)*Math.sin(λ2);
  const z = A*Math.sin(φ1)              + B*Math.sin(φ2);
  return { lat: Math.atan2(z, Math.sqrt(x*x+y*y))*toD, lon: Math.atan2(y, x)*toD };
}

/**
 * Generate weather sample points along route (every ~50 NM or at waypoints)
 */
export function generateWeatherSamplePoints(waypoints, intervalNM = 50) {
  const points = [];
  points.push({ lat: waypoints[0].lat, lon: waypoints[0].lon, name: waypoints[0].name, legIdx: 0, cumNM: 0 });
  let cumNM = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const legDist = haversineNM(a.lat, a.lon, b.lat, b.lon);
    const numSamples = Math.max(1, Math.floor(legDist / intervalNM));
    for (let s = 1; s <= numSamples; s++) {
      const frac = s / (numSamples + 1);
      const { lat, lon } = slerpLatLon(a.lat, a.lon, b.lat, b.lon, frac);
      const segDist = legDist * frac;
      points.push({ lat, lon, name: `L${i + 1}-S${s}`, legIdx: i, cumNM: cumNM + segDist });
    }
    cumNM += legDist;
    if (i < waypoints.length - 2) {
      points.push({ lat: b.lat, lon: b.lon, name: b.name, legIdx: i + 1, cumNM });
    }
  }
  const last = waypoints[waypoints.length - 1];
  points.push({ lat: last.lat, lon: last.lon, name: last.name, legIdx: waypoints.length - 2, cumNM });
  return points;
}

/**
 * Generate a sample RTZ file string for testing/demo
 */
export function generateSampleRTZ() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<route xmlns="http://www.cirm.org/RTZ/1/2" version="1.2">
  <routeInfo routeName="North Atlantic Westbound — SOLAS Route" vesselName="Demo Vessel" />
  <waypoints>
    <waypoint id="1" name="BISHOP ROCK"><position lat="49.8700" lon="-6.4500" /><leg planSpeedMin="14" /></waypoint>
    <waypoint id="2" name="FASTNET TSS"><position lat="51.2000" lon="-9.6000" /><leg planSpeedMin="14" /></waypoint>
    <waypoint id="3" name="48N-015W"><position lat="48.0000" lon="-15.0000" /><leg planSpeedMin="15" /></waypoint>
    <waypoint id="4" name="47N-025W"><position lat="47.0000" lon="-25.0000" /><leg planSpeedMin="15" /></waypoint>
    <waypoint id="5" name="45N-035W"><position lat="45.0000" lon="-35.0000" /><leg planSpeedMin="16" /></waypoint>
    <waypoint id="6" name="43N-045W"><position lat="43.0000" lon="-45.0000" /><leg planSpeedMin="16" /></waypoint>
    <waypoint id="7" name="42N-055W"><position lat="42.0000" lon="-55.0000" /><leg planSpeedMin="15" /></waypoint>
    <waypoint id="8" name="NANTUCKET APP"><position lat="40.5000" lon="-69.5000" /><leg planSpeedMin="14" /></waypoint>
    <waypoint id="9" name="AMBROSE CH"><position lat="40.4600" lon="-73.8300" /></waypoint>
  </waypoints>
</route>`;
}
