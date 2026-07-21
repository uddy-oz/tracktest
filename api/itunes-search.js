export default async function handler(req, res) {
  try {
    const query = new URLSearchParams(req.query).toString();

    const response = await fetch(`https://itunes.apple.com/search?${query}`, {
      headers: {
        "User-Agent": "StanZer/1.0",
      },
    });

    const text = await response.text();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    return res.status(response.status).send(text);
  } catch (error) {
    console.error("iTunes search API error:", error);

    return res.status(500).json({
      error: "Could not search iTunes.",
    });
  }
}
