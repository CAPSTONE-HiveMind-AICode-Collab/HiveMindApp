export async function generateImageDescription(imageUrl, options = {}) {
    const res = await fetch("/api/image-caption", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            imageUrl,
            maxTokens: options.maxTokens ?? 40,
        }),
    });
    if (!res.ok) {
    const text = await res.text();
    console.error("generateImageDescription failed:", res.status, text);
    throw new Error("Caption API failed");
  }

  const data = await res.json();
  if (data.error) {
    console.error("generateImageDescription error:", data.error);
    throw new Error(data.error);
  }

  return data.description;
}
