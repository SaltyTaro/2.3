// scripts/analysis/profitAnalysis.js
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');

/**
 * Analyzes profit data to identify trends and patterns
 */
async function main() {
  logger.info('Starting profit analysis...');
  
  try {
    // Load profit data
    const dataDir = path.join(__dirname, '../../data');
    const profitLogFile = path.join(dataDir, 'profit_log.json');
    
    if (!fs.existsSync(profitLogFile)) {
      logger.error('Profit log file not found. No data to analyze.');
      process.exit(1);
    }
    
    const profitData = JSON.parse(fs.readFileSync(profitLogFile, 'utf8'));
    
    if (profitData.length === 0) {
      logger.error('Profit log file is empty. No data to analyze.');
      process.exit(1);
    }
    
    logger.info(`Loaded ${profitData.length} profit entries for analysis`);
    
    // Convert string values to BigNumber
    const normalizedData = profitData.map(entry => ({
      ...entry,
      profit: ethers.BigNumber.from(entry.profit),
      gasCost: ethers.BigNumber.from(entry.gasCost),
      netProfit: ethers.BigNumber.from(entry.netProfit),
      timestamp: new Date(entry.timestamp)
    }));
    
    // Sort by timestamp
    normalizedData.sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate overall stats
    const totalProfit = normalizedData.reduce(
      (sum, entry) => sum.add(entry.profit),
      ethers.BigNumber.from(0)
    );
    
    const totalGasCost = normalizedData.reduce(
      (sum, entry) => sum.add(entry.gasCost),
      ethers.BigNumber.from(0)
    );
    
    const totalNetProfit = normalizedData.reduce(
      (sum, entry) => sum.add(entry.netProfit),
      ethers.BigNumber.from(0)
    );
    
    // Calculate daily and hourly stats
    const dailyStats = {};
    const hourlyStats = {};
    const tokenPairStats = {};
    
    for (const entry of normalizedData) {
      // Get date and hour
      const date = entry.timestamp.toISOString().split('T')[0];
      const hour = entry.timestamp.getHours();
      const hourKey = `${date}-${hour}`;
      
      // Get token pair
      const tokenPair = `${entry.tokens.tokenA}-${entry.tokens.tokenB}`;
      
      // Update daily stats
      if (!dailyStats[date]) {
        dailyStats[date] = {
          date,
          count: 0,
          profit: ethers.BigNumber.from(0),
          gasCost: ethers.BigNumber.from(0),
          netProfit: ethers.BigNumber.from(0)
        };
      }
      
      dailyStats[date].count++;
      dailyStats[date].profit = dailyStats[date].profit.add(entry.profit);
      dailyStats[date].gasCost = dailyStats[date].gasCost.add(entry.gasCost);
      dailyStats[date].netProfit = dailyStats[date].netProfit.add(entry.netProfit);
      
      // Update hourly stats
      if (!hourlyStats[hourKey]) {
        hourlyStats[hourKey] = {
          date,
          hour,
          count: 0,
          profit: ethers.BigNumber.from(0),
          gasCost: ethers.BigNumber.from(0),
          netProfit: ethers.BigNumber.from(0)
        };
      }
      
      hourlyStats[hourKey].count++;
      hourlyStats[hourKey].profit = hourlyStats[hourKey].profit.add(entry.profit);
      hourlyStats[hourKey].gasCost = hourlyStats[hourKey].gasCost.add(entry.gasCost);
      hourlyStats[hourKey].netProfit = hourlyStats[hourKey].netProfit.add(entry.netProfit);
      
      // Update token pair stats
      if (!tokenPairStats[tokenPair]) {
        tokenPairStats[tokenPair] = {
          tokenA: entry.tokens.tokenA,
          tokenB: entry.tokens.tokenB,
          count: 0,
          profit: ethers.BigNumber.from(0),
          gasCost: ethers.BigNumber.from(0),
          netProfit: ethers.BigNumber.from(0)
        };
      }
      
      tokenPairStats[tokenPair].count++;
      tokenPairStats[tokenPair].profit = tokenPairStats[tokenPair].profit.add(entry.profit);
      tokenPairStats[tokenPair].gasCost = tokenPairStats[tokenPair].gasCost.add(entry.gasCost);
      tokenPairStats[tokenPair].netProfit = tokenPairStats[tokenPair].netProfit.add(entry.netProfit);
    }
    
    // Convert BigNumber to strings for output
    const dailyStatsArray = Object.values(dailyStats).map(day => ({
      ...day,
      profit: ethers.utils.formatEther(day.profit),
      gasCost: ethers.utils.formatEther(day.gasCost),
      netProfit: ethers.utils.formatEther(day.netProfit)
    }));
    
    const hourlyStatsArray = Object.values(hourlyStats).map(hour => ({
      ...hour,
      profit: ethers.utils.formatEther(hour.profit),
      gasCost: ethers.utils.formatEther(hour.gasCost),
      netProfit: ethers.utils.formatEther(hour.netProfit)
    }));
    
    const tokenPairStatsArray = Object.values(tokenPairStats).map(pair => ({
      ...pair,
      profit: ethers.utils.formatEther(pair.profit),
      gasCost: ethers.utils.formatEther(pair.gasCost),
      netProfit: ethers.utils.formatEther(pair.netProfit),
      averageProfit: ethers.utils.formatEther(pair.netProfit.div(pair.count))
    }));
    
    // Sort token pairs by net profit
    tokenPairStatsArray.sort((a, b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
    
    // Calculate hourly distribution
    const hourlyDistribution = Array(24).fill(0);
    for (const entry of normalizedData) {
      const hour = entry.timestamp.getHours();
      hourlyDistribution[hour]++;
    }
    
    // Calculate profit tiers
    const profitTiers = {
      '< 0.001 ETH': 0,
      '0.001 - 0.005 ETH': 0,
      '0.005 - 0.01 ETH': 0,
      '0.01 - 0.05 ETH': 0,
      '0.05 - 0.1 ETH': 0,
      '> 0.1 ETH': 0
    };
    
    for (const entry of normalizedData) {
      const profit = parseFloat(ethers.utils.formatEther(entry.netProfit));
      
      if (profit < 0.001) {
        profitTiers['< 0.001 ETH']++;
      } else if (profit < 0.005) {
        profitTiers['0.001 - 0.005 ETH']++;
      } else if (profit < 0.01) {
        profitTiers['0.005 - 0.01 ETH']++;
      } else if (profit < 0.05) {
        profitTiers['0.01 - 0.05 ETH']++;
      } else if (profit < 0.1) {
        profitTiers['0.05 - 0.1 ETH']++;
      } else {
        profitTiers['> 0.1 ETH']++;
      }
    }
    
    // Calculate gas cost to profit ratio
    const gasCostRatio = totalGasCost.mul(100).div(totalProfit).toNumber() / 100;
    
    // Print summary
    logger.info(`
Profit Analysis Summary:
-----------------------
Total Trades: ${normalizedData.length}
Total Profit: ${ethers.utils.formatEther(totalProfit)} ETH
Total Gas Cost: ${ethers.utils.formatEther(totalGasCost)} ETH (${gasCostRatio}% of profit)
Total Net Profit: ${ethers.utils.formatEther(totalNetProfit)} ETH
Average Net Profit per Trade: ${ethers.utils.formatEther(totalNetProfit.div(normalizedData.length))} ETH

Top 5 Most Profitable Token Pairs:
${tokenPairStatsArray.slice(0, 5).map((pair, i) => 
  `${i+1}. ${pair.tokenA} - ${pair.tokenB}: ${pair.netProfit} ETH (${pair.count} trades, avg: ${pair.averageProfit} ETH)`
).join('\n')}

Profit Distribution:
${Object.entries(profitTiers).map(([tier, count]) => 
  `${tier}: ${count} trades (${(count / normalizedData.length * 100).toFixed(2)}%)`
).join('\n')}

Most Active Hours (UTC):
${hourlyDistribution.map((count, hour) => 
  `Hour ${hour}: ${count} trades (${(count / normalizedData.length * 100).toFixed(2)}%)`
).filter(line => line.includes('(0.00%)') === false).join('\n')}
    `);
    
    // Save analysis results
    const analysisDir = path.join(dataDir, 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    
    const analysisFile = path.join(analysisDir, 'profit_analysis.json');
    fs.writeFileSync(analysisFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalTrades: normalizedData.length,
        totalProfit: ethers.utils.formatEther(totalProfit),
        totalGasCost: ethers.utils.formatEther(totalGasCost),
        totalNetProfit: ethers.utils.formatEther(totalNetProfit),
        averageNetProfit: ethers.utils.formatEther(totalNetProfit.div(normalizedData.length)),
        gasCostRatio
      },
      dailyStats: dailyStatsArray,
      hourlyStats: hourlyStatsArray,
      tokenPairStats: tokenPairStatsArray,
      profitTiers,
      hourlyDistribution
    }, null, 2));
    
    logger.info(`Analysis results saved to ${analysisFile}`);
    
  } catch (error) {
    logger.error(`Profit analysis failed: ${error.message}`);
    process.exit(1);
  }
}

// Execute the analysis
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });