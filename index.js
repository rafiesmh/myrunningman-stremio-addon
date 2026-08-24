const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// Real-Debrid API Key setup
const RD_API_KEY = process.env.RD_API_KEY || ""; // You can set this in Render environment variables

const manifest = {
    id: "org.myrunningman.addon",
    version: "1.0.2",
    name: "MyRunningMan Scraper",
    description: "Fetches streams directly from MyRunningMan.com",
    icon: "https://myrunningman.com/assets/img/appstore.png",
    background: "https://myrunningman.com/assets/epimg/817_temp.jpg",
    resources: ["stream"],
    types: ["series", "tv"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

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

async function scrapeMyRunningMan(episodeNum) {
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

            if (RD_API_KEY) {
                // Resolve magnet via Real-Debrid into direct HTTPS video link
                const httpUrl = await resolveRealDebridLink(magnetUrl, RD_API_KEY);
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

            // Fallback to raw magnet if no Real-Debrid key is provided or resolution fails
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

builder.defineStreamHandler(async (args) => {
    const idParts = args.id.split(":");
    if (idParts.length >= 3) {
        const episodeNum = idParts[2];
        const streams = await scrapeMyRunningMan(episodeNum);
        return { streams };
    }
    return { streams: [] };
});

const PORT = process.env.PORT || 7001;
serveHTTP(builder.getInterface(), { port: PORT, host: "0.0.0.0" });
console.log(`Stremio Addon running on port ${PORT}`);