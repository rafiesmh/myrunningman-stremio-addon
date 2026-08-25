const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 7001;

const TRACKERS = [
    "udp://tracker.moeking.me:6969/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "https://tr.abiir.top:443/announce",
    "udp://open.stealth.si:80/announce"
].map(t => `&tr=${encodeURIComponent(t)}`).join('');

// Helper: Convert raw magnet to Real-Debrid HTTPS link
async function resolveRealDebridLink(magnetUrl, apiKey) {
    try {
        const addRes = await axios.post(
            'https://api.real-debrid.com/rest/1.0/torrents/addMagnet',
            new URLSearchParams({ magnet: magnetUrl }),
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        const torrentId = addRes.data.id;

        await axios.post(
            `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`,
            new URLSearchParams({ files: 'all' }),
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        const infoRes = await axios.get(
            `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        if (infoRes.data.links && infoRes.data.links.length > 0) {
            const originalLink = infoRes.data.links[0];
            const unrestrictRes = await axios.post(
                'https://api.real-debrid.com/rest/1.0/unrestrict/link',
                new URLSearchParams({ link: originalLink }),
                { headers: { Authorization: `Bearer ${apiKey}` } }
            );
            return unrestrictRes.data.download;
        }
    } catch (err) {
        console.error("[RD Resolution Error]", err.message);
    }
    return null;
}

// Scraper function
async function scrapeMyRunningMan(episodeNum, rdApiKey) {
    const url = `https://myrunningman.com/ep/${episodeNum}`;
    console.log(`[Scraper] Fetching streams for Episode: ${episodeNum}`);

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://myrunningman.com/'
            },
            timeout: 8000
        });

        const html = response.data;
        const streams = [];
        const hashMatches = html.match(/[a-fA-F0-9]{40}/g) || [];
        const uniqueHashes = [...new Set(hashMatches)];

        for (let index = 0; index < uniqueHashes.length; index++) {
            const hash = uniqueHashes[index];
            const magnetUrl = `magnet:?xt=urn:btih:${hash}${TRACKERS}`;

            if (rdApiKey) {
                const httpUrl = await resolveRealDebridLink(magnetUrl, rdApiKey);
                if (httpUrl) {
                    streams.push({
                        name: "MyRunningMan [RD+]",
                        title: `Running Man - Ep ${episodeNum}\nOption ${index + 1} (Direct Stream)`,
                        url: httpUrl,
                        icon: "https://myrunningman.com/assets/img/appstore.png"
                    });
                    continue;
                }
            }

            // Fallback to P2P magnet link if no key or unrestrict fails
            streams.push({
                name: "MyRunningMan",
                title: `Running Man - Ep ${episodeNum}\nOption ${index + 1}`,
                url: magnetUrl,
                icon: "https://myrunningman.com/assets/img/appstore.png"
            });
        }

        return streams;

    } catch (error) {
        console.error(`[Scraper Error] Failed for Episode ${episodeNum}:`, error.message);
        return [];
    }
}

// Enable CORS for Stremio/Nuvio requests
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// HTML Configuration Page (Base Route)
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>MyRunningMan Stremio Addon</title>
            <style>
                body { font-family: Arial, sans-serif; background: #111; color: #fff; text-align: center; padding: 50px; }
                .card { background: #222; max-width: 400px; margin: 0 auto; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
                input { width: 90%; padding: 10px; margin: 15px 0; border-radius: 5px; border: 1px solid #444; background: #333; color: #fff; }
                button { background: #6c5ce7; color: #fff; border: none; padding: 12px 20px; font-size: 16px; border-radius: 5px; cursor: pointer; width: 95%; }
                button:hover { background: #5a4bcf; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>MyRunningMan Addon</h2>
                <p>Enter your Real-Debrid API Key below to enable high-speed HTTPS streams in Stremio and Nuvio.</p>
                <input type="text" id="rdKey" placeholder="Real-Debrid API Key (Optional)">
                <button onclick="installAddon()">Install to Stremio</button>
            </div>
            <script>
                function installAddon() {
                    const key = document.getElementById('rdKey').value.trim();
                    let url = window.location.origin;
                    if (key) {
                        url += '/rd_api_key=' + encodeURIComponent(key);
                    }
                    url += '/manifest.json';
                    window.location.href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
                }
            </script>
        </body>
        </html>
    `);
});

// Manifest Endpoints (Supports optional /rd_api_key=YOUR_KEY prefix)
const getManifest = () => ({
    id: "org.myrunningman.addon",
    version: "1.0.3",
    name: "MyRunningMan Scraper",
    description: "Fetches magnet & Debrid streams directly from MyRunningMan.com",
    icon: "https://myrunningman.com/assets/img/appstore.png",
    background: "https://myrunningman.com/assets/epimg/817_temp.jpg",
    resources: ["stream"],
    types: ["series", "tv"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: { configurable: true }
});

app.get("/manifest.json", (req, res) => res.json(getManifest()));
app.get("/rd_api_key=:key/manifest.json", (req, res) => res.json(getManifest()));

// Stream Handler Endpoints
app.get("/stream/:type/:id.json", async (req, res) => {
    const idParts = req.params.id.split(":");
    let streams = [];
    if (idParts.length >= 3) {
        streams = await scrapeMyRunningMan(idParts[2], null);
    }
    res.json({ streams });
});

app.get("/rd_api_key=:key/stream/:type/:id.json", async (req, res) => {
    const rdApiKey = req.params.key;
    const idParts = req.params.id.split(":");
    let streams = [];
    if (idParts.length >= 3) {
        streams = await scrapeMyRunningMan(idParts[2], rdApiKey);
    }
    res.json({ streams });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Addon running on port ${PORT}`);
});