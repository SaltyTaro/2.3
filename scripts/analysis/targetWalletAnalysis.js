// scripts/analysis/targetWalletAnalysis.js
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const config = require('../../config');

/**
 * Analyzes transactions from a target wallet to identify patterns
 */
async function main() {
  // Target wallet address
  const targetWallet = process.argv[2] || '0xf5213a6a2f0890321712520b8048d9886c1a9900';
  
  if (!ethers.utils.isAddress(targetWallet)) {
    logger.error(`Invalid wallet address: ${targetWallet}`);
    process.exit(1);
  }
  
  logger.info(`Starting analysis of target wallet: ${targetWallet}`);
  
  try {
    // Set up provider
    const provider = new ethers.providers.JsonRpcProvider(config.HTTP_ENDPOINTS[0]);
    
    // Load ABIs
    const uniswapRouterABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../../abis/UniswapV2Router.json'), 'utf8'));
    const erc20ABI = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address, uint256) returns (bool)',
      'function transferFrom(address, address, uint256) returns (bool)'
    ];
    
    // Set up interfaces
    const uniswapInterface = new ethers.utils.Interface(uniswapRouterABI);
    
    // Get wallet transaction count
    const txCount = await provider.getTransactionCount(targetWallet);
    logger.info(`Total transactions: ${txCount}`);
    
    // Get recent transactions
    const blockNumber = await provider.getBlockNumber();
    const startBlock = blockNumber - 10000; // Approximately 1.5 days of blocks
    
    logger.info(`Fetching transactions from block ${startBlock} to ${blockNumber}`);
    
    // Create a filter for transactions from the target wallet
    const filter = {
      fromBlock: startBlock,
      toBlock: blockNumber,
      address: null,
      topics: []
    };
    
    // Create a data structure to store transaction information
    const transactions = [];
    const tokenInteractions = {};
    const routerInteractions = {};
    const sandwichPatterns = [];
    
    // Track potential sandwiches
    let potentialFrontRun = null;
    
    // Get transactions where the target wallet is the sender
    logger.info(`Getting transactions for ${targetWallet}...`);
    
    // Fetch transactions in batches to avoid API limitations
    const batchSize = 500;
    let currentBlock = startBlock;
    
    while (currentBlock < blockNumber) {
      const endBlock = Math.min(currentBlock + batchSize, blockNumber);
      logger.info(`Fetching transactions from block ${currentBlock} to ${endBlock}...`);
      
      try {
        // This is a simplified approach - in a real implementation,
        // you would use an Ethereum indexer or archive node API
        // to get all transactions for an address
        
        // For demonstration purposes, let's fetch the last 10 blocks
        // where the target wallet might have been active
        for (let i = endBlock; i > endBlock - 10 && i >= currentBlock; i--) {
          const block = await provider.getBlock(i, true);
          
          if (block && block.transactions) {
            for (const tx of block.transactions) {
              if (tx.from.toLowerCase() === targetWallet.toLowerCase()) {
                try {
                  // Get full transaction receipt
                  const receipt = await provider.getTransactionReceipt(tx.hash);
                  
                  // Parse transaction data if it's a contract interaction
                  let parsedTx = null;
                  let isSwap = false;
                  
                  if (tx.data && tx.data !== '0x') {
                    try {
                      // Try to parse as Uniswap transaction
                      parsedTx = uniswapInterface.parseTransaction({ data: tx.data });
                      
                      // Check if it's a swap function
                      isSwap = parsedTx.name && (
                        parsedTx.name.startsWith('swap') || 
                        parsedTx.name.includes('Swap') || 
                        parsedTx.name.includes('ExactTokens')
                      );
                      
                      // Track router interactions
                      if (tx.to) {
                        const router = tx.to.toLowerCase();
                        if (!routerInteractions[router]) {
                          routerInteractions[router] = {
                            count: 0,
                            swaps: 0,
                            totalGas: ethers.BigNumber.from(0)
                          };
                        }
                        
                        routerInteractions[router].count++;
                        
                        if (isSwap) {
                          routerInteractions[router].swaps++;
                        }
                        
                        if (receipt) {
                          routerInteractions[router].totalGas = routerInteractions[router].totalGas.add(
                            receipt.gasUsed.mul(tx.gasPrice)
                          );
                        }
                      }
                    } catch (e) {
                      // Not a recognized Uniswap transaction
                      parsedTx = null;
                    }
                  }
                  
                  // Extract token transfers from logs
                  const tokenTransfers = [];
                  
                  if (receipt && receipt.logs) {
                    for (const log of receipt.logs) {
                      // Check if it's a Transfer event (topic0 is keccak256 of "Transfer(address,address,uint256)")
                      if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                        try {
                          // Extract token address
                          const tokenAddress = log.address;
                          
                          // Extract from and to addresses
                          const from = ethers.utils.defaultAbiCoder.decode(['address'], log.topics[1])[0];
                          const to = ethers.utils.defaultAbiCoder.decode(['address'], log.topics[2])[0];
                          
                          // Extract value
                          const value = log.data !== '0x' ? 
                            ethers.BigNumber.from(log.data) : 
                            ethers.BigNumber.from(0);
                          
                          // Add to token transfers
                          tokenTransfers.push({
                            token: tokenAddress,
                            from,
                            to,
                            value
                          });
                          
                          // Track token interactions
                          if (!tokenInteractions[tokenAddress]) {
                            tokenInteractions[tokenAddress] = {
                              count: 0,
                              totalIn: ethers.BigNumber.from(0),
                              totalOut: ethers.BigNumber.from(0)
                            };
                            
                            // Try to get token details
                            try {
                              const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, provider);
                              const [symbol, name, decimals] = await Promise.all([
                                tokenContract.symbol().catch(() => 'UNKNOWN'),
                                tokenContract.name().catch(() => 'Unknown Token'),
                                tokenContract.decimals().catch(() => 18)
                              ]);
                              
                              tokenInteractions[tokenAddress].symbol = symbol;
                              tokenInteractions[tokenAddress].name = name;
                              tokenInteractions[tokenAddress].decimals = decimals;
                            } catch (e) {
                              tokenInteractions[tokenAddress].symbol = 'UNKNOWN';
                              tokenInteractions[tokenAddress].name = 'Unknown Token';
                              tokenInteractions[tokenAddress].decimals = 18;
                            }
                          }
                          
                          tokenInteractions[tokenAddress].count++;
                          
                          if (from.toLowerCase() === targetWallet.toLowerCase()) {
                            tokenInteractions[tokenAddress].totalOut = tokenInteractions[tokenAddress].totalOut.add(value);
                          }
                          
                          if (to.toLowerCase() === targetWallet.toLowerCase()) {
                            tokenInteractions[tokenAddress].totalIn = tokenInteractions[tokenAddress].totalIn.add(value);
                          }
                        } catch (e) {
                          // Skip invalid transfer logs
                        }
                      }
                    }
                  }
                  
                  // Store transaction data
                  transactions.push({
                    hash: tx.hash,
                    blockNumber: tx.blockNumber,
                    timestamp: block.timestamp,
                    to: tx.to,
                    value: tx.value,
                    gasPrice: tx.gasPrice,
                    gasLimit: tx.gasLimit,
                    gasUsed: receipt ? receipt.gasUsed : ethers.BigNumber.from(0),
                    isSwap,
                    tokenTransfers,
                    parsedFunction: parsedTx ? parsedTx.name : null,
                    parsedArgs: parsedTx ? parsedTx.args : null
                  });
                  
                  // Check for sandwich patterns
                  // This is a simplified check - in practice, you would use more sophisticated detection
                  if (isSwap) {
                    if (!potentialFrontRun) {
                      // This could be a front-run
                      potentialFrontRun = {
                        tx,
                        timestamp: block.timestamp,
                        blockNumber: block.blockNumber
                      };
                    } else {
                      // Check if this could be a back-run
                      const timeDiff = block.timestamp - potentialFrontRun.timestamp;
                      const blockDiff = block.blockNumber - potentialFrontRun.blockNumber;
                      
                      if (timeDiff < 60 && blockDiff <= 5) {
                        // Potential sandwich detected
                        sandwichPatterns.push({
                          frontRun: potentialFrontRun.tx.hash,
                          backRun: tx.hash,
                          blockDiff,
                          timeDiff
                        });
                      }
                      
                      // Reset for next potential sandwich
                      potentialFrontRun = null;
                    }
                  }
                } catch (error) {
                  logger.error(`Error processing transaction ${tx.hash}: ${error.message}`);
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error(`Error fetching transactions: ${error.message}`);
      }
      
      currentBlock = endBlock + 1;
    }
    
    // Process the collected data
    
    // Sort transactions by timestamp
    transactions.sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate statistics
    const stats = {
      totalTransactions: transactions.length,
      swapTransactions: transactions.filter(tx => tx.isSwap).length,
      uniqueTokens: Object.keys(tokenInteractions).length,
      uniqueRouters: Object.keys(routerInteractions).length,
      totalGasSpent: transactions.reduce(
        (sum, tx) => sum.add(tx.gasUsed.mul(tx.gasPrice)), 
        ethers.BigNumber.from(0)
      ),
      potentialSandwiches: sandwichPatterns.length
    };
    
    // Convert token interactions to array for sorting
    const tokenInteractionsArray = Object.entries(tokenInteractions).map(([address, data]) => ({
      address,
      ...data,
      totalIn: ethers.utils.formatUnits(data.totalIn, data.decimals),
      totalOut: ethers.utils.formatUnits(data.totalOut, data.decimals)
    }));
    
    // Sort by count
    tokenInteractionsArray.sort((a, b) => b.count - a.count);
    
    // Convert router interactions to array for sorting
    const routerInteractionsArray = Object.entries(routerInteractions).map(([address, data]) => ({
      address,
      ...data,
      totalGas: ethers.utils.formatEther(data.totalGas)
    }));
    
    // Sort by count
    routerInteractionsArray.sort((a, b) => b.count - a.count);
    
    // Print summary
    logger.info(`
Target Wallet Analysis Summary:
------------------------------
Total Transactions: ${stats.totalTransactions}
Swap Transactions: ${stats.swapTransactions} (${stats.swapTransactions / stats.totalTransactions * 100}%)
Unique Tokens: ${stats.uniqueTokens}
Unique Routers: ${stats.uniqueRouters}
Total Gas Spent: ${ethers.utils.formatEther(stats.totalGasSpent)} ETH
Potential Sandwiches: ${stats.potentialSandwiches}

Top 5 Most Interacted Tokens:
${tokenInteractionsArray.slice(0, 5).map((token, i) => 
  `${i+1}. ${token.symbol} (${token.address}): ${token.count} interactions`
).join('\n')}

Top 5 Most Used Routers:
${routerInteractionsArray.slice(0, 5).map((router, i) => 
  `${i+1}. ${router.address}: ${router.count} interactions (${router.swaps} swaps)`
).join('\n')}

${sandwichPatterns.length > 0 ? `
Potential Sandwich Patterns:
${sandwichPatterns.slice(0, 5).map((sandwich, i) => 
  `${i+1}. Front-run: ${sandwich.frontRun}, Back-run: ${sandwich.backRun}, Blocks: ${sandwich.blockDiff}, Time: ${sandwich.timeDiff}s`
).join('\n')}
` : ''}
    `);
    
    // Save analysis results
    const dataDir = path.join(__dirname, '../../data');
    const analysisDir = path.join(dataDir, 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    
    const analysisFile = path.join(analysisDir, `wallet_analysis_${targetWallet}.json`);
    fs.writeFileSync(analysisFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      targetWallet,
      stats,
      tokenInteractions: tokenInteractionsArray,
      routerInteractions: routerInteractionsArray,
      sandwichPatterns,
      transactions: transactions.map(tx => ({
        ...tx,
        value: tx.value.toString(),
        gasPrice: tx.gasPrice.toString(),
        gasLimit: tx.gasLimit.toString(),
        gasUsed: tx.gasUsed.toString(),
        tokenTransfers: tx.tokenTransfers.map(transfer => ({
          ...transfer,
          value: transfer.value.toString()
        }))
      }))
    }, null, 2));
    
    logger.info(`Analysis results saved to ${analysisFile}`);
    
  } catch (error) {
    logger.error(`Target wallet analysis failed: ${error.message}`);
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