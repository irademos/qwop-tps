export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.VITE_METERED_API_KEY;
  if (!apiKey) {
    // Return STUN-only fallback when key is absent
    return res.status(200).json([{ urls: 'stun:stun.l.google.com:19302' }]);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const upstream = await fetch(
      `https://multiplayer-game.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { signal: controller.signal }
    );
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const list = await upstream.json();
    const stun = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turn = Array.isArray(list)
      ? list.filter(s => typeof s.urls === 'string' && s.urls.startsWith('turn')).slice(0, 2)
      : [];
    return res.status(200).json([...stun, ...turn]);
  } catch (err) {
    return res.status(200).json([{ urls: 'stun:stun.l.google.com:19302' }]);
  } finally {
    clearTimeout(timeoutId);
  }
}
