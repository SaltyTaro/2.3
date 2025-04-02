// utils/monitoring.js
const axios = require('axios');
const ethers = require('ethers');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Monitoring and alerting utility for the MEV Sandwich Bot
 */
class Monitoring {
  constructor() {
    this.enabled = config.MONITORING_ENABLED === 'true';
    this.webhookUrl = config.ALERT_WEBHOOK_URL;
    this.lastAlertTime = {};
    this.alertThrottleTime = 5 * 60 * 1000; // 5 minutes
    
    // Performance metrics
    this.metrics = {
      transactionsAnalyzed: 0,
      opportunitiesDetected: 0,
      executionAttempts: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalProfit: ethers.BigNumber.from(0),
      totalGasCost: ethers.BigNumber.from(0),
      startTime: Date.now()
    };
  }
  
  /**
   * Record a transaction analysis
   */
  recordTransactionAnalyzed() {
    this.metrics.transactionsAnalyzed++;
  }
  
  /**
   * Record an opportunity detection
   */
  recordOpportunityDetected() {
    this.metrics.opportunitiesDetected++;
  }
  
  /**
   * Record an execution attempt
   */
  recordExecutionAttempt() {
    this.metrics.executionAttempts++;
  }
  
  /**
   * Record a successful execution
   * @param {Object} result Execution result with profit and gas cost
   */
  recordSuccessfulExecution(result) {
    this.metrics.successfulExecutions++;
    
    if (result.profit) {
      this.metrics.totalProfit = this.metrics.totalProfit.add(result.profit);
    }
    
    if (result.gasCost) {
      this.metrics.totalGasCost = this.metrics.totalGasCost.add(result.gasCost);
    }
    
    // Send alert for large profits
    if (result.profit && result.profit.gt(ethers.utils.parseEther('0.1'))) {
      this.sendAlert('Large Profit Detected', {
        profit: ethers.utils.formatEther(result.profit),
        gasCost: ethers.utils.formatEther(result.gasCost),
        netProfit: ethers.utils.formatEther(result.profit.sub(result.gasCost)),
        txHash: result.txHash
      });
    }
  }
  
  /**
   * Record a failed execution
   * @param {Object} error Error details
   */
  recordFailedExecution(error) {
    this.metrics.failedExecutions++;
    
    // Send alert for failed execution
    this.sendAlert('Execution Failed', {
      error: error.message,
      timestamp: new Date().toISOString()
    }, 'error');
  }
  
  /**
   * Get current performance metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    const runtime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = runtime % 60;
    
    const successRate = this.metrics.executionAttempts > 0 ? 
      (this.metrics.successfulExecutions / this.metrics.executionAttempts * 100).toFixed(2) : 0;
    
    const opportunityRate = this.metrics.transactionsAnalyzed > 0 ?
      (this.metrics.opportunitiesDetected / this.metrics.transactionsAnalyzed * 100).toFixed(4) : 0;
    
    const netProfit = this.metrics.totalProfit.sub(this.metrics.totalGasCost);
    
    return {
      transactionsAnalyzed: this.metrics.transactionsAnalyzed,
      opportunitiesDetected: this.metrics.opportunitiesDetected,
      executionAttempts: this.metrics.executionAttempts,
      successfulExecutions: this.metrics.successfulExecutions,
      failedExecutions: this.metrics.failedExecutions,
      totalProfit: ethers.utils.formatEther(this.metrics.totalProfit),
      totalGasCost: ethers.utils.formatEther(this.metrics.totalGasCost),
      netProfit: ethers.utils.formatEther(netProfit),
      runtime: `${hours}h ${minutes}m ${seconds}s`,
      successRate: `${successRate}%`,
      opportunityRate: `${opportunityRate}%`,
      profitPerHour: hours > 0 ? 
        ethers.utils.formatEther(netProfit.div(hours)) : 
        ethers.utils.formatEther(netProfit)
    };
  }
  
  /**
   * Check contract balance
   * @param {Object} provider Ethereum provider
   * @param {string} contractAddress Contract address
   */
  async checkContractBalance(provider, contractAddress) {
    try {
      const balance = await provider.getBalance(contractAddress);
      
      // Alert if balance is low
      if (balance.lt(ethers.utils.parseEther('0.1'))) {
        this.sendAlert('Low Contract Balance', {
          balance: ethers.utils.formatEther(balance),
          contractAddress,
          timestamp: new Date().toISOString()
        }, 'warning');
      }
      
      return balance;
    } catch (error) {
      logger.error(`Error checking contract balance: ${error.message}`);
      return ethers.BigNumber.from(0);
    }
  }
  
  /**
   * Check wallet balance
   * @param {Object} provider Ethereum provider
   * @param {string} walletAddress Wallet address
   */
  async checkWalletBalance(provider, walletAddress) {
    try {
      const balance = await provider.getBalance(walletAddress);
      
      // Alert if balance is low
      if (balance.lt(ethers.utils.parseEther('0.2'))) {
        this.sendAlert('Low Wallet Balance', {
          balance: ethers.utils.formatEther(balance),
          walletAddress,
          timestamp: new Date().toISOString()
        }, 'warning');
      }
      
      return balance;
    } catch (error) {
      logger.error(`Error checking wallet balance: ${error.message}`);
      return ethers.BigNumber.from(0);
    }
  }
  
  /**
   * Send alert
   * @param {string} title Alert title
   * @param {Object} data Alert data
   * @param {string} level Alert level (info, warning, error)
   */
  async sendAlert(title, data, level = 'info') {
    if (!this.enabled || !this.webhookUrl) {
      return;
    }
    
    // Throttle alerts to prevent spam
    const now = Date.now();
    const key = `${title}-${level}`;
    
    if (this.lastAlertTime[key] && (now - this.lastAlertTime[key] < this.alertThrottleTime)) {
      return;
    }
    
    this.lastAlertTime[key] = now;
    
    try {
      // Send alert to webhook
      const payload = {
        title,
        level,
        data,
        timestamp: new Date().toISOString(),
        botName: 'MEV Sandwich Bot',
        environment: process.env.NODE_ENV || 'production'
      };
      
      await axios.post(this.webhookUrl, payload);
      logger.debug(`Alert sent: ${title}`);
    } catch (error) {
      logger.error(`Error sending alert: ${error.message}`);
    }
  }
  
  /**
   * Generate and send a status report
   */
  async sendStatusReport() {
    if (!this.enabled || !this.webhookUrl) {
      return;
    }
    
    try {
      const metrics = this.getMetrics();
      
      await this.sendAlert('Status Report', {
        metrics,
        timestamp: new Date().toISOString()
      });
      
      logger.debug('Status report sent');
    } catch (error) {
      logger.error(`Error sending status report: ${error.message}`);
    }
  }
}

module.exports = new Monitoring();