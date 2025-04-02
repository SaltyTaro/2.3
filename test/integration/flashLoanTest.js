// test/integration/flashLoanTest.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupTestEnvironment } = require("../utils/setupTestEnvironment");
const fs = require('fs');
const path = require('path');

describe("Flash Loan Integration Test", function () {
  // Increase timeout for forked mainnet tests
  this.timeout(60000);

  let sandwichContract;
  let owner, user1, user2;
  let weth, dai, usdc;
  let uniswapRouter, aaveLendingPool;
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
    aaveLendingPool = testEnv.aaveLendingPool;
    
    // Fund contract with ETH for gas
    await owner.sendTransaction({
      to: sandwichContract.address,
      value: ethers.utils.parseEther("1")
    });
    
    console.log("Flash loan test environment set up successfully");
  });
  
  describe("Flash Loan Functionality", function () {
    it("Should be able to execute a flash loan", async function () {
      // We'll test the flash loan functionality directly by creating a mock transaction
      // that will be handled by the executeOperation function
      
      // Create a test contract to initiate the flash loan
      const FlashLoanTester = await ethers.getContractFactory("FlashLoanTester");
      const flashLoanTester = await FlashLoanTester.deploy(aaveLendingPool.address);
      await flashLoanTester.deployed();
      
      console.log("FlashLoanTester deployed at:", flashLoanTester.address);
      
      // Fund the tester contract with ETH for gas
      await owner.sendTransaction({
        to: flashLoanTester.address,
        value: ethers.utils.parseEther("1")
      });
      
      // Set up flash loan parameters
      const assets = [weth.address];
      const amounts = [ethers.utils.parseEther("10")]; // 10 WETH
      const modes = [0]; // no debt, just flash loan
      
      // Create mock params for testing
      const flashLoanParams = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [
          weth.address,
          dai.address,
          ethers.utils.parseEther("2"), // frontRunAmount
          ethers.utils.parseEther("4.5"), // victimAmountMin
          ethers.utils.parseEther("5.5"), // victimAmountMax
          ethers.utils.parseEther("2"), // backRunAmount
          Math.floor(Date.now() / 1000) + 3600 // deadline
        ]
      );
      
      // For testing purposes, we'll mock a flash loan by directly calling the executeOperation function
      console.log("Testing flash loan execution...");
      
      // Impersonate Aave lending pool to call executeOperation
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [aaveLendingPool.address],
      });
      
      const lendingPoolSigner = await ethers.getSigner(aaveLendingPool.address);
      
      // Fund lending pool with ETH for gas
      await owner.sendTransaction({
        to: aaveLendingPool.address,
        value: ethers.utils.parseEther("1")
      });
      
      // Get a whale with a lot of WETH
      const whaleAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC"; // Binance wallet
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [whaleAddress],
      });
      const whale = await ethers.getSigner(whaleAddress);
      
      // Transfer WETH to lending pool for testing
      await weth.connect(whale).transfer(aaveLendingPool.address, ethers.utils.parseEther("20"));
      
      // Transfer WETH to our contract to handle the "loan"
      await weth.connect(whale).transfer(sandwichContract.address, ethers.utils.parseEther("10"));
      
      // Prepare premium amount (0.09% of loan)
      const premium = ethers.utils.parseEther("10").mul(9).div(10000); // 0.09% premium
      
      // Calculate premium
      const premiums = [premium];
      
      try {
        // This is a simplified test that directly calls executeOperation
        // In reality, this would be called by the lending pool as part of a flash loan
        const result = await sandwichContract.connect(lendingPoolSigner).executeOperation(
          assets,
          amounts,
          premiums,
          sandwichContract.address, // initiator
          flashLoanParams // params
        );
        
        // Check if function returned true (successful execution)
        expect(result).to.equal(true);
        
        console.log("Flash loan execution successful!");
        
      } catch (error) {
        console.error("Error executing flash loan:", error);
        throw error;
      } finally {
        // Stop impersonating accounts
        await network.provider.request({
          method: "hardhat_stopImpersonatingAccount",
          params: [aaveLendingPool.address],
        });
        
        await network.provider.request({
          method: "hardhat_stopImpersonatingAccount",
          params: [whaleAddress],
        });
      }
    });
  });
});

// Simple contract for testing flash loans
const testContractSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface ILendingPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

contract FlashLoanTester {
    ILendingPool public lendingPool;
    
    constructor(address _lendingPoolAddress) {
        lendingPool = ILendingPool(_lendingPoolAddress);
    }
    
    function executeFlashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        bytes calldata params
    ) external {
        lendingPool.flashLoan(
            receiverAddress,
            assets,
            amounts,
            modes,
            address(this),
            params,
            0 // referral code
        );
    }
    
    // Function to receive ETH
    receive() external payable {}
}
`;

// Add the test contract to the project
before(async function() {
  const testContractPath = path.join(__dirname, '../../contracts/FlashLoanTester.sol');
  fs.writeFileSync(testContractPath, testContractSource);
});