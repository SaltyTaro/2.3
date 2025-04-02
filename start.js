#!/usr/bin/env node

/**
 * Startup script for the MEV Sandwich Bot
 * This script handles command line arguments and starts the bot with the appropriate configuration
 */

const MEVSandwichBot = require('./index');
const { logger } = require('./utils/logger');
const fs = require('fs');
const path = require('path');

// Process command line arguments
const args = process.argv.slice(2);
const options = {
  mode: 'production',
  logLevel: 'info',
  configFile: null,
  help: false,
  dryRun: false,
  simulation: false
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  switch (arg) {
    case '--dev':
    case '-d':
      options.mode = 'development';
      break;
    case '--test':
    case '-t':
      options.mode = 'test';
      break;
    case '--log-level':
    case '-l':
      options.logLevel = args[++i];
      break;
    case '--config':
    case '-c':
      options.configFile = args[++i];
      break;
    case '--help':
    case '-h':
      options.help = true;
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--simulation':
    case '-s':
      options.simulation = true;
      break;
  }
}

// Display help message
if (options.help) {
  console.log(`
MEV Sandwich Bot - A flash loan-based sandwich trading bot for Ethereum

Usage: node start.js [options]

Options:
  --dev, -d           Run in development mode
  --test, -t          Run in test mode
  --log-level, -l     Set log level (error, warn, info, debug, verbose)
  --config, -c        Specify a custom config file
  --dry-run           Run without executing actual transactions
  --simulation, -s    Run in simulation mode using historical data
  --help, -h          Display this help message

Examples:
  node start.js                     Start the bot in production mode
  node start.js --dev               Start the bot in development mode
  node start.js --log-level debug   Start with debug logging
  node start.js --simulation        Run simulations without real transactions
  `);
  process.exit(0);
}

// Set NODE_ENV based on mode
process.env.NODE_ENV = options.mode;

// Load custom config if specified
if (options.configFile) {
  if (!fs.existsSync(options.configFile)) {
    console.error(`Error: Config file not found: ${options.configFile}`);
    process.exit(1);
  }
  
  try {
    const customConfig = require(path.resolve(options.configFile));
    Object.assign(require('./config'), customConfig);
  } catch (error) {
    console.error(`Error loading custom config: ${error.message}`);
    process.exit(1);
  }
}

// Set log level
logger.setLogLevel(options.logLevel);

// Set simulation mode if specified
if (options.simulation) {
  process.env.SIMULATION_MODE = 'true';
  logger.info('Running in simulation mode - no real transactions will be executed');
}

// Set dry run mode if specified
if (options.dryRun) {
  process.env.DRY_RUN = 'true';
  logger.info('Running in dry run mode - transactions will be simulated but not sent');
}

// Start the bot
logger.info(`Starting MEV Sandwich Bot in ${options.mode} mode...`);

const bot = new MEVSandwichBot();
bot.start().catch(error => {
  logger.error(`Failed to start bot: ${error.message}`);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT. Shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM. Shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});