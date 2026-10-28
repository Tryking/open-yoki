// OpenRouter adapter: one JSON-answer chat call (images and audio allowed in `content`).
import { need, get } from "./env.mjs";

export const VISION_MODEL = () => get("STUDIO_VISION_MODEL", "google/gemini-3-flash-preview");
export const AUDIO_MODEL = () => get("STUDIO_AUDIO_MODEL", "google/gemini-2.5-pro");

export async function askJSON({ system, content, model = VISION_MODEL(), maxTokens = 4000, temperature }) {
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }];
  const body = { model, max_tokens: maxTokens, response_format: { type: "json_object" }, usage: { include: true }, messages };
  if (temperature != null) body.temperature = temperature;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { authorization: `Bearer ${need("openrouter")}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`OpenRouter ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  const txt = j.choices[0].message.content;
  const m = txt.match(/\{[\s\S]*\}/);
  return { data: JSON.parse(m ? m[0] : txt), cost: j.usage?.cost ?? null };
}

// Gemini returns boxes on a 0-1000 scale but sometimes switches to 0-1; normalise to 0-1.
export async function askBoxes(pics, what) {
  const system = `For each image, in order, give the box of ${what}. Reply JSON only: {"boxes":[{"top":0,"bottom":0,"left":0,"right":0}]} with integers on a 0-1000 scale of image height/width (0 = top/left). One box per image.`;
  const { data } = await askJSON({ system, content: [{ type: "text", text: `${pics.length} image(s).` }, ...pics.map((u) => ({ type: "image_url", image_url: { url: u } }))], maxTokens: 1500 });
  const flat = []; const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if ("top" in x && "bottom" in x) flat.push(x); else Object.values(x).forEach(walk); } };
  walk(data);
  if (!flat.length) throw new Error("box finder returned no boxes");
  const sc = Math.max(...flat.flatMap((x) => [x.bottom, x.right])) <= 1.5 ? 1 : 1000;
  return flat.map((x) => ({ top: x.top / sc, bottom: x.bottom / sc, left: x.left / sc, right: x.right / sc }));
}
