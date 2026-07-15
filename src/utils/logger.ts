import fs from 'fs'; // Put this at the very top with your other imports

export function logAIDecision(signal, reason, executionRecord) {
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