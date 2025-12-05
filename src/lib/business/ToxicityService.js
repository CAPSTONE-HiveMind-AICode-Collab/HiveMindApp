import * as toxicity from "@tensorflow-models/toxicity";

let model = null;
const threshold = 0.9;

// Load once → reused for all messages
export async function loadToxicityModel() {
  if (!model) {
    model = await toxicity.load(threshold);
  }
  return model;
}

export async function isToxicMessage(text) {
  if (!model) {
    await loadToxicityModel();
  }

  try {
    const predictions = await model.classify([text]);

    // Check if any label marks the message as toxic
    for (const p of predictions) {
      if (p.results[0].match === true) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("Tensor model failed:", err);
    return false; // fail-safe
  }
}
