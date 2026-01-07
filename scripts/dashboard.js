import * as fs from 'node:fs';
import * as readline from 'node:readline';
import * as path from 'node:path';

async function runDashboard() {
  const logDir = path.join(process.cwd(), 'logs');
  const logPath = path.join(logDir, 'llm-usage.jsonl');
  
  if (!fs.existsSync(logPath)) {
    console.log("\n❌ Log file not found at 'logs/llm-usage.jsonl'.");
    console.log("Please export logs from the application's Settings panel and place the downloaded file in the 'logs' directory.\n");
    
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
        console.log("Created 'logs' directory for you.");
    }
    return;
  }

  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let stats = {
    gemini: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    dolphin: { calls: 0, inputTokens: 0, outputTokens: 0, savings: 0 },
    totalFallbacks: 0
  };

  // 2026 Estimated Rates for Gemini 3 Pro
  const GEMINI_INPUT_RATE = 2.00 / 1_000_000;
  const GEMINI_OUTPUT_RATE = 12.00 / 1_000_000;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);

    if (entry.provider.includes('Gemini')) {
      stats.gemini.calls++;
      stats.gemini.inputTokens += entry.inputTokens;
      stats.gemini.outputTokens += entry.outputTokens;
      stats.gemini.cost += entry.costUsd;
    } else if (entry.provider.includes('Dolphin')) {
      stats.dolphin.calls++;
      stats.dolphin.inputTokens += entry.inputTokens;
      stats.dolphin.outputTokens += entry.outputTokens;
      
      // Calculate what this WOULD have cost on Gemini
      const potentialCost = (entry.inputTokens * GEMINI_INPUT_RATE) + 
                            (entry.outputTokens * GEMINI_OUTPUT_RATE);
      stats.dolphin.savings += potentialCost;
    }

    if (entry.wasFallback) stats.totalFallbacks++;
  }

  renderTable(stats);
}

function renderTable(stats) {
  console.clear();
  console.log("\x1b[36m%s\x1b[0m", "====================================================");
  console.log("\x1b[36m%s\x1b[0m", "🚀 LLM ROUTING DASHBOARD - 2026 PREVIEW");
  console.log("\x1b[36m%s\x1b[0m", "====================================================");
  
  const totalCost = stats.gemini.cost;
  const totalSavings = stats.dolphin.savings;
  const potentialTotalCost = totalCost + totalSavings;
  const efficiencyGain = potentialTotalCost > 0 ? (totalSavings / potentialTotalCost) * 100 : 0;

  console.table({
    "Gemini 3 Pro (Paid Tier)": {
      "Requests": stats.gemini.calls,
      "Tokens (In/Out)": `${stats.gemini.inputTokens} / ${stats.gemini.outputTokens}`,
      "Actual Cost": `$${totalCost.toFixed(4)}`
    },
    "Dolphin Nemo (Local/HF)": {
      "Requests": stats.dolphin.calls,
      "Tokens (In/Out)": `${stats.dolphin.inputTokens} / ${stats.dolphin.outputTokens}`,
      "Money Saved": `+$${totalSavings.toFixed(4)}`
    }
  });

  console.log("----------------------------------------------------");
  console.log(`🛡️  Total Seamless Fallbacks: \x1b[33m${stats.totalFallbacks}\x1b[0m`);
  console.log(`💰 Net Efficiency Gain: \x1b[32m+${efficiencyGain.toFixed(1)}%\x1b[0m`);
  console.log("\x1b[36m%s\x1b[0m", "====================================================");
}

runDashboard();