const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

async function main() {
  const provider = "0x14B81D8aB44cC1C1a2e8895BF8aCa2C2867aa81D";

  // First count
  const { data: before, error: countErr } = await supabase
    .from("services")
    .select("id, name, status")
    .eq("owner_address", provider);

  if (countErr) {
    console.error("Error counting:", countErr.message);
    process.exit(1);
  }

  console.log(`Found ${before.length} services from provider ${provider}`);

  if (before.length === 0) {
    console.log("Nothing to quarantine.");
    process.exit(0);
  }

  // Update all to quarantined
  const { error } = await supabase
    .from("services")
    .update({ status: "quarantined", verified_status: "bare_402" })
    .eq("owner_address", provider);

  if (error) {
    console.error("Error updating:", error.message);
    process.exit(1);
  }

  console.log(`Quarantined ${before.length} services successfully.`);

  // Verify
  const { data: after } = await supabase
    .from("services")
    .select("id, status")
    .eq("owner_address", provider)
    .eq("status", "quarantined");

  console.log(`Verification: ${after?.length || 0} services now quarantined.`);
}

main();
