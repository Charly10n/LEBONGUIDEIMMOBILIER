// api/analyze-ia.js — Version CommonJS (Vercel) — Mode EXPERT renforcé (neuf/RE2020 ultra précis)
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    // --- Parse JSON
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const form = body.form;
    if (!form) return res.status(400).json({ error: "Champ 'form' manquant" });

    // --- Calculs d'ancrage
    const prixM2 = (form.prixVente && form.surfaceHab) ? Math.round(form.prixVente / form.surfaceHab) : 0;
    const annee = Number(form.anneeConstr || 0);
    const etat = String(form.etatGeneral || "").toLowerCase();
    const isNeuf = (annee >= 2021) || etat.includes("neuf") || etat.includes("récemment");

    // --- Contexte neuf/RT2012/RE2020 (exigences et seuils à vérifier)
    const contexteNeuf = `
Si NEUF/RE2020 (année ≥ 2021 OU état "neuf/récemment rénovée") :
- Exige des VALS exactes ou des fourchettes réalistes :
  • q4Pa-surf (perméabilité à l'air) : viser ≤ 0,6 m³/h·m² (maison individuelle)
  • Cep,nr (conso énergie primaire non renouvelable) : conforme RE2020 (très bas)
  • Bbio : conforme, inférieur au max réglementaire
  • Système chauffage : PAC (SCOP ≈ 3,5–4,5) OU équivalent performant
  • ECS : chauffe-eau thermodynamique (COP ≈ 2–3) ou équivalent
  • Ventilation : hygro B ou double flux ; donner débit et équilibrage
  • DPE attendu : A (sinon expliquer pourquoi)
  • Production PV si présente : puissance kWc et couverture conso
- Documents/Preuves à exiger :
  PV test d'étanchéité (blower door), Attestation RE2020/RT2012 selon année,
  Consuel élec, Attestations isolants (R des parois), DOE/Plans “as built”,
  Garanties : décennale entreprises, dommages-ouvrage, parfait achèvement,
  Notices/commissions des équipements (PAC, VMC, CET), factures/numéros de série.
- Chiffres à donner : conso chauffage estimée (kWh/an et €/an avec 0,20 €/kWh),
  risques de dérive si défaut (ex: +20–40% conso si q4Pa-surf > 0,9).
`;

    const contexteAncien = `
Si RT2012 (2013–2020) : contrôle q4Pa-surf ≤ 0,6–0,8 ; attestation RT2012 ; PAC/CET fréquents.
Si ancien (avant 2013) : parler ponts thermiques, isolation combles (≥ 30 cm), menuiseries, système de chauffage (PAC conseillée), ventilation, humidité.
`;

    // --- PROMPT strict + schéma
    const prompt = `
Rôle: EXPERT IMMOBILIER FRANÇAIS (20 ans). Tu protèges l'acheteur. Style: pro, cash, CHIFFRÉ, vérifiable.

Données du bien (JSON):
${JSON.stringify(form, null, 2)}

Données calculées:
- prix_m2_calculé: ${prixM2} €/m²
- profil_bien: ${isNeuf ? "NEUF/RE2020 présumé" : (annee >= 2013 ? "RT2012/2013-2020 présumé" : "Ancien")}

${isNeuf ? contexteNeuf : contexteAncien}

Objectif: produire un DIAGNOSTIC CONCRET "prêt à décider".

Réponds STRICTEMENT en JSON (rien d'autre), au format:
{
  "forts": [
    "Avantage concret + QUANTIFICATION (ex: 'q4Pa-surf 0,5: très étanche, -10–20% pertes vs seuil')",
    "... (max 6)"
  ],
  "vigilances": [
    "FORMAT PAR ÉLÉMENT: Titre — Pourquoi/impact (avec CHIFFRES) — Preuve à exiger (document/test précis) — Estimation coût (€ si travaux) — Priorité: haute|moyenne|basse",
    "... (max 6)"
  ],
  "ameliorations": [
    {
      "action": "Travaux/optimisation précis (ex: 'Équilibrage VMC double flux + filtre M5')",
      "impact_dpe": "faible|moyen|fort|+1 classe|+2 classes",
      "gain": "Ordre de grandeur (ex: '-15 à -25% chauffage' ou '+8–12 k€ valeur revente')",
      "roi": "Retour estimé (ex: '4–6 ans à 0,20 €/kWh')"
    },
    {
      "action": "...",
      "impact_dpe": "...",
      "gain": "...",
      "roi": "..."
    }
  ]
}

RÈGLES GÉNÉRALES:
- Max 6 forts, max 6 vigilances, EXACTEMENT 2 améliorations.
- Utilise: année, DPE, état, travaux<10 ans, double vitrage, piscine/garage, surfaces, PRIX/M² CALCULÉ.
- S'il manque des infos critiques (ex: q4Pa-surf, attestation RE2020, Consuel), mentionne-le dans les VIGILANCES avec "Preuve à exiger" et impact chiffré.
- Pas de bla-bla: toujours une VALEUR, une FOURCHETTE, ou un DOCUMENT à demander.
- Français de France, concis, décisif, protecteur de l'acheteur.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2, // précis/déterministe
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Tu es un expert immobilier français très cash, factuel et chiffré. Tu protèges l'acheteur." },
        { role: "user", content: prompt }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    // --- Parsing + normalisation défensive
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      return res.status(500).json({ error: "Réponse IA non JSON" });
    }

    const forts = Array.isArray(parsed.forts) ? parsed.forts.filter(Boolean).slice(0, 6) : [];

    let vigilances = Array.isArray(parsed.vigilances) ? parsed.vigilances.filter(Boolean).slice(0, 6) : [];
    vigilances = vigilances.map(v => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const t = [
          v.intitulé || v.titre || "",
          v.pourquoi || v.impact || "",
          v.preuve_a_demander || v.preuve || "",
          (v.estimation_cout || v.cout || ""),
          v.priorite ? `Priorité: ${v.priorite}` : ""
        ].filter(Boolean).join(" — ");
        return t || "Vérifications techniques à préciser — Priorité: moyenne";
      }
      return String(v || "");
    });

    const amelsRaw = Array.isArray(parsed.ameliorations) ? parsed.ameliorations
                    : Array.isArray(parsed.amels) ? parsed.amels : [];
    const ameliorations = amelsRaw.slice(0, 2).map(a =>
      (typeof a === "string")
        ? { action: a, impact_dpe: null, gain: null, roi: null }
        : {
            action: a.action || "",
            impact_dpe: a.impact_dpe ?? null,
            gain: a.gain ?? null,
            roi: a.roi ?? null
          }
    );

    if (!forts.length || !vigilances.length || ameliorations.length < 2) {
      return res.status(500).json({ error: "Réponse IA incomplète" });
    }

    return res.status(200).json({ forts, vigilances, ameliorations });
  } catch (err) {
    const msg =
      err?.response?.data?.error?.message ||
      err?.error?.message ||
      err?.message ||
      "Erreur serveur IA";
    return res.status(500).json({ error: msg });
  }
};
