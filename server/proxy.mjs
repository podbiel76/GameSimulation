import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ─── WMTS Capabilities Cache ────────────────────────────────────────
let capabilitiesCache = { text: "", fetchedAt: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 min

const WMTS_CAPABILITIES_URL =
  "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetCapabilities";

app.get("/api/map-proxy/geoportal/wmts-capabilities", async (_req, res) => {
  try {
    const now = Date.now();
    if (capabilitiesCache.text && now - capabilitiesCache.fetchedAt < CACHE_TTL) {
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(capabilitiesCache.text);
    }

    const response = await fetch(WMTS_CAPABILITIES_URL);
    if (!response.ok) {
      throw new Error(`Geoportal returned ${response.status}`);
    }

    const text = await response.text();
    capabilitiesCache = { text, fetchedAt: now };

    res.set("Content-Type", "text/xml; charset=utf-8");
    res.send(text);
  } catch (err) {
    console.error("[proxy] WMTS capabilities error:", err);
    res.status(502).json({ error: "Failed to fetch WMTS capabilities" });
  }
});

// ─── WMTS Tile Proxy ────────────────────────────────────────────────
const WMTS_BASE =
  "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution";

app.get("/api/map-proxy/geoportal/wmts-tile", async (req, res) => {
  try {
    const params = new URLSearchParams();

    // Pass all query parameters to the target, ensuring they are correctly encoded
    for (const [key, value] of Object.entries(req.query)) {
      if (value) params.set(key, String(value));
    }

    const url = `${WMTS_BASE}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).send("Tile fetch failed");
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error("[proxy] Tile error:", err);
    res.status(502).send("Tile proxy error");
  }
});

// ─── Mock GeoJSON Endpoints ─────────────────────────────────────────
function loadMock(filename) {
  const filepath = join(__dirname, "mock-data", filename);
  return JSON.parse(readFileSync(filepath, "utf-8"));
}

app.get("/api/scenarios/:id/detections.geojson", (_req, res) => {
  res.json(loadMock("detections.geojson"));
});

app.get("/api/scenarios/:id/tracks.geojson", (_req, res) => {
  res.json(loadMock("tracks.geojson"));
});

app.get("/api/scenarios/:id/assessments.geojson", (_req, res) => {
  res.json(loadMock("assessments.geojson"));
});

// ─── YOLO Detection & Backend Proxy ─────────────────────────────────────────
const BACKEND_SERVER = "http://localhost:3002";

// Generic proxy: forward any unhandled /api/* request to FastAPI backend
app.use("/api", async (req, res) => {
  try {
    const url = `${BACKEND_SERVER}${req.originalUrl}`;

    const fetchOptions = {
      method: req.method,
      redirect: "follow",
    };

    if (["POST", "PATCH", "PUT"].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
      fetchOptions.headers = { "Content-Type": "application/json" };
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();

    const contentType = response.headers.get("content-type") || "application/json";
    res.status(response.status);
    res.set("Content-Type", contentType);
    res.send(text);
  } catch (err) {
    console.error("[proxy] Backend server error:", err.message);
    res.status(502).json({ error: "Backend unavailable" });
  }
});

// These are now handled by the generic /api proxy above



// ─── Start ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[proxy] Express WMTS proxy running on http://localhost:${PORT}`);
});
