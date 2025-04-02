#!/usr/bin/env node
const config = require('./config');
const { logger } = require('./utils/logger');
const MempoolObserver = require('./core/MempoolObserver');
const { getProviders } = require('./utils/providers');
const ethers = require('ethers');

/**
 * MEV Sandwich Trading Bot
 * 
 * This bot monitors the Ethereum mempool for potential sandwich opportunities,
 * executes sandwich attacks using flash loans, and tracks profits over time.
 */
class MEVSandwichBot {
  constructor() {
    logger.info('Initializing MEV Sandwich Bot...');
    
    // Print environment information
    this.logEnvironmentInfo();
    
    // Initialize providers
    const { provider } = getProviders();
    this.provider = provider;
    
    // Create observer
    this.observer = new MempoolObserver();
  }
  
  /**
   * Log environment information
   */
  async logEnvironmentInfo() {
    logger.info('MEV Sandwich Bot starting');
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Network: ${config.NETWORK} (Chain ID: ${config.CHAIN_ID})`);
    
    // Check contract state
    try {
      const balance = await this.provider.getBalance(config.CONTRACT_ADDRESS);
      logger.info(`Contract balance: ${ethers.utils.formatEther(balance)} ETH`);
    } catch (error) {
      logger.error('Failed to check contract balance', error);
    }
    
    // Log strategy parameters
    logger.info(`Strategy parameters:
      - Min Victim Size: ${config.MIN_VICTIM_SIZE} ETH
      - Max Gas Price: ${config.MAX_GAS_PRICE} gwei
      - Min Profit Threshold: ${config.MIN_PROFIT_THRESHOLD} ETH
      - Min Pair Liquidity: ${config.MIN_PAIR_LIQUIDITY} ETH
      - Max Pair Liquidity: ${config.MAX_PAIR_LIQUIDITY} ETH
      - Using Direct ETH: ${config.USE_DIRECT_ETH}
    `);
  }
  
  /**
   * Start the bot
   */
  async start() {
    logger.info('Starting MEV Sandwich Bot...');
    
    try {
      // Start mempool observer
      await this.observer.start();
      
      // Register cleanup handlers
      this.registerCleanupHandlers();
      
      logger.info('MEV Sandwich Bot started successfully');
    } catch (error) {
      logger.error('Failed to start MEV Sandwich Bot', error);
      process.exit(1);
    }
  }
  
  /**
   * Stop the bot
   */
  async stop() {
    logger.info('Stopping MEV Sandwich Bot...');
    
    try {
      // Stop mempool observer
      await this.observer.stop();
      
      logger.info('MEV Sandwich Bot stopped successfully');
    } catch (error) {
      logger.error('Error stopping MEV Sandwich Bot', error);
    }
  }
  
  /**
   * Register cleanup handlers for graceful shutdown
   */
  registerCleanupHandlers() {
    // Handle process termination signals
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT. Shutting down...');
      await this.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM. Shutting down...');
      await this.stop();
      process.exit(0);
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', error);
      await this.stop();
      process.exit(1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      logger.error(`Unhandled promise rejection at: ${promise}, reason: ${reason}`);
      await this.stop();
      process.exit(1);
    });
  }
}

// If this file is run directly, start the bot
if (require.main === module) {
  const bot = new MEVSandwichBot();
  bot.start().catch(error => {
    logger.error('Error starting bot', error);
    process.exit(1);
  });
}

module.exports = MEVSandwichBot;