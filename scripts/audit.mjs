#!/usr/bin/env node
/**
 * Custom npm audit runner that allows specific advisories.
 *
 * Advisories ignored with documented reasoning:
 *
 * HIGH SEVERITY (transitive dependencies of Next.js 15, require Next.js 16 to fix - breaking change):
 * - GHSA-qx2v-qp2m-jg93 (postcss XSS)
 * - GHSA-6g55-p6wh-862q (postcss arbitrary file read)
 * - GHSA-r28c-9q8g-f849 (postcss path traversal)
 * - GHSA-fxqj-rqcc-2cmp (postcss incomplete fix)
 * - GHSA-f88m-g3jw-g9cj (sharp libvips CVEs)
 * - GHSA-5p4m-2wfm-xmqj (js-yaml quadratic CPU)
 * - GHSA-2v37-7h3g-55p8 (nanoid infinite loop)
 * - GHSA-mh99-v99m-4gvg (brace-expansion DoS)
 * - GHSA-rgw5-rvv9-x895 (brace-expansion DoS)
 *
 * CRITICAL SEVERITY (transitive dependency @mapbox/node-pre-gyp, no fix without major refactor):
 * - GHSA-34x7-hfp2-rc4v through GHSA-r292-9mhp-454m (tar vulnerabilities)
 */

import { execSync } from 'child_process';

const ALLOWED_ADVISORIES = new Set([
  // postcss (Next.js transitive)
  'GHSA-qx2v-qp2m-jg93',
  'GHSA-6g55-p6wh-862q',
  'GHSA-r28c-9q8g-f849',
  'GHSA-fxqj-rqcc-2cmp',
  // sharp (libvips)
  'GHSA-f88m-g3jw-g9cj',
  // js-yaml
  'GHSA-5p4m-2wfm-xmqj',
  // nanoid
  'GHSA-2v37-7h3g-55p8',
  // brace-expansion
  'GHSA-mh99-v99m-4gvg',
  'GHSA-rgw5-rvv9-x895',
  // tar (@mapbox/node-pre-gyp transitive)
  'GHSA-34x7-hfp2-rc4v',
  'GHSA-8qq5-rm4j-mr97',
  'GHSA-83g3-92jg-28cx',
  'GHSA-qffp-2rhf-9h96',
  'GHSA-9ppj-qmqm-q256',
  'GHSA-r6q2-hw4h-h46w',
  'GHSA-vmf3-w455-68vh',
  'GHSA-w8wr-v893-vjvp',
  'GHSA-23hp-3jrh-7fpw',
  'GHSA-8x88-c5mf-7j5w',
  'GHSA-gvwx-54wh-qm9j',
  'GHSA-r292-9mhp-454m',
]);

function runAudit() {
  let output;
  try {
    output = execSync('npm audit --json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    // npm audit returns non-zero exit code when vulnerabilities found
    // but still outputs JSON to stdout
    if (error.stdout) {
      output = error.stdout.toString();
    } else {
      console.error('Error running npm audit:', error.message);
      return 1;
    }
  }

  let audit;
  try {
    audit = JSON.parse(output);
  } catch (parseError) {
    console.error('Failed to parse npm audit output:', parseError.message);
    return 1;
  }

  if (!audit.vulnerabilities || Object.keys(audit.vulnerabilities).length === 0) {
    console.log('No vulnerabilities found.');
    return 0;
  }

  let hasUnallowed = false;
  let totalVulns = 0;
  let allowedVulns = 0;

  for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
    if (vuln.via) {
      for (const via of vuln.via) {
        if (typeof via === 'object' && via.url) {
          // Extract advisory ID from URL
          const match = via.url.match(/GHSA-[a-z0-9-]+/);
          if (match) {
            const advisoryId = match[0];
            totalVulns++;
            if (ALLOWED_ADVISORIES.has(advisoryId)) {
              console.log(`ALLOWED: ${name} - ${advisoryId} (${via.title || 'No title'})`);
              allowedVulns++;
            } else {
              console.error(`BLOCKED: ${name} - ${advisoryId} (${via.title || 'No title'})`);
              hasUnallowed = true;
            }
          }
        } else if (typeof via === 'string' && via.startsWith('GHSA-')) {
          totalVulns++;
          if (ALLOWED_ADVISORIES.has(via)) {
            console.log(`ALLOWED: ${name} - ${via}`);
            allowedVulns++;
          } else {
            console.error(`BLOCKED: ${name} - ${via}`);
            hasUnallowed = true;
          }
        }
      }
    }
  }

  console.log(`\nTotal vulnerabilities: ${totalVulns}`);
  console.log(`Allowed (documented): ${allowedVulns}`);
  console.log(`Unallowed: ${totalVulns - allowedVulns}`);

  if (hasUnallowed) {
    console.error('\nFAIL: Unallowed vulnerabilities detected. Fix or document them.');
    return 1;
  }

  console.log('\nPASS: All vulnerabilities are documented and allowed.');
  return 0;
}

process.exit(runAudit());
