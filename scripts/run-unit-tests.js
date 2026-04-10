#!/usr/bin/env node
// Run all test files except e2e.test.js (which requires a live server).
// Usage: node scripts/run-unit-tests.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const testsDir = path.join(__dirname, "..", "tests");
const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.js") && !f.includes("e2e"))
  .map((f) => path.join("tests", f));

if (files.length === 0) {
  console.error("No test files found");
  process.exit(1);
}

try {
  execFileSync("node", ["--test", ...files], { stdio: "inherit" });
} catch (err) {
  process.exit(err.status || 1);
}
