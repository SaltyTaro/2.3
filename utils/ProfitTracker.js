const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

/**
 * Tracks and analyzes profit from sandwich executions
 */
class ProfitTracker {
  constructor() {
    this.profits = [];
    this.dataDir = path.join(__dirname, '../data');
    this.profitLogFile = path.join(this.dataDir, 'profit_log.json');
    
    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Load historical profit data
    this.loadProfitHistory();
    
    // Calculate statistics
    this.stats = this.calculateStatistics();
    
    // Setup auto-save interval (every 5 minutes)
    this.autoSaveInterval = setInterval(() => {
      this.saveProfitHistory();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Load historical profit data
   */
  loadProfitHistory() {
    try {
      if (fs.existsSync(this.profitLogFile)) {
        const data = fs.readFileSync(this.profitLogFile, 'utf8');
        const parsedData = JSON.parse(data);
        
        // Convert string values back to BigNumber
        this.profits = parsedData.map(entry => ({
          ...entry,
          profit: ethers.BigNumber.from(entry.profit),
          gasCost: ethers.BigNumber.from(entry.gasCost),
          netProfit: ethers.BigNumber.from(entry.netProfit)
        }));
        
        logger.info(`Loaded ${this.profits.length} historical profit entries`);
      } else {
        this.profits = [];
      }
    } catch (error) {
      logger.error(`Error loading profit history: ${error.message}`);
      this.profits = [];
    }
  }
  
  /**
   * Save profit history to file
   */
  saveProfitHistory() {
    try {
      // Convert BigNumber values to strings for JSON serialization
      const serializableData = this.profits.map(entry => ({
        ...entry,
        profit: entry.profit.toString(),
        gasCost: entry.gasCost.toString(),
        netProfit: entry.netProfit.toString()
      }));
      
      fs.writeFileSync(
        this.profitLogFile,
        JSON.stringify(serializableData, null, 2),
        'utf8'
      );
      
      logger.debug(`Saved ${this.profits.length} profit entries to log file`);
    } catch (error) {
      logger.error(`Error saving profit history: ${error.message}`);
    }
  }
  
  /**
   * Record a new profit entry
   * @param {Object} profitData Profit data object
   */
  recordProfit(profitData) {
    this.profits.push(profitData);
    
    // Recalculate statistics
    this.stats = this.calculateStatistics();
    
    // Log profit
    logger.info(`Recorded profit: ${ethers.utils.formatEther(profitData.netProfit)} ETH (Gas: ${ethers.utils.formatEther(profitData.gasCost)} ETH)`);
    
    // Save to file if we've accumulated several new entries
    if (this.profits.length % 5 === 0) {
      this.saveProfitHistory();
    }
  }
  
  /**
   * Calculate profit statistics
   */
  calculateStatistics() {
    if (this.profits.length === 0) {
      return {
        totalExecutions: 0,
        totalProfit: ethers.BigNumber.from(0),
        totalGasCost: ethers.BigNumber.from(0),
        totalNetProfit: ethers.BigNumber.from(0),
        averageProfit: '0',
        averageGasCost: '0',
        averageNetProfit: '0',
        profitPerDay: '0',
        successRate: 0,
        mostProfitablePairs: []
      };
    }
    
    // Calculate totals
    const totalProfit = this.profits.reduce(
      (sum, entry) => sum.add(entry.profit),
      ethers.BigNumber.from(0)
    );
    
    const totalGasCost = this.profits.reduce(
      (sum, entry) => sum.add(entry.gasCost),
      ethers.BigNumber.from(0)
    );
    
    const totalNetProfit = this.profits.reduce(
      (sum, entry) => sum.add(entry.netProfit),
      ethers.BigNumber.from(0)
    );
    
    // Calculate averages
    const averageProfit = totalProfit.div(this.profits.length);
    const averageGasCost = totalGasCost.div(this.profits.length);
    const averageNetProfit = totalNetProfit.div(this.profits.length);
    
    // Calculate daily stats
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    const profitsLastDay = this.profits.filter(entry => entry.timestamp >= oneDayAgo);
    const netProfitLastDay = profitsLastDay.reduce(
      (sum, entry) => sum.add(entry.netProfit),
      ethers.BigNumber.from(0)
    );
    
    // Calculate most profitable token pairs
    const pairProfits = new Map();
    
    for (const entry of this.profits) {
      const pairKey = `${entry.tokens.tokenA}-${entry.tokens.tokenB}`;
      if (!pairProfits.has(pairKey)) {
        pairProfits.set(pairKey, {
          pair: pairKey,
          tokenA: entry.tokens.tokenA,
          tokenB: entry.tokens.tokenB,
          totalProfit: ethers.BigNumber.from(0),
          count: 0
        });
      }
      
      const pairData = pairProfits.get(pairKey);
      pairData.totalProfit = pairData.totalProfit.add(entry.netProfit);
      pairData.count += 1;
    }
    
    // Sort pairs by profit
    const mostProfitablePairs = Array.from(pairProfits.values())
      .sort((a, b) => {
        return b.totalProfit.gt(a.totalProfit) ? 1 : -1;
      })
      .slice(0, 5)
      .map(pair => ({
        pair: pair.pair,
        tokenA: pair.tokenA,
        tokenB: pair.tokenB,
        totalProfit: ethers.utils.formatEther(pair.totalProfit),
        count: pair.count,
        averageProfit: ethers.utils.formatEther(pair.totalProfit.div(pair.count))
      }));
    
    return {
      totalExecutions: this.profits.length,
      totalProfit,
      totalGasCost,
      totalNetProfit,
      averageProfit: ethers.utils.formatEther(averageProfit),
      averageGasCost: ethers.utils.formatEther(averageGasCost),
      averageNetProfit: ethers.utils.formatEther(averageNetProfit),
      profitPerDay: ethers.utils.formatEther(netProfitLastDay),
      successRate: this.profits.length > 0 ? 100 : 0,
      mostProfitablePairs
    };
  }
  
  /**
   * Get profit summary
   */
  getProfitSummary() {
    const stats = this.stats;
    
    return {
      totalExecutions: stats.totalExecutions,
      totalProfit: ethers.utils.formatEther(stats.totalProfit),
      totalGasCost: ethers.utils.formatEther(stats.totalGasCost),
      totalNetProfit: ethers.utils.formatEther(stats.totalNetProfit),
      averageProfit: stats.averageProfit,
      averageGasCost: stats.averageGasCost,
      averageNetProfit: stats.averageNetProfit,
      profitPerDay: stats.profitPerDay,
      successRate: stats.successRate,
      mostProfitablePairs: stats.mostProfitablePairs
    };
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    clearInterval(this.autoSaveInterval);
    this.saveProfitHistory();
  }
}

module.exports = ProfitTracker;