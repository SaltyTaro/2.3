const ethers = require('ethers');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Manages token-related operations and validation
 */
class TokenManager {
  constructor(provider) {
    this.provider = provider;
    this.tokenCache = new Map();
    this.pairCache = new Map();
    this.blacklistedTokens = new Set(config.BLACKLISTED_TOKENS.map(t => t.toLowerCase()));
    
    // Cache expiration time (10 minutes)
    this.cacheExpirationTime = 10 * 60 * 1000;
    
    // Init token ABIs
    this.erc20Abi = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address, uint256) returns (bool)',
      'function allowance(address, address) view returns (uint256)',
      'function approve(address, uint256) returns (bool)',
      'function transferFrom(address, address, uint256) returns (bool)'
    ];
    
    this.pairAbi = [
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function getReserves() view returns (uint112, uint112, uint32)',
      'function factory() view returns (address)'
    ];
    
    // init WETH address
    this.WETH = config.WETH_ADDRESS;
    
    // Initialize token detector
    this.initTokenDetector();
  }
  
  /**
   * Initialize token detector for token validation
   */
  initTokenDetector() {
    this.tokenDetectorSigs = {
      // Fee on transfer detection
      'transfer(address,uint256)': {
        selector: '0xa9059cbb',
        hasFee: (logs) => {
          // Check for fee on transfer by looking for multiple Transfer events
          const transferEvents = logs.filter(log => 
            log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
          );
          return transferEvents.length > 1;
        }
      },
      // Rebase token detection
      '_beforeTokenTransfer(address,address,uint256)': {
        selector: '0x4a15e35d',
        isRebase: true
      },
      'rebase(uint256,uint256)': {
        selector: '0x46a4e0ed',
        isRebase: true
      }
    };
  }
  
  /**
   * Get token info (symbol, name, decimals)
   * @param {string} tokenAddress Token address
   * @returns {Object} Token info
   */
  async getTokenInfo(tokenAddress) {
    // Check cache first
    const cacheKey = tokenAddress.toLowerCase();
    if (this.tokenCache.has(cacheKey)) {
      const cached = this.tokenCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheExpirationTime) {
        return cached.data;
      }
    }
    
    try {
      // Create token contract instance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        this.erc20Abi,
        this.provider
      );
      
      // Get token info
      const [symbol, name, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.name().catch(() => 'Unknown Token'),
        tokenContract.decimals().catch(() => 18)
      ]);
      
      const tokenInfo = {
        address: tokenAddress,
        symbol,
        name,
        decimals
      };
      
      // Cache the result
      this.tokenCache.set(cacheKey, {
        data: tokenInfo,
        timestamp: Date.now()
      });
      
      return tokenInfo;
    } catch (error) {
      logger.error(`Error getting token info for ${tokenAddress}: ${error.message}`);
      
      // Return default values on error
      return {
        address: tokenAddress,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18
      };
    }
  }
  
  /**
   * Check if token is blacklisted
   * @param {string} tokenAddress Token address
   * @returns {boolean} True if blacklisted
   */
  async isTokenBlacklisted(tokenAddress) {
    const address = tokenAddress.toLowerCase();
    
    // Check static blacklist
    if (this.blacklistedTokens.has(address)) {
      return true;
    }
    
    // Check if token has transfer fees or is rebasing
    try {
      const hasFees = await this.detectTokenFees(address);
      if (hasFees) {
        // Add to blacklist cache
        this.blacklistedTokens.add(address);
        return true;
      }
    } catch (error) {
      logger.error(`Error detecting token fees for ${address}: ${error.message}`);
      // If error, conservatively blacklist
      return true;
    }
    
    return false;
  }
  
  /**
   * Detect if token has transfer fees or is rebasing
   */
  async detectTokenFees(tokenAddress) {
    try {
      // Get code of the token contract
      const code = await this.provider.getCode(tokenAddress);
      
      // Check for signatures that indicate fee-on-transfer or rebase tokens
      for (const [funcName, { selector, hasFee, isRebase }] of Object.entries(this.tokenDetectorSigs)) {
        if (code.includes(selector.slice(2))) {
          logger.debug(`Token ${tokenAddress} matches signature: ${funcName}`);
          if (isRebase) return true;
          if (hasFee && await hasFee(tokenAddress)) return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error(`Error in detectTokenFees for ${tokenAddress}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get pair reserves
   * @param {string} pairAddress Pair address
   * @param {string} tokenA First token address
   * @param {string} tokenB Second token address
   * @returns {Object} Pair reserves info
   */
  async getPairReserves(pairAddress, tokenA, tokenB) {
    // Check cache first
    const cacheKey = pairAddress.toLowerCase();
    if (this.pairCache.has(cacheKey)) {
      const cached = this.pairCache.get(cacheKey);
      // Use cache if less than 30 seconds old
      if (Date.now() - cached.timestamp < 30000) {
        return cached.data;
      }
    }
    
    try {
      // Create pair contract instance
      const pairContract = new ethers.Contract(
        pairAddress,
        this.pairAbi,
        this.provider
      );
      
      // Get reserves and tokens
      const [token0, token1, reserves] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
        pairContract.getReserves()
      ]);
      
      const [reserve0, reserve1] = reserves;
      
      // Create result object
      const result = {
        pairAddress,
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
        reserve0,
        reserve1,
        timestamp: Date.now()
      };
      
      // Cache the result
      this.pairCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      logger.error(`Error getting pair reserves for ${pairAddress}: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Check pair liquidity
   * @param {string} tokenA First token address
   * @param {string} tokenB Second token address
   * @returns {Object} Liquidity status
   */
  async checkPairLiquidity(tokenA, tokenB) {
    try {
      // Get factory addresses
      const factoryAddresses = config.SUPPORTED_DEXES.map(dex => dex.factory);
      
      let bestPair = null;
      let highestLiquidity = ethers.BigNumber.from(0);
      let bestDex = null;
      
      // Check all factories for the pair with highest liquidity
      for (const factory of factoryAddresses) {
        try {
          const factoryAbi = ['function getPair(address, address) view returns (address)'];
          const factoryContract = new ethers.Contract(factory, factoryAbi, this.provider);
          
          const pairAddress = await factoryContract.getPair(tokenA, tokenB);
          
          if (pairAddress && pairAddress !== ethers.constants.AddressZero) {
            const pairInfo = await this.getPairReserves(pairAddress, tokenA, tokenB);
            
            if (pairInfo) {
              // Calculate liquidity value in first token
              const liquidity = tokenA.toLowerCase() === pairInfo.token0.toLowerCase() ?
                pairInfo.reserve0.mul(2) : pairInfo.reserve1.mul(2);
              
              if (liquidity.gt(highestLiquidity)) {
                highestLiquidity = liquidity;
                bestPair = pairInfo;
                bestDex = factory;
              }
            }
          }
        } catch (error) {
          // Continue to next factory
          continue;
        }
      }
      
      if (!bestPair) {
        return {
          isLiquid: false,
          isTooDeep: false,
          liquidityValue: ethers.BigNumber.from(0)
        };
      }
      
      // Convert liquidity to ETH value if either token is WETH
      let liquidityValueETH;
      
      if (tokenA.toLowerCase() === this.WETH.toLowerCase()) {
        liquidityValueETH = bestPair.token0.toLowerCase() === this.WETH.toLowerCase() ?
          bestPair.reserve0.mul(2) : bestPair.reserve1.mul(2);
      } else if (tokenB.toLowerCase() === this.WETH.toLowerCase()) {
        liquidityValueETH = bestPair.token0.toLowerCase() === this.WETH.toLowerCase() ?
          bestPair.reserve0.mul(2) : bestPair.reserve1.mul(2);
      } else {
        // If neither token is WETH, we use the token liquidity as an approximation
        liquidityValueETH = highestLiquidity;
      }
      
      // Check if pair has sufficient liquidity
      const minLiquidity = ethers.utils.parseEther(config.MIN_PAIR_LIQUIDITY.toString());
      const maxLiquidity = ethers.utils.parseEther(config.MAX_PAIR_LIQUIDITY.toString());
      
      const isLiquid = liquidityValueETH.gte(minLiquidity);
      const isTooDeep = liquidityValueETH.gte(maxLiquidity);
      
      return {
        isLiquid,
        isTooDeep,
        liquidityValue: liquidityValueETH,
        pair: bestPair,
        dex: bestDex
      };
    } catch (error) {
      logger.error(`Error checking pair liquidity for ${tokenA}/${tokenB}: ${error.message}`);
      return {
        isLiquid: false,
        isTooDeep: false,
        liquidityValue: ethers.BigNumber.from(0)
      };
    }
  }
  
  /**
   * Get token value in ETH
   * @param {string} tokenAddress Token address
   * @param {BigNumber} amount Token amount
   * @returns {BigNumber} Value in ETH
   */
  async getTokenValueInETH(tokenAddress, amount) {
    try {
      // If token is already WETH, return amount directly
      if (tokenAddress.toLowerCase() === this.WETH.toLowerCase()) {
        return amount;
      }
      
      // Check WETH pair
      const wethPairCheck = await this.checkPairLiquidity(tokenAddress, this.WETH);
      
      if (wethPairCheck.isLiquid) {
        // Get token decimals
        const tokenInfo = await this.getTokenInfo(tokenAddress);
        const decimals = tokenInfo.decimals;
        
        // Get the price of 1 token in WETH
        const pair = wethPairCheck.pair;
        const isToken0 = pair.token0.toLowerCase() === tokenAddress.toLowerCase();
        
        const tokenReserve = isToken0 ? pair.reserve0 : pair.reserve1;
        const wethReserve = isToken0 ? pair.reserve1 : pair.reserve0;
        
        // Calculate price: (wethReserve / tokenReserve) * amount
        // Adjust for decimals
        const oneToken = ethers.utils.parseUnits('1', decimals);
        const pricePerToken = wethReserve.mul(ethers.utils.parseEther('1')).div(tokenReserve);
        
        // Scale to amount
        return amount.mul(pricePerToken).div(oneToken);
      }
      
      // If no direct WETH pair, try to route through USDC
      const usdcAddress = config.USDC_ADDRESS;
      
      const usdcPairCheck = await this.checkPairLiquidity(tokenAddress, usdcAddress);
      const wethUsdcPairCheck = await this.checkPairLiquidity(this.WETH, usdcAddress);
      
      if (usdcPairCheck.isLiquid && wethUsdcPairCheck.isLiquid) {
        // Calculate price through USDC
        // This is a simplification, in a real implementation you'd calculate this more precisely
        return amount.div(100); // Rough approximation
      }
      
      // If all else fails, return a conservative estimate
      return amount.div(1000);
    } catch (error) {
      logger.error(`Error getting token value in ETH for ${tokenAddress}: ${error.message}`);
      
      // Return conservative estimate on error
      return amount.div(1000);
    }
  }
}

module.exports = TokenManager;