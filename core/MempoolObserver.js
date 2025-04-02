const ethers = require('ethers');
const { WebSocket } = require('ws');
const { promisify } = require('util');
const sleep = promisify(setTimeout);
const config = require('./config');
const {
  getProviders,
  getAbiDecoder,
  getTokenManager
} = require('./utils/providers');
const TransactionDecoder = require('./utils/TransactionDecoder');
const SandwichOptimizer = require('./utils/SandwichOptimizer');
const SandwichExecutor = require('./utils/SandwichExecutor');
const { logger } = require('./utils/logger');
const ProfitTracker = require('./utils/ProfitTracker');

class MempoolObserver {
  constructor() {
    // Initialize providers
    const { provider, wsProvider } = getProviders();
    this.provider = provider;
    this.wsProvider = wsProvider;
    
    // Initialize decoders and managers
    this.abiDecoder = getAbiDecoder();
    this.tokenManager = getTokenManager(provider);
    this.txDecoder = new TransactionDecoder(provider, this.tokenManager, this.abiDecoder);
    this.optimizer = new SandwichOptimizer(provider, this.tokenManager);
    this.executor = new SandwichExecutor(provider, config.PRIVATE_KEY);
    this.profitTracker = new ProfitTracker();
    
    // Internal state management
    this.pendingTxs = new Map();
    this.processedTxs = new Set();
    this.pendingOpportunities = new Map();
    this.isActive = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    
    // Statistics
    this.stats = {
      txsAnalyzed: 0,
      opportunitiesDetected: 0,
      opportunitiesExecuted: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalProfit: ethers.BigNumber.from(0),
      totalGasCost: ethers.BigNumber.from(0),
      startTime: Date.now()
    };
    
    this.lastStatsReport = Date.now();
    this.reportingInterval = 5 * 60 * 1000; // 5 minutes
  }
  
  /**
   * Start monitoring the mempool
   */
  async start() {
    if (this.isActive) {
      logger.warn('Mempool observer is already active');
      return;
    }
    
    this.isActive = true;
    logger.info('Starting mempool observer...');
    
    // Verify contract state before starting
    await this.verifyContractState();
    
    // Start websocket subscription
    this.subscribeToMempool();
    
    // Start opportunity processor
    this.processOpportunities();
    
    // Start stats reporter
    this.reportStats();
  }
  
  /**
   * Stop monitoring the mempool
   */
  async stop() {
    logger.info('Stopping mempool observer...');
    this.isActive = false;
    
    if (this.ws) {
      this.ws.terminate();
    }
    
    // Final stats report
    this.generateStatsReport(true);
  }
  
  /**
   * Subscribe to mempool transactions via websocket
   */
  subscribeToMempool() {
    try {
      // Connect to websocket endpoint
      this.ws = new WebSocket(config.WS_ENDPOINT);
      
      this.ws.on('open', () => {
        logger.info('WebSocket connection established');
        this.reconnectAttempts = 0;
        
        // Subscribe to pending transactions
        const subscribeMsg = {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_subscribe',
          params: ['newPendingTransactions']
        };
        
        this.ws.send(JSON.stringify(subscribeMsg));
      });
      
      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          
          // Handle subscription confirmation
          if (message.id === 1 && message.result) {
            logger.info(`Successfully subscribed to pending transactions: ${message.result}`);
            return;
          }
          
          // Handle incoming pending transaction
          if (message.method === 'eth_subscription' && message.params.subscription) {
            const txHash = message.params.result;
            if (!this.processedTxs.has(txHash)) {
              await this.handlePendingTransaction(txHash);
              this.processedTxs.add(txHash);
              
              // Limit the size of processed tx set
              if (this.processedTxs.size > 10000) {
                const iterator = this.processedTxs.values();
                for (let i = 0; i < 1000; i++) {
                  this.processedTxs.delete(iterator.next().value);
                }
              }
            }
          }
        } catch (error) {
          logger.error(`Error processing WebSocket message: ${error.message}`);
        }
      });
      
      this.ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        this.attemptReconnect();
      });
      
      this.ws.on('close', () => {
        logger.warn('WebSocket connection closed');
        if (this.isActive) {
          this.attemptReconnect();
        }
      });
    } catch (error) {
      logger.error(`Error setting up WebSocket: ${error.message}`);
      if (this.isActive) {
        this.attemptReconnect();
      }
    }
  }
  
  /**
   * Attempt to reconnect WebSocket
   */
  async attemptReconnect() {
    if (!this.isActive || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts. Stopping observer.`);
        this.stop();
      }
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    await sleep(delay);
    this.subscribeToMempool();
  }
  
  /**
   * Handle an incoming pending transaction
   */
  async handlePendingTransaction(txHash) {
    try {
      this.stats.txsAnalyzed++;
      
      // Get transaction details
      const tx = await this.provider.getTransaction(txHash);
      if (!tx || !tx.to) return;
      
      // Check if transaction gas price meets our criteria
      if (this.isTxGasPriceTooHigh(tx)) return;
      
      // Decode and analyze the transaction
      const opportunity = await this.txDecoder.analyzePendingTransaction(tx);
      if (!opportunity) return;
      
      this.stats.opportunitiesDetected++;
      logger.info(`Opportunity detected: ${JSON.stringify({
        txHash: txHash,
        router: opportunity.router,
        path: `${opportunity.path[0]} -> ${opportunity.path[opportunity.path.length - 1]}`,
        amountIn: ethers.utils.formatEther(opportunity.amountIn),
        estimatedProfit: ethers.utils.formatEther(opportunity.estimatedProfit)
      })}`);
      
      // Calculate optimal sandwich parameters
      const sandwichParams = await this.optimizer.calculateOptimalSandwichParams(opportunity);
      if (!sandwichParams.profitable) {
        logger.info(`Opportunity not profitable after calculation: ${txHash}`);
        return;
      }
      
      // Add to pending opportunities queue
      this.pendingOpportunities.set(txHash, {
        opportunity,
        sandwichParams,
        detected: Date.now()
      });
    } catch (error) {
      logger.error(`Error handling pending transaction ${txHash}: ${error.message}`);
    }
  }
  
  /**
   * Check if transaction gas price is too high for our strategy
   */
  isTxGasPriceTooHigh(tx) {
    const maxGasPrice = ethers.utils.parseUnits(config.MAX_GAS_PRICE.toString(), 'gwei');
    return tx.gasPrice.gt(maxGasPrice);
  }
  
  /**
   * Process opportunities from the queue
   */
  async processOpportunities() {
    while (this.isActive) {
      try {
        const now = Date.now();
        
        // Process each pending opportunity
        for (const [txHash, { opportunity, sandwichParams, detected }] of this.pendingOpportunities.entries()) {
          // Check if opportunity has expired
          if (now - detected > config.OPPORTUNITY_TIMEOUT) {
            this.pendingOpportunities.delete(txHash);
            continue;
          }
          
          // Check if we're within gas price limits
          const currentGasPrice = await this.provider.getGasPrice();
          if (currentGasPrice.gt(ethers.utils.parseUnits(config.MAX_GAS_PRICE.toString(), 'gwei'))) {
            logger.info(`Current gas price too high: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
            continue;
          }
          
          // Execute sandwich
          this.stats.opportunitiesExecuted++;
          logger.info(`Executing sandwich for victim tx: ${txHash}`);
          
          const result = await this.executor.executeSandwich(opportunity, sandwichParams);
          this.pendingOpportunities.delete(txHash);
          
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
        }
        
        // Generate stats report if interval has passed
        if (now - this.lastStatsReport > this.reportingInterval) {
          this.generateStatsReport();
          this.lastStatsReport = now;
        }
        
        await sleep(config.PROCESSING_INTERVAL);
      } catch (error) {
        logger.error(`Error in opportunity processor: ${error.message}`);
        await sleep(1000);
      }
    }
  }
  
  /**
   * Verify contract state before starting
   */
  async verifyContractState() {
    try {
      logger.info('Verifying contract state...');
      
      // Check contract state, balance, etc.
      const contractBalance = await this.provider.getBalance(config.CONTRACT_ADDRESS);
      logger.info(`Contract balance: ${ethers.utils.formatEther(contractBalance)} ETH`);
      
      // Check if we have enough ETH for gas
      const walletAddress = new ethers.Wallet(config.PRIVATE_KEY).address;
      const walletBalance = await this.provider.getBalance(walletAddress);
      logger.info(`Wallet balance: ${ethers.utils.formatEther(walletBalance)} ETH`);
      
      const minRequired = ethers.utils.parseEther('0.1');
      if (walletBalance.lt(minRequired)) {
        logger.warn(`Wallet balance is low: ${ethers.utils.formatEther(walletBalance)} ETH. Minimum recommended: 0.1 ETH`);
      }
      
      // Check contract parameters
      const contract = new ethers.Contract(
        config.CONTRACT_ADDRESS,
        config.CONTRACT_ABI,
        this.provider
      );
      
      const minProfitThreshold = await contract.minProfitThreshold();
      const maxGasPrice = await contract.maxGasPrice();
      const emergencyStop = await contract.emergencyStop();
      
      logger.info(`Contract parameters:
        - Min Profit Threshold: ${ethers.utils.formatEther(minProfitThreshold)} ETH
        - Max Gas Price: ${ethers.utils.formatUnits(maxGasPrice, 'gwei')} gwei
        - Emergency Stop: ${emergencyStop}
      `);
      
      if (emergencyStop) {
        logger.warn('Contract emergency stop is active! Sandwich execution will fail.');
      }
      
      return true;
    } catch (error) {
      logger.error(`Error verifying contract state: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Generate and log statistics report
   */
  generateStatsReport(final = false) {
    const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = runtime % 60;
    
    const netProfit = this.stats.totalProfit.sub(this.stats.totalGasCost);
    
    const report = `
${final ? 'FINAL ' : ''}STATISTICS REPORT:
Runtime: ${hours}h ${minutes}m ${seconds}s
Transactions Analyzed: ${this.stats.txsAnalyzed}
Opportunities Detected: ${this.stats.opportunitiesDetected}
Opportunities Executed: ${this.stats.opportunitiesExecuted}
Successful Executions: ${this.stats.successfulExecutions}
Failed Executions: ${this.stats.failedExecutions}
Success Rate: ${this.stats.opportunitiesExecuted > 0 ? 
  (this.stats.successfulExecutions / this.stats.opportunitiesExecuted * 100).toFixed(2) : 0}%
Total Profit: ${ethers.utils.formatEther(this.stats.totalProfit)} ETH
Total Gas Cost: ${ethers.utils.formatEther(this.stats.totalGasCost)} ETH
Net Profit: ${ethers.utils.formatEther(netProfit)} ETH
Pending Opportunities: ${this.pendingOpportunities.size}
    `;
    
    logger.info(report);
    return report;
  }
  
  /**
   * Regularly report statistics
   */
  async reportStats() {
    while (this.isActive) {
      try {
        await sleep(this.reportingInterval);
        if (this.isActive) {
          this.generateStatsReport();
        }
      } catch (error) {
        logger.error(`Error in stats reporter: ${error.message}`);
      }
    }
  }
}

module.exports = MempoolObserver;

// If this file is run directly, start the observer
if (require.main === module) {
  const observer = new MempoolObserver();
  
  // Handle shutdown signals
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT. Shutting down...');
    await observer.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM. Shutting down...');
    await observer.stop();
    process.exit(0);
  });
  
  // Start the observer
  observer.start().catch(error => {
    logger.error(`Failed to start mempool observer: ${error.message}`);
    process.exit(1);
  });
}