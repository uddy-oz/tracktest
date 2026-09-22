export default async function handler(req, res) {
  try {
    const query = new URLSearchParams(req.query).toString();

    const response = await fetch(`https://itunes.apple.com/lookup?${query}`, {
      headers: {
        "User-Agent": "StanZer/1.0",
      },
    });

    const text = await response.text();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    if (response.ok) {
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.setHeader(
        "Vercel-CDN-Cache-Control",
        "public, s-maxage=86400, stale-while-revalidate=604800"
      );
      res.setHeader(
        "CDN-Cache-Control",
        "public, s-maxage=86400, stale-while-revalidate=604800"
      );
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    return res.status(response.status).send(text);
  } catch (error) {
    console.error("iTunes lookup API error:", error);

    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({
      error: "Could not load iTunes album tracks.",
    });
  }
}
