// scripts/simulate.js
const ethers = require('ethers');
const config = require('../config');
const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Simulates sandwich trades without executing actual transactions
 */
async function main() {
  logger.info("Starting sandwich simulation...");
  
  try {
    // Set up provider
    const provider = new ethers.providers.JsonRpcProvider(config.HTTP_ENDPOINTS[0]);
    
    // Set up contract
    const FlashLoanSandwich = new ethers.Contract(
      config.CONTRACT_ADDRESS,
      config.CONTRACT_ABI,
      provider
    );
    
    // Load historical transactions to simulate
    const dataDir = path.join(__dirname, '..', 'data', 'transaction_data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.error("No transaction data found. Please capture some transactions first.");
      process.exit(1);
    }
    
    // Check if we have simulation data
    const simulationFile = path.join(dataDir, 'simulation_victims.json');
    let victimTransactions = [];
    
    if (fs.existsSync(simulationFile)) {
      victimTransactions = JSON.parse(fs.readFileSync(simulationFile, 'utf8'));
      logger.info(`Loaded ${victimTransactions.length} victim transactions for simulation`);
    } else {
      // Generate sample transactions for simulation
      victimTransactions = generateSampleTransactions();
      fs.writeFileSync(simulationFile, JSON.stringify(victimTransactions, null, 2));
      logger.info(`Generated ${victimTransactions.length} sample transactions for simulation`);
    }
    
    // Results tracking
    const results = {
      totalSimulated: 0,
      profitable: 0,
      unprofitable: 0,
      totalEstimatedProfit: ethers.BigNumber.from(0),
      byTokenPair: {}
    };
    
    // Simulate each transaction
    for (const tx of victimTransactions) {
      try {
        logger.info(`Simulating sandwich for transaction: ${tx.hash}`);
        
        // Calculate flash loan amount (120% of victim amount for safety)
        const victimAmount = ethers.utils.parseEther(tx.amountIn);
        const flashLoanAmount = victimAmount.mul(12).div(10);
        const frontRunAmount = victimAmount.mul(2).div(10); // 20% of victim amount
        const backRunAmount = frontRunAmount.mul(95).div(100); // 95% of front-run amount
        
        // Simulate sandwich
        const simulation = await FlashLoanSandwich.simulateSandwich(
          tx.tokenA,
          tx.tokenB,
          flashLoanAmount,
          frontRunAmount,
          victimAmount,
          backRunAmount
        );
        
        results.totalSimulated++;
        
        // Track result
        const pairKey = `${tx.tokenA}-${tx.tokenB}`;
        if (!results.byTokenPair[pairKey]) {
          results.byTokenPair[pairKey] = {
            tokenA: tx.tokenA,
            tokenB: tx.tokenB,
            totalSimulated: 0,
            profitable: 0,
            unprofitable: 0,
            totalEstimatedProfit: ethers.BigNumber.from(0)
          };
        }
        
        results.byTokenPair[pairKey].totalSimulated++;
        
        if (simulation.profitable) {
          results.profitable++;
          results.byTokenPair[pairKey].profitable++;
          results.totalEstimatedProfit = results.totalEstimatedProfit.add(simulation.estimatedProfit);
          results.byTokenPair[pairKey].totalEstimatedProfit = results.byTokenPair[pairKey].totalEstimatedProfit.add(simulation.estimatedProfit);
          
          logger.info(`Profitable sandwich: ${ethers.utils.formatEther(simulation.estimatedProfit)} ETH`);
        } else {
          results.unprofitable++;
          results.byTokenPair[pairKey].unprofitable++;
          
          logger.info(`Unprofitable sandwich: ${ethers.utils.formatEther(simulation.estimatedProfit)} ETH`);
        }
      } catch (error) {
        logger.error(`Error simulating transaction ${tx.hash}: ${error.message}`);
      }
    }
    
    // Convert token pairs to array for sorting
    const pairResults = Object.values(results.byTokenPair).map(pair => ({
      ...pair,
      totalEstimatedProfit: ethers.utils.formatEther(pair.totalEstimatedProfit),
      profitablePercentage: pair.totalSimulated > 0 ? 
        (pair.profitable / pair.totalSimulated * 100).toFixed(2) : 0
    }));
    
    // Sort by total profit
    pairResults.sort((a, b) => {
      return parseFloat(b.totalEstimatedProfit) - parseFloat(a.totalEstimatedProfit);
    });
    
    // Log results
    logger.info(`
Simulation Results:
Total Simulated: ${results.totalSimulated}
Profitable: ${results.profitable} (${results.totalSimulated > 0 ? (results.profitable / results.totalSimulated * 100).toFixed(2) : 0}%)
Unprofitable: ${results.unprofitable}
Total Estimated Profit: ${ethers.utils.formatEther(results.totalEstimatedProfit)} ETH

Top 5 Most Profitable Pairs:
${pairResults.slice(0, 5).map(pair => 
  `- ${pair.tokenA} - ${pair.tokenB}: ${pair.totalEstimatedProfit} ETH (${pair.profitablePercentage}% profitable)`
).join('\n')}
    `);
    
    // Save results
    const resultsFile = path.join(dataDir, 'simulation_results.json');
    fs.writeFileSync(resultsFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      results: {
        ...results,
        totalEstimatedProfit: ethers.utils.formatEther(results.totalEstimatedProfit),
        byTokenPair: pairResults
      }
    }, null, 2));
    
    logger.info(`Simulation results saved to ${resultsFile}`);
    
  } catch (error) {
    logger.error(`Simulation failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Generate sample transactions for simulation
 * This would typically be replaced with actual historical data
 */
function generateSampleTransactions() {
  // Common token addresses
  const tokens = {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDaDdC4201F984',
    AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
  };
  
  // Generate sample transactions
  const transactions = [];
  let txCount = 0;
  
  // Generate WETH pairs
  Object.entries(tokens).forEach(([symbol, address]) => {
    if (symbol === 'WETH') return;
    
    // Add several transactions with different amounts
    for (let i = 0; i < 5; i++) {
      const amountIn = (5 + Math.random() * 20).toFixed(4); // 5-25 ETH
      
      transactions.push({
        hash: `0xsimulated${txCount++}`,
        tokenA: tokens.WETH,
        tokenB: address,
        amountIn,
        gasPrice: '50',
        blockNumber: 15000000 + txCount
      });
    }
  });
  
  // Add some stablecoin pairs
  const stablecoins = ['USDC', 'USDT', 'DAI'];
  stablecoins.forEach((from, i) => {
    stablecoins.forEach((to, j) => {
      if (i === j) return;
      
      const amountIn = (10000 + Math.random() * 90000).toFixed(0); // 10k-100k units
      
      transactions.push({
        hash: `0xsimulated${txCount++}`,
        tokenA: tokens[from],
        tokenB: tokens[to],
        amountIn,
        gasPrice: '50',
        blockNumber: 15000000 + txCount
      });
    });
  });
  
  return transactions;
}

// Execute the simulation
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });