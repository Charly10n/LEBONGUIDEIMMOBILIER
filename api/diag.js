// /api/diag.js — ESM
export default async function handler(req, res) {
  try {
    const hasKey = !!process.env.OPENAI_API_KEY;
    return res.status(200).json({
      runtime: process.version,
      node_fetch_available: typeof fetch === 'function',
      openai_key_present: hasKey
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
