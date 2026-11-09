# MMM-MirrorMap

A reusable map for [MagicMirror²](https://magicmirror.builders). Add it to your config as many times as you like — each copy has its own position, area, zoom and map style — and let other modules pin live data onto it: bike-share stations, flights, buses, anything with a latitude and longitude.

## Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/Dnovak043/MMM-MirrorMap
```

To update later: `cd ~/MagicMirror/modules/MMM-MirrorMap && git pull`, then restart MagicMirror.

No `npm install` needed (Leaflet is bundled in `vendor/`).

**Map backgrounds come from [Geoapify](https://www.geoapify.com/static-maps-api/) and are downloaded once.** A map never moves, so at startup each map gets one static image of exactly its area and saves it in `modules/MMM-MirrorMap/cache/`. Every later start reuses it — no further requests — until you change that map's style, centre, zoom or size, when the new image is fetched automatically. Images no map uses any more are deleted a couple of minutes after startup. (Geoapify's terms allow storing and caching these images.)

You need a **free Geoapify API key**:

1. Sign up at [myprojects.geoapify.com](https://myprojects.geoapify.com) (free plan: 3,000 credits/day; one map image costs about 2–5 credits, once).
2. Create a project and copy its API key.
3. Put it in each map's config as `apiKey`. To type it only once, define it at the top of `config.js` — `const GEOAPIFY_KEY = "your-key";` — and use `apiKey: GEOAPIFY_KEY` in each map.

The `topo` style is the exception: it shows [OpenTopoMap](https://opentopomap.org) tiles, loaded live like any web map, and needs no key.

## Example: two maps on one mirror

```js
// At the top of config.js (outside `let config = { ... }`):
const GEOAPIFY_KEY = "your-geoapify-key";

// Top left: Lyft list, with a close-up dark map of the stations around you
{
	module: "MMM-LyftBikes",
	position: "top_left",
	header: "Bay Wheels",
	config: { stationName: "Your Station Name" }
},
{
	module: "MMM-MirrorMap",
	position: "top_left",
	config: {
		mapId: "lyft-map",
		layers: ["lyft"],
		centerLat: 40.7484, centerLon: -73.9857,
		homeLat: 40.7484, homeLon: -73.9857,
		zoom: 16,
		style: "dark",
		apiKey: GEOAPIFY_KEY
	}
},

// Bottom right: a zoomed-out topographic flight map
{
	module: "MMM-MirrorMap",
	position: "bottom_right",
	config: {
		mapId: "flight-map",
		layers: ["flights"],
		centerLat: 40.64, centerLon: -73.78,
		zoom: 9,
		width: 420, height: 300,
		style: "topo",                       // OpenTopoMap — no key needed
		tileFilter: "brightness(0.55)"       // tone a light map down for the mirror
	}
}
```

## Options

| Option | Default | What it does |
|---|---|---|
| `centerLat` / `centerLon` | — | **Required.** The middle of the map. |
| `zoom` | `15` | **Higher = closer.** 12 ≈ a city, 14 ≈ several neighbourhoods, 15 ≈ a neighbourhood, 16 ≈ a few blocks. Range 1–20 (topo: 1–17); fractions like `15.5` work. |
| `width` / `height` | `360` / `300` | Map size in pixels. |
| `style` | `"dark"` | `"dark"`, `"light"`, `"color"`, `"topo"` (OpenTopoMap, max zoom 17, no key), or any [Geoapify style](https://apidocs.geoapify.com/docs/maps/static/) name, e.g. `"dark-matter-purple-roads"`. |
| `apiKey` | `""` | Free Geoapify API key. Needed for every style except `"topo"`. |
| `tileUrl` / `tileCredit` | `null` / `""` | Use your own tile server instead of `style` (loaded live). |
| `tileFilter` | `null` | CSS filter on the map background, e.g. `"brightness(0.6)"` to dim it. |
| `overlays` | `[]` | Extra tile layers on top (e.g. weather radar): `[{ url, opacity, credit }]`. |
| `layers` | `[]` | Data layers this map shows, e.g. `["lyft"]`. Empty = every layer. |
| `mapId` | module id | Name data modules can use to send markers to this map only. |
| `homeLat` / `homeLon` | `null` | Blue "you are here" dot. |
| `fadeEdges` | `false` | Blend the map's edges into the black mirror. |
| `showStatus` | `true` | Show a short orange message under the map if it can't load the map library, tiles, or data. |
| `showCredit` | `true` | Map data credit line under the map. Most tile providers require it. |

To restyle markers (sizes, colours, label look), override the `.MMM-MirrorMap .mm-…` classes in `config/custom.css`.

## For module authors: putting data on maps

Everything goes through normal MagicMirror notifications, so any module can feed any map.

### Convention: a `map` block in your module's config

Keep everything your module sends to maps in one `map` block, separate from its other settings, so every data module is configured the same way:

```js
config: {
	// ... your module's own settings ...
	map: {
		layer: "flights",        // layer name maps subscribe to with `layers`
		maps: ["flight-map"],    // only send to these mapIds; leave out = any map showing the layer
		// ... how your markers look (colour, icon, what number to show) ...
	}
}
```

Maps choose what they accept with `layers`; data modules choose where they send with `maps`. Together that keeps each map separate: a map only shows data that was meant for it.

### 1. Maps announce what they show

When the mirror starts (and whenever someone sends `MAP_VIEW_REQUEST`), every map sends:

```js
MAP_VIEW {
	mapId: "flight-map",
	center: { lat, lon }, zoom, width, height,
	bounds: { north, south, east, west },   // what's visible
	layers: ["flights"]                     // what it wants; [] = anything
}
```

Keep the views for your layer, and only send markers inside each map's `bounds` — a zoomed-out map gets more, a close-up map gets fewer. If your module might start after the maps, send `MAP_VIEW_REQUEST` on `DOM_OBJECTS_CREATED` and they'll announce again.

### 2. You send markers

```js
this.sendNotification("MAP_MARKERS", {
	layer: "flights",       // your layer name — maps subscribe to it with `layers`
	mapId: "flight-map",    // optional: only this map. Leave out to send to every map showing the layer
	markers: [ /* ... */ ]  // the full current set for this layer; anything missing is removed
});
```

Send the whole set each time. Markers are matched by `id`, so anything unchanged stays put, numbers fade when they change, and moving markers glide to their new position.

### Marker format

| Field | Used by | Meaning |
|---|---|---|
| `id` | all | **Required.** Stable id (station id, aircraft hex code, …). |
| `lat`, `lon` | all | **Required.** Position. |
| `style` | all | `"pin"` (default), `"symbol"` or `"dot"`. |
| `icon` | pin, symbol | Built-in `"bike"`, `"ebike"`, `"docks"`, `"plane"`, or your own `{ path: "M…", viewBox: "0 0 24 24" }`. |
| `count` / `text` | pin | Number or short text in the pin. |
| `parts` | pin | Several icon + number pairs in one pin, e.g. `[{ icon: "ebike", count: 7 }, { icon: "bike", count: 3 }]`. Replaces `icon` and `count`; each number fades on its own when it changes. |
| `label` | all | Text in a small box under the marker (e.g. a callsign). |
| `heading` | symbol | Degrees clockwise from north; rotates the icon (built-in icons point north). |
| `state` | all | `"ok"` (default), `"empty"` (greyed) or `"off"` (dimmed). |
| `color` | all | Pin background, or the symbol/dot colour. |
| `size` | all | Scale factor, default `1`. |

Examples:

```js
// Bike-share station (what MMM-LyftBikes sends): 7 e-bikes and 3 bikes
{ id: "station-123", lat: 40.7484, lon: -73.9857, style: "pin", color: "#8a1a83",
  parts: [{ icon: "ebike", count: 7 }, { icon: "bike", count: 3 }] }

// Flight
{ id: "a1b2c3", lat: 40.65, lon: -73.80, style: "symbol", icon: "plane", heading: 285, label: "UAL123", color: "#fff" }

// Anything else
{ id: "stop-15184", lat: 40.75, lon: -73.98, style: "dot", color: "#ffb35c", label: "Bus 1" }
```

Labels and text are shown as plain text, never HTML.

## Credits

[Leaflet](https://leafletjs.com) (BSD-2-Clause, bundled in `vendor/leaflet`). Map images: Powered by [Geoapify](https://www.geoapify.com) · © [OpenMapTiles](https://openmaptiles.org) · © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (credited inside each image). Topographic tiles: © [OpenTopoMap](https://opentopomap.org) (CC-BY-SA). Built-in icons are Material Design icons (Apache 2.0).
