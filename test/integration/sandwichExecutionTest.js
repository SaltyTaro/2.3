// test/integration/sandwichExecutionTest.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupTestEnvironment } = require("../utils/setupTestEnvironment");
const { mockData } = require("../utils/mockData");

describe("Sandwich Execution Integration Test", function () {
  // Increase timeout for forked mainnet tests
  this.timeout(120000);

  let sandwichContract;
  let owner, user1, user2;
  let weth, dai, usdc;
  let uniswapRouter;
  let mockMempool;
  let testEnv;
  
  before(async function () {
    // Setup test environment
    testEnv = await setupTestEnvironment();
    
    sandwichContract = testEnv.sandwichContract;
    owner = testEnv.owner;
    user1 = testEnv.user1;
    user2 = testEnv.user2;
    weth = testEnv.weth;
    dai = testEnv.dai;
    usdc = testEnv.usdc;
    uniswapRouter = testEnv.uniswapRouter;
    
    // Create mock mempool for simulating victim transactions
    mockMempool = {
      pendingTransactions: [],
      
      addTransaction: function(tx) {
        this.pendingTransactions.push(tx);
      },
      
      removeTransaction: function(txHash) {
        this.pendingTransactions = this.pendingTransactions.filter(tx => tx.hash !== txHash);
      },
      
      getPendingTransactions: function() {
        return [...this.pendingTransactions];
      }
    };
    
    // Fund user1 with WETH to act as victim
    // In a test environment, we need to get WETH from a whale account
    const whaleAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC"; // Binance wallet
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whaleAddress],
    });
    const whale = await ethers.getSigner(whaleAddress);
    
    // Transfer WETH to user1
    await weth.connect(whale).transfer(user1.address, ethers.utils.parseEther("20"));
    
    // Stop impersonating
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [whaleAddress],
    });
    
    // Approve WETH for Uniswap
    await weth.connect(user1).approve(uniswapRouter.address, ethers.constants.MaxUint256);
    
    console.log("Test environment set up successfully");
  });
  
  describe("End-to-End Sandwich Execution", function () {
    it("Should detect and execute a sandwich attack", async function () {
      // 1. Create a mock victim transaction
      const victimAmount = ethers.utils.parseEther("5");
      
      // Create victim swap data
      const path = [weth.address, dai.address];
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      const victimTx = {
        hash: "0x" + "1".repeat(64),
        from: user1.address,
        to: uniswapRouter.address,
        data: uniswapRouter.interface.encodeFunctionData("swapExactTokensForTokens", [
          victimAmount,
          0, // No min output (for testing only)
          path,
          user1.address,
          deadline
        ]),
        gasPrice: ethers.utils.parseUnits("50", "gwei"),
        blockNumber: await ethers.provider.getBlockNumber()
      };
      
      // 2. Execute a transaction decoder to analyze the victim tx
      const TransactionDecoder = require("../../utils/TransactionDecoder");
      
      // Create minimal versions of required components
      const tokenManager = {
        isTokenBlacklisted: async () => false,
        getTokenValueInETH: async () => victimAmount,
        checkPairLiquidity: async () => ({ isLiquid: true, isTooDeep: false }),
        getPairReserves: async () => ({
          token0: weth.address.toLowerCase(),
          token1: dai.address.toLowerCase(),
          reserve0: await weth.balanceOf(mockData.WETH_DAI_PAIR),
          reserve1: await dai.balanceOf(mockData.WETH_DAI_PAIR)
        })
      };
      
      const txDecoder = new TransactionDecoder(ethers.provider, tokenManager, null);
      
      // Add getPairAddress method for testing
      txDecoder.getPairAddress = async () => mockData.WETH_DAI_PAIR;
      
      // 3. Detect the opportunity
      console.log("Analyzing victim transaction...");
      const opportunity = await txDecoder.analyzePendingTransaction(victimTx);
      
      expect(opportunity).to.not.be.null;
      expect(opportunity.path[0]).to.equal(weth.address);
      expect(opportunity.path[1]).to.equal(dai.address);
      
      // 4. Calculate optimal parameters
      const SandwichOptimizer = require("../../utils/SandwichOptimizer");
      const optimizer = new SandwichOptimizer(ethers.provider, tokenManager);
      
      console.log("Calculating optimal sandwich parameters...");
      const sandwichParams = await optimizer.calculateOptimalSandwichParams(opportunity);
      
      // 5. Check if profitable
      expect(sandwichParams.profitable).to.be.true;
      
      // 6. Execute sandwich
      console.log("Executing sandwich...");
      
      // For this test, we'll execute directly with the contract
      // rather than through the SandwichExecutor class
      
      // Calculate user1 DAI balance before victim swap
      const initialDaiBalance = await dai.balanceOf(user1.address);
      
      // Execute sandwich with Ethers (this simulates what SandwichExecutor would do)
      const flashLoanAmount = sandwichParams.flashLoanAmount;
      const frontRunAmount = sandwichParams.frontRunAmount;
      const victimAmountMin = opportunity.amountIn.mul(90).div(100); // 90% of expected
      const victimAmountMax = opportunity.amountIn.mul(110).div(100); // 110% of expected
      const backRunAmount = sandwichParams.backRunAmount;
      
      // Get contract balance before
      const initialContractBalance = await ethers.provider.getBalance(sandwichContract.address);
      
      try {
        // Execute sandwich contract function
        const tx = await sandwichContract.executeSandwich(
          weth.address,
          dai.address,
          flashLoanAmount,
          frontRunAmount,
          victimAmountMin,
          victimAmountMax,
          backRunAmount,
          deadline,
          { gasPrice: ethers.utils.parseUnits("50", "gwei") }
        );
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        
        // Execute victim transaction (this would happen naturally in production)
        await weth.connect(user1).approve(uniswapRouter.address, victimAmount);
        await uniswapRouter.connect(user1).swapExactTokensForTokens(
          victimAmount,
          0, // No min output (for testing only)
          [weth.address, dai.address],
          user1.address,
          deadline
        );
        
        // Get user1 DAI balance after swap
        const finalDaiBalance = await dai.balanceOf(user1.address);
        
        // Victim should have received less DAI due to sandwich
        expect(finalDaiBalance.sub(initialDaiBalance)).to.be.gt(0);
        
        // Check contract balance after
        const finalContractBalance = await ethers.provider.getBalance(sandwichContract.address);
        
        // Contract balance should have increased
        console.log("Contract balance difference:", ethers.utils.formatEther(finalContractBalance.sub(initialContractBalance)));
        
        // Check if SandwichExecuted event was emitted
        const sandwichEvent = receipt.events.find(
          event => event.event === "SandwichExecuted"
        );
        
        // Event should exist
        expect(sandwichEvent).to.not.be.undefined;
        
        // Event should have profit data
        expect(sandwichEvent.args.profit).to.be.gt(0);
        
        console.log("Sandwich execution successful!");
        console.log("Profit:", ethers.utils.formatEther(sandwichEvent.args.profit), "ETH");
        
      } catch (error) {
        console.error("Error executing sandwich:", error);
        throw error;
      }
    });
  });
});