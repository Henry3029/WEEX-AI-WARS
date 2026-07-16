import fs from 'fs'; // Put this at the very top with your other imports


// Add these interfaces to the very top of logger.ts
interface MarketIndicators {
  fastEma: string;
  slowEma: string;
  rsi: string;
}

export interface ExecutionRecord {
  mode: string;
  asset: string;
  action: string;
  executionPrice: number;
  indicators: MarketIndicators;
  status: string;
}

export function logAIDecision(signal: string, reason: string, executionRecord: ExecutionRecord) {
    const timestamp = new Date().toLocaleTimeString();
    
    // 1. Format the block beautifully
    const logEntry = `
==================================================
[AI DECISION LOG] - ${timestamp}
--------------------------------------------------
• SIGNAL TRIGGER : ${signal}
• DECISION REASON: ${reason}
• EXECUTION REC : ${JSON.stringify(executionRecord)}
==================================================
`;

    // 2. Stream to console (This is saved on Render's dashboard)
    console.log(logEntry);

    // 3. Write to the file (This is your local proof)
    fs.appendFile('ai_decisions.log', logEntry + '\n', (err) => {
        if (err) {
            // We log the error but don't let it crash the engine
            console.warn('⚠️ Warning: Could not write to log file:', err.message);
        }
    });
}