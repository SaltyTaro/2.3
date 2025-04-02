const ethers = require('ethers');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Optimizes parameters for sandwich attacks
 */
class SandwichOptimizer {
  constructor(provider, tokenManager) {
    this.provider = provider;
    this.tokenManager = tokenManager;
    
    // Constants
    this.BIPS_DIVISOR = 10000;
    this.AAVE_FEE_BIPS = 9; // 0.09% for Aave flash loans
    this.GAS_BUFFER = 1.2; // 20% buffer for gas estimation
  }
  
  /**
   * Calculate optimal sandwich parameters for an opportunity
   * @param {Object} opportunity Detected opportunity data
   * @returns {Object} Optimal sandwich parameters
   */
  async calculateOptimalSandwichParams(opportunity) {
    try {
      const { path, amountIn, pairInfo } = opportunity;
      
      // Get current network conditions
      const networkConditions = await this.getNetworkConditions();
      
      // Determine token positions
      const tokenIn = path[0];
      const tokenOut = path[1];
      const tokenAIs0 = tokenIn.toLowerCase() === pairInfo.token0.toLowerCase();
      
      // Get reserves
      const reserveIn = tokenAIs0 ? pairInfo.reserve0 : pairInfo.reserve1;
      const reserveOut = tokenAIs0 ? pairInfo.reserve1 : pairInfo.reserve0;
      
      // Calculate optimal parameters using mathematical model
      const result = this.calculateOptimalFrontRunAmount({
        reserveIn,
        reserveOut,
        victimAmount: amountIn,
        fee: 997, // 0.3% fee (997/1000)
      });
      
      // Calculate flash loan amount
      const flashLoanAmount = result.optimalFrontRunAmount.mul(12).div(10); // 120% of front-run amount for safety
      
      // Calculate gas costs
      const estimatedGasUsed = ethers.BigNumber.from(600000); // Estimated gas for sandwich transaction
      const gasCost = networkConditions.gasPrice.mul(estimatedGasUsed);
      
      // Calculate flash loan fee
      const flashLoanFee = flashLoanAmount.mul(this.AAVE_FEE_BIPS).div(this.BIPS_DIVISOR);
      
      // Calculate total cost and net profit
      const totalCost = gasCost.add(flashLoanFee);
      const netProfit = result.expectedProfit.sub(totalCost);
      
      // Check if profitable
      const profitable = netProfit.gt(ethers.utils.parseEther(config.MIN_PROFIT_THRESHOLD.toString()));
      
      // Calculate optimal gas price for front-running
      const optimalGasPrice = this.calculateOptimalGasPrice(
        opportunity.gasPrice,
        networkConditions
      );
      
      // Cap gas price to max allowed
      const maxGasPrice = ethers.utils.parseUnits(config.MAX_GAS_PRICE.toString(), 'gwei');
      const finalGasPrice = optimalGasPrice.gt(maxGasPrice) ? maxGasPrice : optimalGasPrice;
      
      logger.debug(`Optimization result for ${opportunity.victimTx}:
        - Victim amount: ${ethers.utils.formatEther(amountIn)} ETH
        - Optimal front-run: ${ethers.utils.formatEther(result.optimalFrontRunAmount)} ETH
        - Expected profit: ${ethers.utils.formatEther(result.expectedProfit)} ETH
        - Flash loan fee: ${ethers.utils.formatEther(flashLoanFee)} ETH
        - Gas cost: ${ethers.utils.formatEther(gasCost)} ETH
        - Net profit: ${ethers.utils.formatEther(netProfit)} ETH
        - Profitable: ${profitable}
        - Confidence: ${result.confidence}
      `);
      
      return {
        flashLoanAmount,
        frontRunAmount: result.optimalFrontRunAmount,
        backRunAmount: result.optimalBackRunAmount,
        expectedProfit: result.expectedProfit,
        netProfit,
        gasPrice: finalGasPrice,
        gasLimit: estimatedGasUsed.mul(this.GAS_BUFFER).div(10),
        profitable,
        confidence: result.confidence
      };
    } catch (error) {
      logger.error(`Error calculating optimal sandwich parameters: ${error.message}`);
      return {
        profitable: false,
        confidence: 0
      };
    }
  }
  
  /**
   * Calculate optimal front-run amount using mathematical model
   */
  calculateOptimalFrontRunAmount(params) {
    const { reserveIn, reserveOut, victimAmount, fee } = params;
    
    // Convert to decimal for math calculations
    const x = ethers.utils.formatEther(reserveIn);
    const y = ethers.utils.formatEther(reserveOut);
    const v = ethers.utils.formatEther(victimAmount);
    const feeMultiplier = fee / 1000;
    
    // Initial state
    const k = x * y;
    
    // Calculate optimal front-run amount using derivative
    // Formula derived by taking derivative of profit function
    const sqrtTerm = Math.sqrt(x * v * feeMultiplier);
    let optimalFrontRunDecimal = (sqrtTerm - x) / feeMultiplier;
    
    // Ensure optimal amount is positive and reasonable
    optimalFrontRunDecimal = Math.max(0, optimalFrontRunDecimal);
    
    // Cap the optimal amount to be at most 30% of victim's swap
    const cappedOptimalAmount = Math.min(
      optimalFrontRunDecimal,
      v * 0.3
    );
    
    // Calculate expected front-run output
    const frontRunOutput = (y * cappedOptimalAmount * feeMultiplier) / 
                          (x + cappedOptimalAmount * feeMultiplier);
    
    // Update reserves after front-run
    const newX1 = parseFloat(x) + cappedOptimalAmount * feeMultiplier;
    const newY1 = parseFloat(y) - frontRunOutput;
    
    // Calculate victim output
    const victimOutput = (newY1 * v * feeMultiplier) /
                         (newX1 + v * feeMultiplier);
    
    // Update reserves after victim
    const newX2 = newX1 + v * feeMultiplier;
    const newY2 = newY1 - victimOutput;
    
    // Calculate back-run output
    const backRunInput = frontRunOutput;
    const backRunOutput = (newX2 * backRunInput * feeMultiplier) /
                          (newY2 + backRunInput * feeMultiplier);
    
    // Calculate profit
    const profitDecimal = backRunOutput - cappedOptimalAmount;
    
    // Calculate price impact for confidence measure
    const priceImpactFrontRun = cappedOptimalAmount / x;
    
    // Calculate confidence score (higher impact = lower confidence)
    const confidence = Math.max(0, Math.min(1, 1 - (priceImpactFrontRun * 2)));
    
    // Convert back to BigNumber for return
    const optimalFrontRunAmount = ethers.utils.parseEther(cappedOptimalAmount.toString());
    const optimalBackRunAmount = ethers.utils.parseEther(frontRunOutput.toString());
    const expectedProfit = ethers.utils.parseEther(profitDecimal.toString());
    
    return {
      optimalFrontRunAmount,
      optimalBackRunAmount,
      expectedProfit,
      confidence
    };
  }
  
  /**
   * Calculate optimal gas price for front-running
   */
  calculateOptimalGasPrice(victimGasPrice, networkConditions) {
    // Calculate minimum gas price needed to front-run
    // Usually 15-20% higher than victim's gas price
    const minFrontRunGasPrice = victimGasPrice.mul(115).div(100);
    
    // Calculate effective gas price based on network conditions
    const effectiveGasPrice = networkConditions.gasPrice.mul(110).div(100);
    
    // Take maximum of calculated values to ensure front-running
    return minFrontRunGasPrice.gt(effectiveGasPrice) ? 
      minFrontRunGasPrice : effectiveGasPrice;
  }
  
  /**
   * Get current network conditions including gas prices
   */
  async getNetworkConditions() {
    try {
      const gasPrice = await this.provider.getGasPrice();
      const blockNumber = await this.provider.getBlockNumber();
      const block = await this.provider.getBlock(blockNumber);
      
      return {
        blockNumber,
        timestamp: block.timestamp,
        gasPrice,
        baseFee: block.baseFeePerGas || gasPrice
      };
    } catch (error) {
      logger.error(`Error getting network conditions: ${error.message}`);
      // Return default values
      return {
        blockNumber: 0,
        timestamp: Math.floor(Date.now() / 1000),
        gasPrice: ethers.utils.parseUnits('50', 'gwei'),
        baseFee: ethers.utils.parseUnits('50', 'gwei')
      };
    }
  }
}

module.exports = SandwichOptimizer;