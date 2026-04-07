// src/lib/data/imageCaptionRepository.js
export async function getLocalImageCaption(imageUrl, maxTokens = 40) {
  const endpoint =
    process.env.NEXT_PUBLIC_CAPTION_API_URL ||
    "http://127.0.0.1:8000/caption/url";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    throw new Error(`Caption API failed: ${res.status}`);
  }

  const data = await res.json();
  return data.description || "";
}