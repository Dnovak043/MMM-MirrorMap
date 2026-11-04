/* MMM-MirrorMap — node helper
 *  - Gets each map's background as one static image from Geoapify, once, and keeps it in ./cache.
 *    (Maps never move, so the image is reused on every start until the map's style, area or size changes.
 *    Geoapify's terms allow storing and caching static map images.)
 *  - Deletes cached images that no map on the mirror uses any more, shortly after startup.
 *  - Writes problems the map reports on screen to the MagicMirror (pm2) log as well.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const NodeHelper = require("node_helper");
const Log = require("logger");

const GEOAPIFY_URL = "https://maps.geoapify.com/v1/staticmap";
const USER_AGENT = "MMM-MirrorMap/1.0 (MagicMirror module)";
const CACHE_DIR = path.join(__dirname, "cache");
// Every map asks for its image when the mirror starts, so after this long we know which ones are in use.
const CLEANUP_DELAY_MS = 2 * 60 * 1000;

module.exports = NodeHelper.create({
	start () {
		this.pending = new Map(); // cache file -> promise, so two maps with the same view share one download
		this.inUse = new Set();   // cache files the current maps asked for
		this.cleanupTimer = null;
	},

	socketNotificationReceived (notification, payload) {
		if (!payload) return;
		if (notification === "MIRRORMAP_LOG") {
			const line = `${payload.mapId}: ${payload.message}`; // MagicMirror adds the module name
			if (payload.level === "info") Log.info(line);
			else Log.warn(line);
		} else if (notification === "MIRRORMAP_IMAGE") {
			this.mapImage(payload);
		}
	},

	async mapImage ({ mapId, style, bounds, width, height, apiKey, apiUrl }) {
		const reply = (extra) => this.sendSocketNotification("MIRRORMAP_IMAGE_READY", { mapId, ...extra });
		const b = bounds || {};
		if (!/^[a-z0-9-]+$/i.test(style || "") || ![b.north, b.south, b.east, b.west, width, height].every(Number.isFinite)) {
			reply({ error: "bad map settings" });
			return;
		}

		// 2× pixels so the map stays sharp on any screen; it's shown at the configured size.
		const params = new URLSearchParams({
			style,
			width: String(Math.round(width)),
			height: String(Math.round(height)),
			area: `rect:${b.west},${b.north},${b.east},${b.south}`,
			scaleFactor: "2",
			format: "png"
		});
		const id = crypto.createHash("sha1").update(params.toString()).digest("hex").slice(0, 12);
		const rel = `cache/${style}-${id}.png`;
		const file = path.join(__dirname, rel);
		this.inUse.add(path.basename(file));
		this.scheduleCleanup();

		if (fs.existsSync(file)) {
			reply({ file: rel });
			return;
		}

		if (!this.pending.has(file)) {
			this.pending.set(file, this.download(`${apiUrl || GEOAPIFY_URL}?${params}`, apiKey, file).finally(() => this.pending.delete(file)));
		}
		try {
			await this.pending.get(file);
			Log.info(`${mapId}: downloaded its map image (${style}) — saved as MMM-MirrorMap/${rel}, reused from now on`);
			reply({ file: rel });
		} catch (err) {
			// (the map shows this on screen and logs it — no need to log it twice)
			reply({ error: err.message });
		}
	},

	// Once, a little after startup: delete map images left over from old settings.
	scheduleCleanup () {
		if (this.cleanupTimer) return;
		this.cleanupTimer = setTimeout(() => this.cleanCache(), CLEANUP_DELAY_MS);
	},

	cleanCache () {
		let files;
		try {
			files = fs.readdirSync(CACHE_DIR);
		} catch (err) {
			return; // no cache folder yet
		}
		const stale = files.filter((f) => f.endsWith(".png") && !this.inUse.has(f));
		for (const f of stale) {
			try {
				fs.unlinkSync(path.join(CACHE_DIR, f));
			} catch (err) {
				Log.warn(`couldn't delete old map image cache/${f}: ${err.message}`);
			}
		}
		if (stale.length) Log.info(`deleted ${stale.length} old map image${stale.length > 1 ? "s" : ""} no map uses any more`);
	},

	stop () {
		clearTimeout(this.cleanupTimer);
	},

	async download (url, apiKey, file) {
		const res = await fetch(`${url}&apiKey=${encodeURIComponent(apiKey)}`, { headers: { "User-Agent": USER_AGENT } });
		// Error messages never include the URL, so the API key can't end up in the log.
		if (res.status === 401 || res.status === 403) throw new Error(`Geoapify rejected the API key (HTTP ${res.status})`);
		if (!res.ok) throw new Error(`HTTP ${res.status} from Geoapify`);
		const type = res.headers.get("content-type") || "";
		if (!type.startsWith("image/")) throw new Error(`Geoapify didn't send an image (${type || "no type"})`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	}
});
