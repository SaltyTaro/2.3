// scripts/verify.js
const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("Starting contract verification...");
  
  // Read contract address
  const contractsDir = path.join(__dirname, "..", "abis");
  const addressFile = path.join(contractsDir, "contract-address.json");
  
  if (!fs.existsSync(addressFile)) {
    console.error("Contract address file not found. Please deploy the contract first.");
    process.exit(1);
  }
  
  const addressData = JSON.parse(fs.readFileSync(addressFile, 'utf8'));
  const contractAddress = addressData.FlashLoanSandwich;
  
  if (!contractAddress) {
    console.error("FlashLoanSandwich address not found in the address file.");
    process.exit(1);
  }
  
  console.log(`Verifying contract at address: ${contractAddress}`);
  
  // Contract constructor arguments
  // Replace these with the actual values used during deployment
  const lendingPoolAddress = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9"; // Aave V2 Lending Pool
  const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2 Router
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH on mainnet
  const minProfitThreshold = hre.ethers.utils.parseEther("0.005"); // 0.005 ETH
  const maxGasPrice = hre.ethers.utils.parseUnits("100", "gwei"); // 100 gwei
  
  try {
    // Verify the contract
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [
        lendingPoolAddress,
        uniswapRouterAddress,
        wethAddress,
        minProfitThreshold,
        maxGasPrice
      ],
    });
    
    console.log("Contract verified successfully!");
  } catch (error) {
    console.error("Error verifying contract:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during verification:", error);
    process.exit(1);
  });