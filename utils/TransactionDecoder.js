const ethers = require('ethers');
const { getCreate2Address } = require('@ethersproject/address');
const { pack, keccak256 } = require('@ethersproject/solidity');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Decodes and analyzes transactions to identify sandwich opportunities
 */
class TransactionDecoder {
  constructor(provider, tokenManager, abiDecoder) {
    this.provider = provider;
    this.tokenManager = tokenManager;
    this.abiDecoder = abiDecoder;
    
    // Initialize router interfaces
    this.routerInterfaces = {};
    for (const dex of config.SUPPORTED_DEXES) {
      this.routerInterfaces[dex.address.toLowerCase()] = new ethers.utils.Interface(dex.abi);
    }
    
    // Factory and init code hash mapping for pair address calculation
    this.factoryMapping = {};
    this.initCodeHashMapping = {};
    
    for (const dex of config.SUPPORTED_DEXES) {
      this.factoryMapping[dex.address.toLowerCase()] = dex.factory;
      this.initCodeHashMapping[dex.address.toLowerCase()] = dex.initCodeHash;
    }
    
    // Constants
    this.WETH = config.WETH_ADDRESS;
    this.minOpportunitySize = ethers.utils.parseEther(config.MIN_VICTIM_SIZE.toString());
  }
  
  /**
   * Analyze a pending transaction to identify sandwich opportunity
   * @param {Object} tx Transaction object from the provider
   * @returns {Object|null} Opportunity data or null if not suitable
   */
  async analyzePendingTransaction(tx) {
    // Skip if transaction is not to a supported router
    if (!tx.to || !this.isSupportedRouter(tx.to)) {
      return null;
    }
    
    try {
      // Get the router interface
      const routerInterface = this.routerInterfaces[tx.to.toLowerCase()];
      if (!routerInterface) return null;
      
      // Decode the transaction input
      let decodedInput;
      try {
        decodedInput = routerInterface.parseTransaction({ data: tx.data });
      } catch (error) {
        // Not a method we can decode, skip
        return null;
      }
      
      // Check if it's a swap function
      if (!this.isSwapFunction(decodedInput.name)) {
        return null;
      }
      
      // Extract swap details
      const swapDetails = this.extractSwapDetails(decodedInput, tx);
      if (!swapDetails) return null;
      
      // Validate token pair
      const { path, amountIn, amountOutMin, deadline } = swapDetails;
      if (!await this.isValidTokenPair(path)) {
        return null;
      }
      
      // Check minimum transaction size
      const tokenInValue = await this.tokenManager.getTokenValueInETH(path[0], amountIn);
      if (tokenInValue.lt(this.minOpportunitySize)) {
        return null;
      }
      
      // Get pair info
      const pairAddress = await this.getPairAddress(path[0], path[1], tx.to);
      const pairInfo = await this.tokenManager.getPairReserves(pairAddress, path[0], path[1]);
      
      if (!pairInfo) return null;
      
      // Calculate potential profit
      const {
        estimatedProfit,
        confidence,
        optimalFrontRunAmount,
        optimalBackRunAmount
      } = await this.calculateSandwichParameters(path, amountIn, pairInfo);
      
      if (estimatedProfit.lte(0) || confidence < 0.7) {
        return null;
      }
      
      // Calculate gas price for front-running
      const suggestedGasPrice = tx.gasPrice.mul(115).div(100); // 15% higher
      
      // Build opportunity object
      return {
        victimTx: tx.hash,
        router: tx.to,
        path,
        amountIn,
        amountOutMin,
        deadline,
        pairAddress,
        pairInfo,
        optimalFrontRunAmount,
        optimalBackRunAmount,
        estimatedProfit,
        confidence,
        gasPrice: tx.gasPrice,
        suggestedGasPrice,
        submittedTime: Date.now()
      };
    } catch (error) {
      logger.error(`Error analyzing transaction ${tx.hash}: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Check if the address is a supported router
   */
  isSupportedRouter(address) {
    return config.SUPPORTED_DEXES.some(dex => 
      dex.address.toLowerCase() === address.toLowerCase()
    );
  }
  
  /**
   * Check if function name is a swap function
   */
  isSwapFunction(functionName) {
    return functionName.startsWith('swap') || 
           functionName.includes('Swap') || 
           functionName.includes('ExactTokens');
  }
  
  /**
   * Extract swap details from decoded input
   */
  extractSwapDetails(decodedInput, tx) {
    try {
      const { name, args } = decodedInput;
      
      // Common swap function patterns
      if (name.includes('swapExactTokensForTokens')) {
        return {
          path: args.path,
          amountIn: args.amountIn,
          amountOutMin: args.amountOutMin,
          deadline: args.deadline
        };
      } 
      else if (name.includes('swapTokensForExactTokens')) {
        return {
          path: args.path,
          amountIn: args.amountInMax, // Maximum input amount
          amountOut: args.amountOut,  // Exact output amount
          deadline: args.deadline
        };
      }
      else if (name.includes('swapExactETHForTokens')) {
        return {
          path: [this.WETH, ...args.path.filter(p => p.toLowerCase() !== this.WETH.toLowerCase())],
          amountIn: tx.value,
          amountOutMin: args.amountOutMin,
          deadline: args.deadline
        };
      }
      else if (name.includes('swapExactTokensForETH')) {
        return {
          path: [...args.path.filter(p => p.toLowerCase() !== this.WETH.toLowerCase()), this.WETH],
          amountIn: args.amountIn,
          amountOutMin: args.amountOutMin,
          deadline: args.deadline
        };
      }
      else if (name.includes('swapTokensForExactETH')) {
        return {
          path: [...args.path.filter(p => p.toLowerCase() !== this.WETH.toLowerCase()), this.WETH],
          amountIn: args.amountInMax,
          amountOut: args.amountOut,
          deadline: args.deadline
        };
      }
      else if (name.includes('swapETHForExactTokens')) {
        return {
          path: [this.WETH, ...args.path.filter(p => p.toLowerCase() !== this.WETH.toLowerCase())],
          amountIn: tx.value,
          amountOut: args.amountOut,
          deadline: args.deadline
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Error extracting swap details: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Validate if token pair is suitable for sandwich attack
   */
  async isValidTokenPair(path) {
    if (!path || path.length < 2) return false;
    
    // Get first and last token in path
    const tokenA = path[0];
    const tokenB = path[path.length - 1];
    
    // Check token blacklist
    if (await this.tokenManager.isTokenBlacklisted(tokenA) || 
        await this.tokenManager.isTokenBlacklisted(tokenB)) {
      return false;
    }
    
    // Check token liquidity
    const liquidityCheck = await this.tokenManager.checkPairLiquidity(tokenA, tokenB);
    return liquidityCheck.isLiquid && !liquidityCheck.isTooDeep;
  }
  
  /**
   * Get pair address for tokens
   */
  async getPairAddress(tokenA, tokenB, routerAddress) {
    // Get factory address for router
    const factoryAddress = this.factoryMapping[routerAddress.toLowerCase()];
    
    if (!factoryAddress) {
      throw new Error(`Factory address not found for router ${routerAddress}`);
    }
    
    // Try to compute pair address using create2
    try {
      const tokens = tokenA.toLowerCase() < tokenB.toLowerCase() 
        ? [tokenA, tokenB] 
        : [tokenB, tokenA];
        
      const salt = keccak256(['bytes'], [pack(['address', 'address'], [tokens[0], tokens[1]])]);
      const initCodeHash = this.initCodeHashMapping[routerAddress.toLowerCase()];
      
      if (!initCodeHash) {
        throw new Error(`Init code hash not found for router ${routerAddress}`);
      }
      
      return getCreate2Address(factoryAddress, salt, initCodeHash);
    } catch (error) {
      logger.error(`Error calculating pair address: ${error.message}`);
      
      // Fallback to contract call
      const factoryAbi = [
        'function getPair(address tokenA, address tokenB) external view returns (address pair)'
      ];
      
      const factoryContract = new ethers.Contract(
        factoryAddress,
        factoryAbi,
        this.provider
      );
      
      return await factoryContract.getPair(tokenA, tokenB);
    }
  }
  
  /**
   * Calculate sandwich parameters
   */
  async calculateSandwichParameters(path, victimAmountIn, pairInfo) {
    // Use more advanced models in real implementation
    // This is a simplified version
    
    const { reserve0, reserve1, token0, token1 } = pairInfo;
    
    // Determine if token0 is being sold by victim
    const token0IsInput = path[0].toLowerCase() === token0.toLowerCase();
    
    const reserveIn = token0IsInput ? reserve0 : reserve1;
    const reserveOut = token0IsInput ? reserve1 : reserve0;
    
    // Calculate optimal front-run amount (simplified)
    // In a real implementation, use the SandwichOptimizer module
    const frontRunRatio = 0.2; // 20% of victim amount
    const optimalFrontRunAmount = victimAmountIn.mul(ethers.BigNumber.from(Math.floor(frontRunRatio * 100))).div(100);
    
    // Calculate price impact for confidence measure
    const priceImpact = victimAmountIn.mul(1000).div(reserveIn).toNumber() / 1000;
    const confidence = Math.min(1, Math.max(0, 1 - (priceImpact * 2)));
    
    // Calculate estimated profit (simplified)
    // In real implementation, use constant product formula
    const profitBps = 20; // 0.2% estimated profit
    const estimatedProfit = victimAmountIn.mul(profitBps).div(10000);
    
    // Calculate back-run amount
    // In real implementation, would be calculated more precisely
    const optimalBackRunAmount = optimalFrontRunAmount.mul(95).div(100); // 95% of front-run amount
    
    return {
      optimalFrontRunAmount,
      optimalBackRunAmount,
      estimatedProfit,
      confidence
    };
  }
}

module.exports = TransactionDecoder;