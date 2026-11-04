/* MMM-MirrorMap
 * A reusable map for MagicMirror². Add it as many times as you like — each copy has its own
 * position, area, zoom and style — and let other modules pin live data onto it.
 *
 * Protocol (MagicMirror notifications):
 *   map  → all:   MAP_VIEW     { mapId, center, zoom, width, height, bounds, layers }
 *   any  → maps:  MAP_VIEW_REQUEST                      (maps re-announce their views)
 *   data → maps:  MAP_MARKERS  { layer, mapId?, markers: [ ... ] }
 * See README.md for the marker format.
 */

/* global Module, L, MM */

// Map backgrounds.
// "image" styles: one static map image per map from Geoapify (free API key), downloaded once at startup
// and kept in modules/MMM-MirrorMap/cache — Geoapify's terms allow storing and caching these images.
// "tiles" styles: loaded live like any web map (no pre-downloading).
const MM_STYLES = {
	dark: { kind: "image", style: "dark-matter" },
	light: { kind: "image", style: "positron" },
	color: { kind: "image", style: "osm-bright" },
	topo: {
		kind: "tiles",
		url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
		subdomains: "abc",
		maxZoom: 17,
		credit: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)"
	}
};

// Built-in icons. bike / ebike / docks / plane are Material Design icons (Apache 2.0).
// Data modules can also send their own: icon: { path: "M...", viewBox: "0 0 24 24" }.
const MM_ICONS = {
	bike: "M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2M5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5m5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5",
	ebike: "M19 7h-.82l-1.7-4.68C16.19 1.53 15.44 1 14.6 1H12v2h2.6l1.46 4h-4.81l-.36-1H12V4H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 6.87 0 9.2 0 12s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5C24 9.2 21.8 7 19 7M7.82 13c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2m4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.02 0 .05-.01.08-.01 1.68 0 3 1.32 3 3s-1.32 3-3 3m-8 5H7l6 3v-2h4l-6-3z",
	docks: "M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6m.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2",
	plane: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
};

function mmEscape (text) {
	return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
}

// Only plain colour values get through, so data can't inject CSS.
function mmColor (value) {
	if (typeof value !== "string") return "";
	return /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(value.trim()) ? value.trim() : "";
}

function mmSvg (icon) {
	let path = null;
	let viewBox = "0 0 24 24";
	if (icon && typeof icon === "object" && typeof icon.path === "string") {
		path = icon.path;
		if (typeof icon.viewBox === "string") viewBox = icon.viewBox;
	} else if (typeof icon === "string") {
		path = MM_ICONS[icon] || null;
	}
	if (!path) return "";
	return `<svg viewBox="${mmEscape(viewBox)}" width="1em" height="1em" fill="currentColor"><path d="${mmEscape(path)}"/></svg>`;
}

Module.register("MMM-MirrorMap", {
	defaults: {
		mapId: null,              // name data modules can target; defaults to this copy's module id
		centerLat: null,          // required: the middle of the map
		centerLon: null,
		zoom: 15,                 // higher = closer: 12 = a city, 14 = several neighbourhoods, 16 = a few blocks (max 20)
		width: 360,               // px
		height: 300,              // px
		style: "dark",            // "dark", "light", "color", "topo", or any Geoapify style name (e.g. "dark-matter-purple-roads")
		apiKey: "",               // free Geoapify API key (geoapify.com) — needed for every style except "topo"
		tileUrl: null,            // or your own tile server, e.g. "https://tiles.example.com/{z}/{x}/{y}.png"
		tileCredit: "",           // credit line for tileUrl
		tileFilter: null,         // CSS filter for the map tiles, e.g. "brightness(0.6)"; replaces the style's own filter
		overlays: [],             // extra tile layers on top, e.g. weather radar: [{ url, opacity, credit }]
		layers: [],               // which data layers to show, e.g. ["lyft"]; empty = every layer
		homeLat: null,            // optional blue "you are here" dot
		homeLon: null,
		fadeEdges: false,         // true = blend the map's edges into the black mirror
		showCredit: true,         // map data credit line under the map (required by most tile providers)
		showStatus: true,         // show a short message on the mirror if the map can't load tiles or data

		alternateWith: null,      // CSS class of the module(s) this map takes turns with (set `classes` on them)
		interval: 30,             // seconds per turn
		startWith: "modules",     // show "modules" or "map" first
		fadeSpeed: 1000           // ms for the hand-over
	},

	// this.file() points at this module's own folder. A bare "vendor/..." path would be looked up
	// in MagicMirror's vendor folder instead, because MagicMirror treats any path with "/" as root-relative.
	getScripts () {
		return [this.file("vendor/leaflet/leaflet.js")];
	},

	getStyles () {
		return [this.file("vendor/leaflet/leaflet.css"), "MMM-MirrorMap.css"];
	},

	start () {
		this.mapId = this.config.mapId || this.identifier;
		this.hasCenter = Number.isFinite(this.config.centerLat) && Number.isFinite(this.config.centerLon);
		this.layerData = new Map(); // layer name -> latest markers from that layer's module
		this.markers = new Map();   // "layer|id" -> Leaflet marker
		this.map = null;

		// One persistent element, so Leaflet keeps its state for the life of the mirror.
		const tiles = this.tileSpec();
		this.wrapper = document.createElement("div");
		this.wrapper.className = "mm-root";
		this.canvas = document.createElement("div");
		this.canvas.className = this.config.fadeEdges ? "mm-canvas mm-fade" : "mm-canvas";
		this.canvas.style.width = `${this.config.width}px`;
		this.canvas.style.height = `${this.config.height}px`;
		this.wrapper.appendChild(this.canvas);
		this.statusEl = document.createElement("div");
		this.statusEl.className = "mm-status";
		this.wrapper.appendChild(this.statusEl);
		this.problems = {};

		// Zoom: higher = closer. Map images exist for 1-20 (topo tiles to 17).
		const maxZoom = this.tileSpec().kind === "tiles" ? (this.tileSpec().maxZoom || 20) : 20;
		const z = Number(this.config.zoom);
		if (!Number.isFinite(z) || z < 1 || z > maxZoom) {
			const used = Number.isFinite(z) ? Math.min(Math.max(z, 1), maxZoom) : 15;
			this.setProblem("zoom", `zoom ${this.config.zoom} is out of range (1-${maxZoom}; higher = closer) — using ${used}`);
			this.config.zoom = used;
		}
		if (this.config.showCredit) {
			const credits = [tiles.kind === "tiles" ? tiles.credit : "", ...this.config.overlays.map((o) => o.credit)].filter(Boolean);
			const credit = document.createElement("div");
			credit.className = "mm-credit";
			credit.textContent = credits.join(" · ");
			this.wrapper.appendChild(credit);
		}
	},

	// Problems are shown on the mirror (one line each) so they can be fixed without developer tools.
	setProblem (key, message) {
		const had = this.problems[key];
		if (message) {
			this.problems[key] = message;
			if (!had) this.log("warn", message);
		} else if (had) {
			delete this.problems[key];
			this.log("info", `resolved: ${had}`);
		}
		if (!this.config.showStatus) return;
		this.statusEl.textContent = Object.values(this.problems).join(" · ");
	},

	// Written to the MagicMirror (pm2) log by node_helper.js.
	log (level, message) {
		this.sendSocketNotification("MIRRORMAP_LOG", { mapId: this.mapId, level, message });
	},

	tileSpec () {
		if (this.config.tileUrl) return { kind: "tiles", url: this.config.tileUrl, credit: this.config.tileCredit, subdomains: "abc", maxZoom: 20 };
		return MM_STYLES[this.config.style] || { kind: "image", style: String(this.config.style) };
	},


	getDom () {
		if (!this.hasCenter) {
			const msg = document.createElement("div");
			msg.className = "dimmed small";
			msg.textContent = "MMM-MirrorMap: set centerLat and centerLon in config.js";
			return msg;
		}
		return this.wrapper;
	},

	notificationReceived (notification, payload) {
		if (notification === "DOM_OBJECTS_CREATED") {
			this.initMap();
			this.announceView();
			this.setupAlternation();
		} else if (notification === "MAP_VIEW_REQUEST") {
			this.announceView();
		} else if (notification === "MAP_MARKERS") {
			this.receiveMarkers(payload);
		}
	},

	/* ---------- Telling data modules what this map shows ---------- */

	bounds () {
		const { centerLat: lat, centerLon: lon, zoom, width, height } = this.config;
		const scale = 256 * 2 ** zoom;
		const s = Math.sin((lat * Math.PI) / 180);
		const x = ((lon + 180) / 360) * scale;
		const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
		const toLon = (px) => (px / scale) * 360 - 180;
		const toLat = (py) => {
			const n = Math.PI - (2 * Math.PI * py) / scale;
			return (180 / Math.PI) * Math.atan(Math.sinh(n));
		};
		return { north: toLat(y - height / 2), south: toLat(y + height / 2), west: toLon(x - width / 2), east: toLon(x + width / 2) };
	},

	announceView () {
		if (!this.hasCenter) return;
		this.sendNotification("MAP_VIEW", {
			mapId: this.mapId,
			center: { lat: this.config.centerLat, lon: this.config.centerLon },
			zoom: this.config.zoom,
			width: this.config.width,
			height: this.config.height,
			bounds: this.bounds(),
			layers: [...this.config.layers]
		});
	},

	/* ---------- Taking turns with other modules ---------- */

	partners () {
		return MM.getModules().withClass(this.config.alternateWith).exceptModule(this);
	},

	setupAlternation () {
		if (!this.config.alternateWith || this.alternating) return;
		this.alternating = true;
		const lock = { lockString: this.identifier };
		this.onMap = this.config.startWith === "map";
		if (this.onMap) this.partners().enumerate((m) => m.hide(0, lock));
		else this.hide(0, lock);
		setInterval(() => this.swap(), Math.max(5, this.config.interval) * 1000);
	},

	swap () {
		const lock = { lockString: this.identifier };
		const half = Math.max(0, this.config.fadeSpeed / 2);
		if (this.onMap) {
			// map out, then the modules in
			this.hide(half, () => this.partners().enumerate((m) => m.show(half, lock)), lock);
		} else {
			// modules out, then the map in
			this.partners().enumerate((m) => m.hide(half, lock));
			setTimeout(() => {
				this.show(half, () => {}, lock);
				this.refreshSize();
			}, half);
		}
		this.onMap = !this.onMap;
	},

	/* ---------- The map ---------- */

	initMap () {
		if (this.map || !this.hasCenter) return;
		if (typeof L === "undefined") {
			this.setProblem("leaflet", "Map library (Leaflet) didn't load — check modules/MMM-MirrorMap/vendor/leaflet");
			return;
		}
		try {
			this.createMap();
			this.log("info", `map ready (${this.config.tileUrl ? "custom tiles" : this.config.style}, zoom ${this.config.zoom}, layers: ${this.config.layers.join(", ") || "all"})`);
		} catch (err) {
			this.setProblem("init", `Map error: ${err.message}`);
		}
		this.watchData();
	},

	createMap () {
		const tiles = this.tileSpec();
		this.map = L.map(this.canvas, {
			attributionControl: false, // credits are shown under the map instead
			zoomSnap: 0,               // use the configured zoom exactly (Leaflet rounds 15.5 to 16 otherwise)
			zoomControl: false,
			dragging: false,
			touchZoom: false,
			scrollWheelZoom: false,
			doubleClickZoom: false,
			boxZoom: false,
			keyboard: false,
			fadeAnimation: false,
			zoomAnimation: false,
			markerZoomAnimation: false
		});
		this.map.setView([this.config.centerLat, this.config.centerLon], this.config.zoom); // before layers, so they're created right away
		if (tiles.kind === "tiles") {
			this.addBaseLayer(tiles.url, tiles);
		} else if (!this.config.apiKey) {
			this.setProblem("key", "Add a free Geoapify apiKey to this map's config (see README)");
		} else {
			// The node helper downloads the image once (or finds it in the cache) and tells us where it is.
			this.sendSocketNotification("MIRRORMAP_IMAGE", {
				mapId: this.mapId,
				style: tiles.style,
				bounds: this.bounds(),
				width: this.config.width,
				height: this.config.height,
				apiKey: this.config.apiKey,
				apiUrl: this.config.imageApiUrl // testing hook; normally unset
			});
		}
		for (const o of this.config.overlays) {
			if (o && o.url) L.tileLayer(o.url, { opacity: o.opacity ?? 0.6, subdomains: o.subdomains || "abc", zIndex: 5 }).addTo(this.map);
		}

		if (Number.isFinite(this.config.homeLat) && Number.isFinite(this.config.homeLon)) {
			L.marker([this.config.homeLat, this.config.homeLon], {
				icon: L.divIcon({ className: "mm-home", html: '<div class="mm-home-dot"></div>', iconSize: [0, 0] }),
				interactive: false,
				keyboard: false,
				zIndexOffset: -1000
			}).addTo(this.map);
		}
		this.render();
	},

	addBaseLayer (url, tiles) {
		const base = L.tileLayer(url, { subdomains: tiles.subdomains || "abc", maxZoom: tiles.maxZoom });
		this.watchTiles(base);
		base.addTo(this.map);
		if (this.config.tileFilter) base.getContainer().style.filter = this.config.tileFilter;
	},

	// The static map image covers exactly this map's bounds, so pins line up with it.
	addImage (url) {
		const b = this.bounds();
		const image = L.imageOverlay(url, [[b.south, b.west], [b.north, b.east]], { interactive: false });
		image.on("load", () => this.setProblem("tiles", null));
		image.on("error", () => this.setProblem("tiles", "Saved map image couldn't be shown"));
		image.addTo(this.map);
		if (this.config.tileFilter) image.getElement().style.filter = this.config.tileFilter;
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "MIRRORMAP_IMAGE_READY" || !payload || payload.mapId !== this.mapId || !this.map) return;
		if (payload.error) {
			this.setProblem("tiles", `Couldn't get the map image: ${payload.error}`);
			return;
		}
		this.setProblem("key", null);
		this.addImage(this.file(payload.file));
	},

	watchTiles (layer) {
		let loaded = 0;
		let failed = 0;
		layer.on("tileload", () => {
			loaded++;
			this.setProblem("tiles", null);
		});
		layer.on("tileerror", () => {
			failed++;
			if (!loaded) this.setProblem("tiles", `Map tiles aren't loading (${failed} failed) — is the tile server reachable?`);
		});
		setTimeout(() => {
			if (!loaded && !failed) {
				const w = this.canvas.clientWidth;
				this.setProblem("tiles", w ? "Map tiles haven't loaded yet" : "Map has no size on screen — tiles not requested");
			}
		}, 15000);
	},

	watchData () {
		setTimeout(() => {
			if (this.layerData.size) return;
			const which = this.config.layers.length ? `layer${this.config.layers.length > 1 ? "s" : ""} "${this.config.layers.join("\", \"")}"` : "any layer";
			this.setProblem("data", `No markers received for ${which} yet`);
		}, 90000);
	},

	refreshSize () {
		if (!this.map) return;
		this.map.invalidateSize();
		this.map.setView([this.config.centerLat, this.config.centerLon], this.config.zoom, { animate: false });
	},

	/* ---------- Markers from data modules ---------- */

	receiveMarkers (payload) {
		if (!payload || typeof payload.layer !== "string" || !Array.isArray(payload.markers)) return;
		if (payload.mapId && payload.mapId !== this.mapId) return;
		if (this.config.layers.length && !this.config.layers.includes(payload.layer)) return;
		this.layerData.set(payload.layer, payload.markers);
		this.setProblem("data", null);
		this.render();
	},

	describe (m) {
		const style = ["pin", "symbol", "dot"].includes(m.style) ? m.style : "pin";
		const state = ["ok", "empty", "off"].includes(m.state) ? m.state : "ok";
		const textOf = (p) => (p.text != null ? String(p.text) : p.count != null ? String(p.count) : "");
		// A pin can have several parts (icon + number each), e.g. e-bikes and bikes: parts: [{ icon, count }, ...]
		const parts = Array.isArray(m.parts) && m.parts.length
			? m.parts.slice(0, 4).filter((p) => p && typeof p === "object").map((p) => ({ icon: p.icon, text: textOf(p) }))
			: [{ icon: m.icon, text: textOf(m) }];
		const text = parts[0].text;
		const label = m.label != null ? String(m.label) : "";
		const heading = Number.isFinite(m.heading) ? m.heading : 0;
		const size = Number.isFinite(m.size) && m.size > 0 ? m.size : 1;
		const color = mmColor(m.color);
		// Anything that changes the marker's structure; text, label, heading and position update in place.
		const look = JSON.stringify([style, state, parts.map((p) => [p.icon || "", Boolean(p.text)]), color, Boolean(label), size]);
		return { style, state, parts, text, label, heading, size, color, icon: parts[0].icon, look };
	},

	markerHtml (d) {
		const colorVar = d.color ? `--mm-color:${d.color};` : "";
		const svg = mmSvg(d.icon);
		const label = d.label ? `<div class="mm-label">${mmEscape(d.label)}</div>` : "";
		if (d.style === "symbol") {
			return `<div class="mm-symbol mm-${d.state}" style="${colorVar}font-size:${26 * d.size}px">` +
				`<div class="mm-symbol-icon" style="transform:rotate(${d.heading}deg)">${svg}</div>${label}</div>`;
		}
		if (d.style === "dot") {
			return `<div class="mm-dotmark mm-${d.state}" style="${colorVar}font-size:${10 * d.size}px"><div class="mm-dot"></div>${label}</div>`;
		}
		const parts = d.parts.map((p) => {
			const icon = mmSvg(p.icon);
			return `<span class="mm-part">${icon ? `<span class="mm-pin-icon">${icon}</span>` : ""}` +
				`${p.text ? `<span class="mm-text">${mmEscape(p.text)}</span>` : ""}</span>`;
		}).join("");
		const textOnly = d.parts.length === 1 && !mmSvg(d.parts[0].icon);
		return `<div class="mm-pin mm-${d.state}${textOnly ? " mm-pin-texton" : ""}" style="${colorVar}font-size:${15 * d.size}px">${parts}</div>${label}`;
	},

	divIcon (d) {
		return L.divIcon({ className: "mm-marker", iconSize: [0, 0], html: this.markerHtml(d) });
	},

	fadeText (el, value) {
		el.classList.add("mm-changing");
		setTimeout(() => {
			el.textContent = value;
			el.classList.remove("mm-changing");
		}, 400);
	},

	render () {
		if (!this.map) return;
		const seen = new Set();
		for (const [layer, markers] of this.layerData) {
			for (const m of markers) {
				if (!m || m.id == null || !Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
				const key = `${layer}|${m.id}`;
				seen.add(key);
				const d = this.describe(m);
				const existing = this.markers.get(key);

				if (!existing) {
					const marker = L.marker([m.lat, m.lon], { icon: this.divIcon(d), interactive: false, keyboard: false });
					marker.mm = d;
					marker.addTo(this.map);
					// Smooth movement for things that move (planes, buses) — enabled after first placement.
					setTimeout(() => {
						const el = marker.getElement();
						if (el) el.classList.add("mm-animate");
					}, 50);
					this.markers.set(key, marker);
					continue;
				}

				const pos = existing.getLatLng();
				if (pos.lat !== m.lat || pos.lng !== m.lon) existing.setLatLng([m.lat, m.lon]);

				if (existing.mm.look !== d.look) {
					existing.setIcon(this.divIcon(d)); // structure changed: rebuild this marker only
					const el = existing.getElement();
					if (el) el.classList.add("mm-animate");
				} else {
					const el = existing.getElement();
					if (el) {
						// Each part's number fades on its own when it changes.
						el.querySelectorAll(".mm-pin .mm-part").forEach((partEl, i) => {
							const textEl = partEl.querySelector(".mm-text");
							const before = existing.mm.parts[i] ? existing.mm.parts[i].text : null;
							if (textEl && d.parts[i] && before !== d.parts[i].text) this.fadeText(textEl, d.parts[i].text);
						});
						const labelEl = el.querySelector(".mm-label");
						if (labelEl && existing.mm.label !== d.label) labelEl.textContent = d.label;
						const iconEl = el.querySelector(".mm-symbol-icon");
						if (iconEl && existing.mm.heading !== d.heading) iconEl.style.transform = `rotate(${d.heading}deg)`;
					}
				}
				existing.mm = d;
			}
		}
		for (const [key, marker] of this.markers) {
			if (!seen.has(key)) {
				marker.remove();
				this.markers.delete(key);
			}
		}
	}
});
