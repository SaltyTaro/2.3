const ethers = require('ethers');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Handles sandwich transaction execution
 */
class SandwichExecutor {
  constructor(provider, privateKey) {
    this.provider = provider;
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.contractAddress = config.CONTRACT_ADDRESS;
    this.contractAbi = config.CONTRACT_ABI;
    this.contract = new ethers.Contract(
      this.contractAddress,
      this.contractAbi,
      this.wallet
    );
    
    // Track nonce locally to avoid nonce conflicts
    this.currentNonce = null;
    this.lastNonceRefresh = 0;
    this.nonceRefreshInterval = 30000; // 30 seconds
    
    // Transaction tracking
    this.pendingTxs = new Map();
    this.txTimeout = 120000; // 2 minutes
  }
  
  /**
   * Execute a sandwich attack
   * @param {Object} opportunity Detected opportunity
   * @param {Object} params Optimized sandwich parameters
   * @returns {Object} Execution result
   */
  async executeSandwich(opportunity, params) {
    try {
      logger.info(`Executing sandwich for victim tx: ${opportunity.victimTx}`);
      
      // Refresh nonce if needed
      await this.refreshNonce();
      
      // Get token addresses
      const tokenA = opportunity.path[0];
      const tokenB = opportunity.path[1];
      
      // Prepare execution parameters
      const {
        flashLoanAmount,
        frontRunAmount,
        backRunAmount,
        gasPrice,
        gasLimit
      } = params;
      
      // Set deadline 60 seconds in the future
      const deadline = Math.floor(Date.now() / 1000) + 60;
      
      // Prepare transaction
      const nonce = this.currentNonce++;
      
      // Check if we're executing with ETH or flash loan
      if (tokenA.toLowerCase() === config.WETH_ADDRESS.toLowerCase() && config.USE_DIRECT_ETH) {
        // Execute with direct ETH (no flash loan)
        return this.executeWithETH(
          opportunity,
          tokenB,
          frontRunAmount,
          backRunAmount,
          opportunity.amountIn, // Victim amount
          gasPrice,
          gasLimit,
          deadline,
          nonce
        );
      } else {
        // Execute with flash loan
        return this.executeWithFlashLoan(
          opportunity,
          tokenA,
          tokenB,
          flashLoanAmount,
          frontRunAmount,
          backRunAmount,
          opportunity.amountIn, // Victim amount
          gasPrice,
          gasLimit,
          deadline,
          nonce
        );
      }
    } catch (error) {
      logger.error(`Error executing sandwich: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute sandwich with direct ETH (no flash loan)
   */
  async executeWithETH(
    opportunity,
    tokenB,
    frontRunAmount,
    backRunAmount,
    victimAmount,
    gasPrice,
    gasLimit,
    deadline,
    nonce
  ) {
    try {
      // Calculate min/max victim amount for sandwich execution
      const victimAmountMin = victimAmount.mul(90).div(100); // 90% of expected
      const victimAmountMax = victimAmount.mul(110).div(100); // 110% of expected
      
      // Prepare transaction
      const tx = await this.contract.executeSandwichWithETH(
        tokenB,
        frontRunAmount,
        victimAmountMin,
        victimAmountMax,
        backRunAmount,
        deadline,
        {
          value: frontRunAmount,
          gasPrice,
          gasLimit,
          nonce
        }
      );
      
      // Track transaction
      logger.info(`Sandwich transaction submitted: ${tx.hash}`);
      const txResult = await this.trackTransaction(tx.hash);
      
      if (txResult.success) {
        // Calculate profit from logs
        const profit = this.extractProfitFromReceipt(txResult.receipt);
        const gasCost = txResult.receipt.gasUsed.mul(txResult.receipt.effectiveGasPrice);
        
        return {
          success: true,
          txHash: tx.hash,
          profit,
          gasCost,
          receipt: txResult.receipt
        };
      } else {
        return {
          success: false,
          error: txResult.error
        };
      }
    } catch (error) {
      logger.error(`Error executing sandwich with ETH: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute sandwich with flash loan
   */
  async executeWithFlashLoan(
    opportunity,
    tokenA,
    tokenB,
    flashLoanAmount,
    frontRunAmount,
    backRunAmount,
    victimAmount,
    gasPrice,
    gasLimit,
    deadline,
    nonce
  ) {
    try {
      // Calculate min/max victim amount for sandwich execution
      const victimAmountMin = victimAmount.mul(90).div(100); // 90% of expected
      const victimAmountMax = victimAmount.mul(110).div(100); // 110% of expected
      
      // Prepare transaction
      const tx = await this.contract.executeSandwich(
        tokenA,
        tokenB,
        flashLoanAmount,
        frontRunAmount,
        victimAmountMin,
        victimAmountMax,
        backRunAmount,
        deadline,
        {
          gasPrice,
          gasLimit,
          nonce
        }
      );
      
      // Track transaction
      logger.info(`Sandwich transaction submitted: ${tx.hash}`);
      const txResult = await this.trackTransaction(tx.hash);
      
      if (txResult.success) {
        // Calculate profit from logs
        const profit = this.extractProfitFromReceipt(txResult.receipt);
        const gasCost = txResult.receipt.gasUsed.mul(txResult.receipt.effectiveGasPrice);
        
        return {
          success: true,
          txHash: tx.hash,
          profit,
          gasCost,
          receipt: txResult.receipt
        };
      } else {
        return {
          success: false,
          error: txResult.error
        };
      }
    } catch (error) {
      logger.error(`Error executing sandwich with flash loan: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Extract profit from transaction receipt
   */
  extractProfitFromReceipt(receipt) {
    try {
      // Find SandwichExecuted event
      const sandwichEvent = receipt.events.find(
        event => event.event === 'SandwichExecuted'
      );
      
      if (sandwichEvent && sandwichEvent.args) {
        return sandwichEvent.args.profit;
      }
      
      // If event not found, return 0
      return ethers.BigNumber.from(0);
    } catch (error) {
      logger.error(`Error extracting profit from receipt: ${error.message}`);
      return ethers.BigNumber.from(0);
    }
  }
  
  /**
   * Track transaction until confirmed or timeout
   */
  async trackTransaction(txHash) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Create tracking entry
      const tracking = {
        txHash,
        startTime,
        resolved: false
      };
      
      this.pendingTxs.set(txHash, tracking);
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!tracking.resolved) {
          tracking.resolved = true;
          this.pendingTxs.delete(txHash);
          logger.warn(`Transaction ${txHash} timed out after ${this.txTimeout}ms`);
          resolve({
            success: false,
            error: 'Transaction timeout'
          });
        }
      }, this.txTimeout);
      
      // Set up receipt listener
      this.provider.once(txHash, (receipt) => {
        if (!tracking.resolved) {
          clearTimeout(timeoutId);
          tracking.resolved = true;
          this.pendingTxs.delete(txHash);
          
          if (receipt.status === 1) {
            logger.info(`Transaction ${txHash} confirmed in block ${receipt.blockNumber}`);
            resolve({
              success: true,
              receipt
            });
          } else {
            logger.warn(`Transaction ${txHash} failed, status: ${receipt.status}`);
            resolve({
              success: false,
              error: 'Transaction reverted',
              receipt
            });
          }
        }
      });
    });
  }
  
  /**
   * Refresh transaction nonce
   */
  async refreshNonce() {
    const now = Date.now();
    
    // Only refresh nonce if it's been more than the interval since last refresh
    if (!this.currentNonce || (now - this.lastNonceRefresh > this.nonceRefreshInterval)) {
      try {
        this.currentNonce = await this.wallet.getTransactionCount();
        this.lastNonceRefresh = now;
        logger.debug(`Refreshed nonce: ${this.currentNonce}`);
      } catch (error) {
        logger.error(`Error refreshing nonce: ${error.message}`);
        // If we already have a nonce, continue using it
        if (!this.currentNonce) {
          throw new Error('Failed to get nonce and no previous nonce available');
        }
      }
    }
  }
  
  /**
   * Speed up a pending transaction by replacing it with higher gas price
   */
  async speedUpTransaction(txHash, gasPriceMultiplier = 1.5) {
    try {
      // Get original transaction
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        throw new Error(`Transaction ${txHash} not found`);
      }
      
      // If transaction is already confirmed, no need to speed up
      if (tx.blockNumber) {
        logger.info(`Transaction ${txHash} already confirmed, no need to speed up`);
        return {
          success: false,
          error: 'Transaction already confirmed'
        };
      }
      
      // Calculate new gas price
      const newGasPrice = tx.gasPrice.mul(Math.floor(gasPriceMultiplier * 100)).div(100);
      const maxGasPrice = ethers.utils.parseUnits(config.MAX_GAS_PRICE.toString(), 'gwei');
      
      // Cap gas price to max
      const finalGasPrice = newGasPrice.gt(maxGasPrice) ? maxGasPrice : newGasPrice;
      
      // Prepare replacement transaction (same parameters but higher gas price)
      const replacementTx = {
        to: tx.to,
        from: tx.from,
        nonce: tx.nonce,
        data: tx.data,
        value: tx.value,
        gasLimit: tx.gasLimit,
        gasPrice: finalGasPrice
      };
      
      // Sign and send replacement transaction
      const signedTx = await this.wallet.signTransaction(replacementTx);
      const txResponse = await this.provider.sendTransaction(signedTx);
      
      logger.info(`Replacement transaction submitted: ${txResponse.hash}`);
      
      return {
        success: true,
        originalTxHash: txHash,
        newTxHash: txResponse.hash,
        gasPrice: finalGasPrice
      };
    } catch (error) {
      logger.error(`Error speeding up transaction ${txHash}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = SandwichExecutor;