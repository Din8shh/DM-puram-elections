// Load the voter roll into Supabase and create the first admin login.
//
//   1. Put the voter data folder (voters.json, hamlets.json, photos/) at ./data
//   2. Create a file named .env next to package.json with:
//        SUPABASE_URL=https://xxxx.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=eyJ...      (Project Settings > API > service_role; keep it secret)
//        ADMIN_USERNAME=dinesh
//        ADMIN_PASSWORD=choose-a-strong-one
//   3. npm install && npm run import
//
// Re-running is safe: roll details are updated, campaign data (leaning, notes, voted…) is kept.
// Add --no-photos to skip uploading photos.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { translit, voterKey } from "../web/js/translit.js";

const EMAIL_DOMAIN = "team.dmpuram.local";
if (existsSync(".env")) process.loadEnvFile(".env");
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
const DATA = process.env.DATA_DIR || "data";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const die = (msg, err) => { console.error(msg, err?.message ?? err ?? ""); process.exit(1); };

// 1. Admin login
if (ADMIN_USERNAME && ADMIN_PASSWORD) {
  const username = ADMIN_USERNAME.trim().toLowerCase();
  const { data: existing } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) {
    console.log(`Admin "${username}" already exists, skipping.`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({
      email: `${username}@${EMAIL_DOMAIN}`, password: ADMIN_PASSWORD, email_confirm: true,
    });
    if (error) die("Could not create admin user:", error);
    const { error: pErr } = await sb.from("profiles").insert({
      id: data.user.id, username, full_name: username, role: "admin",
    });
    if (pErr) die("Could not create admin profile:", pErr);
    console.log(`Created admin login "${username}".`);
  }
}

// 2. Hamlets
const hamlets = JSON.parse(readFileSync(join(DATA, "hamlets.json"), "utf8"));
{
  const { error } = await sb.from("hamlets").upsert(hamlets);
  if (error) die("Hamlets:", error);
  console.log(`${hamlets.length} hamlets loaded.`);
}

// 3. Voters (roll columns only, so campaign data is never overwritten)
const voters = JSON.parse(readFileSync(join(DATA, "voters.json"), "utf8")).map((v) => ({
  serial: v.serial, ward: v.ward, hamlet_id: v.hamlet_id, part_ref: v.part_ref,
  name: v.name, name_en: translit(v.name), relation_type: v.relation_type,
  relation_name: v.relation_name, relation_name_en: translit(v.relation_name),
  age: v.age, gender: v.gender, house_no: v.house_no, epic: v.epic,
  photo_path: v.photo_path, needs_review: v.needs_review, search_key: voterKey(v),
}));
for (let i = 0; i < voters.length; i += 500) {
  const { error } = await sb.from("voters").upsert(voters.slice(i, i + 500), { onConflict: "serial" });
  if (error) die("Voters:", error);
  process.stdout.write(`\rVoters: ${Math.min(i + 500, voters.length)}/${voters.length}`);
}
console.log();

// 4. Photos into the private "photos" bucket
if (!process.argv.includes("--no-photos")) {
  const dir = join(DATA, "photos");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg"));
  let done = 0, failed = 0;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      const { error } = await sb.storage.from("photos").upload(f, readFileSync(join(dir, f)), {
        contentType: "image/jpeg", upsert: true, cacheControl: "86400",
      });
      if (error) { failed++; if (failed < 5) console.error(`\n${f}:`, error.message); }
      done++;
      if (done % 25 === 0 || done === files.length) process.stdout.write(`\rPhotos: ${done}/${files.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(failed ? `\n${failed} photos failed; run again to retry.` : "\nPhotos uploaded.");
}
console.log("Done.");
