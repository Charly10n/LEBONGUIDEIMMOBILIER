export default async function handler(req, res) {
  const { url } = await req.json();

  const prompt = `
Tu es un expert en immobilier et travaux en France.
Analyse cette annonce: ${url}
Donne les points forts, les risques, et une estimation du coût des travaux.
Sois concret et rapide.
`;

  const key = process.env.OPENAI_API_KEY;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
    }),
  });

  const data = await r.json();
  res.status(200).send(data.choices?.[0]?.message?.content || "Erreur IA");
}
