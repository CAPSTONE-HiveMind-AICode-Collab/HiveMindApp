// src/lib/business/imageCaptionSanitizer.js

function cleanWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s([?.!,;:])/g, "$1")
    .trim();
}

function sentenceCase(text) {
  const t = cleanWhitespace(text);
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function hasAny(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function detectVisibleHints(raw = "") {
  const t = raw.toLowerCase();

  return {
    hasPerson:
      hasAny(t, [
        "person",
        "man",
        "woman",
        "boy",
        "girl",
        "people",
        "face",
        "portrait",
        "selfie",
      ]),
    hasMultiplePeople: hasAny(t, ["people", "group", "crowd", "team"]),
    hasVehicle: hasAny(t, ["car", "truck", "bus", "bike", "motorcycle", "vehicle", "train", "airplane"]),
    hasAnimal: hasAny(t, ["dog", "cat", "bird", "horse", "animal"]),
    hasText: hasAny(t, ["text", "sign", "screen", "display", "document", "poster", "label", "writing"]),
    indoor: hasAny(t, ["room", "indoor", "inside", "office", "kitchen", "bedroom"]),
    outdoor: hasAny(t, ["outdoor", "outside", "street", "road", "field", "sky", "park"]),
    closeUp: hasAny(t, ["close up", "close-up", "portrait", "face", "headshot", "selfie"]),
    clothing: hasAny(t, ["shirt", "jersey", "jacket", "hat", "uniform", "dress", "clothing"]),
    sportsLike: hasAny(t, ["jersey", "stadium", "ball", "pitch", "court", "sports"]),
  };
}

function detectCaptionRisk(rawCaption = "") {
  const raw = cleanWhitespace(rawCaption);
  const lower = raw.toLowerCase();

  let score = 0;
  const reasons = [];

  const speculativeWords = [
    "celebrating",
    "celebrates",
    "celebration",
    "after",
    "before",
    "during",
    "against",
    "wins",
    "won",
    "victory",
    "goal",
    "scored",
    "performing",
    "presenting",
    "teaching",
    "explaining",
    "working",
    "waiting",
    "thinking",
    "feeling",
    "smiling proudly",
    "successful",
    "nervous",
    "sad",
    "happy",
  ];

  const relationshipWords = [
    "mother",
    "father",
    "son",
    "daughter",
    "teacher",
    "student",
    "doctor",
    "manager",
    "employee",
    "friend",
    "family",
    "couple",
  ];

  const locationEventWords = [
    "spain",
    "portugal",
    "france",
    "brazil",
    "england",
    "world cup",
    "final",
    "match",
    "game",
    "tournament",
    "conference",
    "classroom",
    "office meeting",
  ];

  if (hasAny(lower, speculativeWords)) {
    score += 3;
    reasons.push("contains inferred action/event/emotion");
  }

  if (hasAny(lower, relationshipWords)) {
    score += 2;
    reasons.push("contains inferred identity/role/relationship");
  }

  if (hasAny(lower, locationEventWords)) {
    score += 2;
    reasons.push("contains inferred event/location/context");
  }

  // proper-name-ish heuristic: capitalized first+last pattern
  if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(raw)) {
    score += 3;
    reasons.push("contains possible person name");
  }

  // very narrative captions are often more speculative
  if (raw.split(" ").length > 14) {
    score += 1;
    reasons.push("caption is highly narrative");
  }

  if (score >= 5) return { level: "high", reasons };
  if (score >= 2) return { level: "medium", reasons };
  return { level: "low", reasons };
}

function buildObservableFallback(rawCaption = "") {
  const hints = detectVisibleHints(rawCaption);

  if (hints.hasMultiplePeople) {
    if (hints.outdoor) return "image showing multiple people outdoors";
    if (hints.indoor) return "image showing multiple people indoors";
    return "image showing multiple people";
  }

  if (hints.hasPerson) {
    if (hints.closeUp && hints.clothing) return "close-up image of a person wearing visible clothing";
    if (hints.closeUp) return "close-up image of a person";
    if (hints.outdoor) return "image showing a person outdoors";
    if (hints.indoor) return "image showing a person indoors";
    if (hints.sportsLike) return "image showing a person in sports clothing";
    return "image showing a person";
  }

  if (hints.hasVehicle) {
    if (hints.outdoor) return "image showing a vehicle outdoors";
    return "image showing a vehicle";
  }

  if (hints.hasAnimal) {
    return "image showing an animal";
  }

  if (hints.hasText) {
    return "image containing visible text or interface elements";
  }

  if (hints.indoor) return "image showing indoor objects or surroundings";
  if (hints.outdoor) return "image showing an outdoor scene";

  return "image showing visible subjects and background elements";
}

function lightlyRefineCaption(rawCaption = "") {
  let text = cleanWhitespace(rawCaption);

  // remove quote-like fragments
  text = text.replace(/["'`].*?["'`]/g, "").trim();

  // remove trailing narrative clauses introduced by these words
  text = text.replace(/\b(against|during|after|before|while)\b.*$/i, "").trim();

  // if it starts too narratively, leave decision to risk/fallback
  return sentenceCase(text);
}

export function sanitizeImageCaption(rawCaption, _options = {}) {
  const cleanedRaw = cleanWhitespace(rawCaption);
  const risk = detectCaptionRisk(cleanedRaw);

  let refined = lightlyRefineCaption(cleanedRaw);

  // If risky, use a safer observation-only fallback
  if (
    risk.level !== "low" ||
    refined.length < 8 ||
    refined.split(" ").length <= 2
  ) {
    refined = sentenceCase(buildObservableFallback(cleanedRaw));
  }

  if (refined.length > 140) {
    refined = refined.slice(0, 137).trim() + "...";
  }

  return {
    rawCaption: cleanedRaw,
    refinedCaption: refined,
    captionRisk: risk.level,
    captionNotes: risk.reasons,
  };
}