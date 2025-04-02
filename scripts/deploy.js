// scripts/deploy.js
const hre = require("hardhat");
const ethers = hre.ethers;
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("Starting deployment of FlashLoanSandwich contract...");
  
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);
  
  // Get account balance
  const balance = await deployer.getBalance();
  console.log(`Account balance: ${ethers.utils.formatEther(balance)} ETH`);
  
  // Contract parameters
  // Replace these with actual addresses for your target network
  const lendingPoolAddress = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9"; // Aave V2 Lending Pool
  const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2 Router
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH on mainnet
  const minProfitThreshold = ethers.utils.parseEther("0.005"); // 0.005 ETH
  const maxGasPrice = ethers.utils.parseUnits("100", "gwei"); // 100 gwei
  
  // Deploy the contract
  const FlashLoanSandwich = await ethers.getContractFactory("FlashLoanSandwich");
  const flashLoanSandwich = await FlashLoanSandwich.deploy(
    lendingPoolAddress,
    uniswapRouterAddress,
    wethAddress,
    minProfitThreshold,
    maxGasPrice
  );
  
  await flashLoanSandwich.deployed();
  
  console.log(`FlashLoanSandwich deployed to: ${flashLoanSandwich.address}`);
  
  // Save the contract address and ABI
  const contractsDir = path.join(__dirname, "..", "abis");
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }
  
  // Save the contract address
  fs.writeFileSync(
    path.join(contractsDir, "contract-address.json"),
    JSON.stringify({ FlashLoanSandwich: flashLoanSandwich.address }, null, 2)
  );
  
  // Get the contract ABI
  const FlashLoanSandwichArtifact = artifacts.readArtifactSync("FlashLoanSandwich");
  
  // Save the contract ABI
  fs.writeFileSync(
    path.join(contractsDir, "FlashLoanSandwich.json"),
    JSON.stringify(FlashLoanSandwichArtifact.abi, null, 2)
  );
  
  console.log("Contract address and ABI saved to abis/ directory");
  
  // Update .env file with contract address
  const envPath = path.join(__dirname, "..", ".env");
  let envContent = "";
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
    
    // Replace or add CONTRACT_ADDRESS
    if (envContent.includes("CONTRACT_ADDRESS=")) {
      envContent = envContent.replace(
        /CONTRACT_ADDRESS=.*/,
        `CONTRACT_ADDRESS=${flashLoanSandwich.address}`
      );
    } else {
      envContent += `\nCONTRACT_ADDRESS=${flashLoanSandwich.address}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log(".env file updated with contract address");
  }
  
  console.log("Deployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during deployment:", error);
    process.exit(1);
  });