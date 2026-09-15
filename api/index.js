const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const manifest = {
  id: "org.directstream.addon",
  version: "1.0.0",
  name: "Direct Stream Addon",
  description: "Resolves direct streams for in-app playback",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

// 1. Fetch title and year from Cinemeta using the Stremio IMDb ID
async function getMediaMeta(type, id) {
  try {
    const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`, { timeout: 5000 });
    return res.data?.meta ? { title: res.data.meta.name, year: res.data.meta.year } : null;
  } catch {
    return null;
  }
}

// 2. Search index and locate post
async function searchSite(query) {
  try {
    const searchUrl = `https://uhdmovies.autos/?s=${encodeURIComponent(query)}`;
    const { data } = await axios.get(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36" },
      timeout: 7000
    });
    const $ = cheerio.load(data);
    const firstPost = $("article a").first().attr("href");
    return firstPost || null;
  } catch {
    return null;
  }
}

// 3. Resolve the raw media container (.mp4, .mkv, .m3u8)
async function extractDirectStream(postUrl) {
  try {
    const { data } = await axios.get(postUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36" },
      timeout: 7000
    });
    const $ = cheerio.load(data);

    let rawStreamUrl = null;

    // Search for direct media file endpoints
    $("a[href$='.mp4'], a[href$='.mkv'], source[src$='.mp4'], source[src$='.m3u8']").each((_, el) => {
      const link = $(el).attr("href") || $(el).attr("src");
      if (link && !rawStreamUrl) rawStreamUrl = link;
    });

    return rawStreamUrl;
  } catch {
    return null;
  }
}

// 4. Stream endpoint handler
builder.defineStreamHandler(async (args) => {
  if (!args.id.startsWith("tt")) return { streams: [] };

  const meta = await getMediaMeta(args.type, args.id);
  if (!meta) return { streams: [] };

  const postUrl = await searchSite(meta.title);
  if (!postUrl) return { streams: [] };

  const directVideo = await extractDirectStream(postUrl);
  if (!directVideo) return { streams: [] };

  return {
    streams: [
      {
        name: "Direct Source",
        title: `${meta.title} - In-App Playback`,
        // 'url' opens directly inside the Stremio player
        url: directVideo,
        behaviorHints: {
          notWebReady: false
        }
      }
    ]
  };
});

const addonInterface = builder.getInterface();

module.exports = (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/manifest.json" || url === "/") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(addonInterface.manifest));
  }

  const match = url.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\.json$/);
  if (match) {
    const [, resource, type, id] = match;
    return addonInterface.get(resource, type, id).then((resp) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resp));
    }).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  }

  res.statusCode = 404;
  res.end();
};
