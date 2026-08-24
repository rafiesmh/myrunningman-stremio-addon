const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "org.myrunningman.addon",
    version: "1.0.0",
    name: "MyRunningMan Scraper",
    description: "Fetches magnet streams directly from MyRunningMan.com",
    resources: ["stream"],
    types: ["series", "tv"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// Standard trackers to append for faster torrent health & peer discovery
const TRACKERS = [
    "udp://tracker.moeking.me:6969/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "https://tr.abiir.top:443/announce",
    "udp://open.stealth.si:80/announce"
].map(t => `&tr=${encodeURIComponent(t)}`).join('');

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
        
        // Match all 40-character hex info hashes in the page source
        const hashMatches = html.match(/[a-fA-F0-9]{40}/g) || [];
        const uniqueHashes = [...new Set(hashMatches)];

        uniqueHashes.forEach((hash, index) => {
            // Construct full magnet URI using extracted infoHash + trackers
            const magnetUrl = `magnet:?xt=urn:btih:${hash}${TRACKERS}`;

            streams.push({
                name: "MyRunningMan",
                title: `Running Man - Ep ${episodeNum}\nOption ${index + 1}`,
                url: magnetUrl
            });
        });

        console.log(`[Scraper] Found ${streams.length} stream(s) for Episode ${episodeNum}`);
        return streams;

    } catch (error) {
        console.error(`[Scraper Error] Failed for Episode ${episodeNum}:`, error.message);
        return [];
    }
}

builder.defineStreamHandler(async (args) => {
    console.log(`[Stremio Request] Received ID: ${args.id}`);
    const idParts = args.id.split(":");
    
    if (idParts.length >= 3) {
        const episodeNum = idParts[2];
        const streams = await scrapeMyRunningMan(episodeNum);
        return { streams };
    }

    return { streams: [] };
});

const PORT = process.env.PORT || 7001;

serveHTTP(builder.getInterface(), { 
    port: PORT,
    host: "0.0.0.0" 
});

console.log(`Stremio Addon running on port ${PORT}`);