"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAIDecision = logAIDecision;
const fs_1 = require("fs");
function logAIDecision(signal, reason, executionRecord) {
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
    async function writeLog(logEntry) {
        try {
            await fs_1.promises.appendFile('ai_decisions.log', logEntry + '\n');
        }
        catch (err) {
            console.error('Failed to write to log file:', err);
        }
    }
}
