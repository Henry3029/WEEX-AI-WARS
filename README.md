# WEEX AI Wars Bot: Rise of Intelligence.

An autonomous AI-driven trading bot built for the WEEX AI Wars II Hackathon on DoraHacks. This bot uses data-driven signals to trade perpetual contracts safely within the competition's 20x leverage constraints.

1. Key Features
Autonomous Signal Execution: Completely hands-off perpetual contract trading.

Risk Management: Strict hardcoded 20x leverage limits to ensure compliance.

Security First: Uses environment variables (.env) to keep API credentials safe.


2. Prerequisites & Tech Stack
What tools did you build this with?

Node.js (v18 or higher)

TypeScript

CCXT Library (for exchange connectivity)

3. Setup & Installation
# Clone the repository
git clone https://github.com/Henry3029/WEEX-AI-WARS

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# (fill in your WEEX API keys inside the .env file)