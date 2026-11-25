// Telugu → rough English spelling, and a forgiving "search key" so that
// typing "lakshmi", "laxmi" or "lakshmee" all find లక్ష్మి.
// Shared by the browser app and scripts/import.mjs.

const V = { "అ": "a", "ఆ": "aa", "ఇ": "i", "ఈ": "ee", "ఉ": "u", "ఊ": "oo", "ఋ": "ru", "ఎ": "e", "ఏ": "e",
  "ఐ": "ai", "ఒ": "o", "ఓ": "o", "ఔ": "au" };
const M = { "ా": "aa", "ి": "i", "ీ": "ee", "ు": "u", "ూ": "oo", "ృ": "ru", "ె": "e", "ే": "e", "ై": "ai",
  "ొ": "o", "ో": "o", "ౌ": "au" };
const C = { "క": "k", "ఖ": "kh", "గ": "g", "ఘ": "gh", "ఙ": "n", "చ": "ch", "ఛ": "ch", "జ": "j", "ఝ": "jh",
  "ఞ": "n", "ట": "t", "ఠ": "th", "డ": "d", "ఢ": "dh", "ణ": "n", "త": "t", "థ": "th", "ద": "d",
  "ధ": "dh", "న": "n", "ప": "p", "ఫ": "ph", "బ": "b", "భ": "bh", "మ": "m", "య": "y", "ర": "r",
  "ఱ": "r", "ల": "l", "ళ": "l", "వ": "v", "శ": "s", "ష": "sh", "స": "s", "హ": "h" };
const VIRAMA = "్", ANUSVARA = "ం", VISARGA = "ః";

export function hasTelugu(s) {
  return /[ఀ-౿]/.test(s || "");
}

export function translit(s) {
  s = s || "";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const nxt = s[i + 1] || "";
    if (C[ch]) {
      out += C[ch];
      if (M[nxt]) { out += M[nxt]; i++; }
      else if (nxt === VIRAMA) { i++; }
      else out += "a";
    } else if (V[ch]) out += V[ch];
    else if (ch === ANUSVARA) out += (!C[nxt] || "mpbv".includes(C[nxt][0])) ? "m" : "n";
    else if (ch === VISARGA) out += "h";
    else if (ch === "‌" || ch === "‍") { /* skip joiners */ }
    else out += ch;
  }
  return out.replace(/\s+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Collapse spelling differences: long vowels, doubled letters, h, w/v, z/j, -iah/-ayya …
export function searchKey(s) {
  let t = (hasTelugu(s) ? translit(s) : s || "").toLowerCase();
  t = t.replace(/[^a-z0-9 ]/g, " ");
  t = t.replace(/aiah|iah/g, "aya").replace(/ai/g, "ay")
    .replace(/ee/g, "i").replace(/oo/g, "u").replace(/ou/g, "u")
    .replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/x/g, "ks")
    .replace(/c(?!h)/g, "k").replace(/ph/g, "f").replace(/h/g, "")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/\s+/g, " ").trim();
  return t;
}

export function voterKey(v) {
  return [searchKey(v.name), searchKey(v.relation_name)].join(" | ");
}
