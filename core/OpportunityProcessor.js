const { logger } = require('../utils/logger');
const SandwichOptimizer = require('../utils/SandwichOptimizer');
const SandwichExecutor = require('../utils/SandwichExecutor');
const { getProviders } = require('../utils/providers');
const config = require('../config');
const ethers = require('ethers');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

/**
 * Processes opportunities identified by the mempool observer
 */
class OpportunityProcessor {
  constructor(profitTracker) {
    this.isActive = false;
    this.pendingOpportunities = new Map();
    this.processedOpportunities = new Set();
    this.processingInterval = config.PROCESSING_INTERVAL;
    this.opportunityTimeout = config.OPPORTUNITY_TIMEOUT;
    
    // Initialize components
    const { provider } = getProviders();
    this.provider = provider;
    this.optimizer = new SandwichOptimizer(provider, null); // TokenManager will be injected later
    this.executor = new SandwichExecutor(provider, config.PRIVATE_KEY);
    this.profitTracker = profitTracker;
    
    // Statistics
    this.stats = {
      opportunitiesProcessed: 0,
      opportunitiesExecuted: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalProfit: ethers.BigNumber.from(0),
      totalGasCost: ethers.BigNumber.from(0),
      startTime: Date.now()
    };
  }
  
  /**
   * Set token manager (called after initialization)
   */
  setTokenManager(tokenManager) {
    this.optimizer.tokenManager = tokenManager;
  }
  
  /**
   * Start the opportunity processor
   */
  async start() {
    if (this.isActive) {
      logger.warn('Opportunity processor is already running');
      return;
    }
    
    this.isActive = true;
    logger.info('Starting opportunity processor');
    this.processOpportunities();
  }
  
  /**
   * Stop the opportunity processor
   */
  async stop() {
    logger.info('Stopping opportunity processor');
    this.isActive = false;
  }
  
  /**
   * Add a new opportunity to the processing queue
   * @param {string} txHash Transaction hash
   * @param {Object} opportunity Opportunity data
   */
  addOpportunity(txHash, opportunity) {
    // Skip if already processed
    if (this.processedOpportunities.has(txHash)) {
      return false;
    }
    
    // Add to pending queue
    this.pendingOpportunities.set(txHash, {
      opportunity,
      detected: Date.now()
    });
    
    logger.info(`Added opportunity to queue: ${txHash}`);
    return true;
  }
  
  /**
   * Process opportunities from the queue
   */
  async processOpportunities() {
    while (this.isActive) {
      try {
        const now = Date.now();
        const currentGasPrice = await this.provider.getGasPrice();
        const maxGasPrice = ethers.utils.parseUnits(config.MAX_GAS_PRICE.toString(), 'gwei');
        
        // Check if gas price is within limits
        if (currentGasPrice.gt(maxGasPrice)) {
          logger.info(`Current gas price too high: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei, waiting...`);
          await sleep(this.processingInterval * 5);
          continue;
        }
        
        // Process each pending opportunity
        for (const [txHash, { opportunity, detected }] of this.pendingOpportunities.entries()) {
          // Check if opportunity has expired
          if (now - detected > this.opportunityTimeout) {
            logger.info(`Opportunity expired: ${txHash}`);
            this.pendingOpportunities.delete(txHash);
            this.processedOpportunities.add(txHash);
            continue;
          }
          
          try {
            // Calculate optimal sandwich parameters
            const sandwichParams = await this.optimizer.calculateOptimalSandwichParams(opportunity);
            
            // Check if profitable
            if (!sandwichParams.profitable) {
              logger.info(`Opportunity not profitable: ${txHash}`);
              this.pendingOpportunities.delete(txHash);
              this.processedOpportunities.add(txHash);
              continue;
            }
            
            // Execute sandwich
            this.stats.opportunitiesExecuted++;
            logger.info(`Executing sandwich for victim tx: ${txHash}`);
            
            const result = await this.executor.executeSandwich(opportunity, sandwichParams);
            this.pendingOpportunities.delete(txHash);
            this.processedOpportunities.add(txHash);
            
            if (result.success) {
              this.stats.successfulExecutions++;
              this.stats.totalProfit = this.stats.totalProfit.add(result.profit);
              this.stats.totalGasCost = this.stats.totalGasCost.add(result.gasCost);
              
              // Record profit
              this.profitTracker.recordProfit({
                timestamp: Date.now(),
                victimTxHash: txHash,
                sandwichTxHash: result.txHash,
                profit: result.profit,
                gasCost: result.gasCost,
                netProfit: result.profit.sub(result.gasCost),
                tokens: {
                  tokenA: opportunity.path[0],
                  tokenB: opportunity.path[opportunity.path.length - 1]
                }
              });
              
              logger.info(`Sandwich execution successful! Profit: ${ethers.utils.formatEther(result.profit)} ETH, Gas Cost: ${ethers.utils.formatEther(result.gasCost)} ETH`);
            } else {
              this.stats.failedExecutions++;
              logger.warn(`Sandwich execution failed: ${result.error}`);
            }
          } catch (error) {
            logger.error(`Error processing opportunity ${txHash}: ${error.message}`);
            this.pendingOpportunities.delete(txHash);
            this.processedOpportunities.add(txHash);
          }
        }
        
        await sleep(this.processingInterval);
      } catch (error) {
        logger.error(`Error in opportunity processor: ${error.message}`);
        await sleep(1000);
      }
    }
  }
  
  /**
   * Get processor statistics
   */
  getStats() {
    const netProfit = this.stats.totalProfit.sub(this.stats.totalGasCost);
    const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    
    return {
      opportunitiesProcessed: this.stats.opportunitiesProcessed,
      opportunitiesExecuted: this.stats.opportunitiesExecuted,
      successfulExecutions: this.stats.successfulExecutions,
      failedExecutions: this.stats.failedExecutions,
      successRate: this.stats.opportunitiesExecuted > 0 ?
        (this.stats.successfulExecutions / this.stats.opportunitiesExecuted * 100).toFixed(2) : 0,
      totalProfit: ethers.utils.formatEther(this.stats.totalProfit),
      totalGasCost: ethers.utils.formatEther(this.stats.totalGasCost),
      netProfit: ethers.utils.formatEther(netProfit),
      runtime,
      pendingOpportunities: this.pendingOpportunities.size
    };
  }
  
  /**
   * Clean up the processed opportunities set periodically
   */
  cleanupProcessedOpportunities() {
    if (this.processedOpportunities.size > 10000) {
      // Keep only the last 5000 processed opportunities
      const toRemove = this.processedOpportunities.size - 5000;
      let count = 0;
      
      for (const txHash of this.processedOpportunities) {
        this.processedOpportunities.delete(txHash);
        count++;
        
        if (count >= toRemove) break;
      }
      
      logger.debug(`Cleaned up processed opportunities: removed ${count} entries`);
    }
  }
}

module.exports = OpportunityProcessor;