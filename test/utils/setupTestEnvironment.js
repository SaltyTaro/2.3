// test/utils/setupTestEnvironment.js
const { ethers } = require("hardhat");
const { mockData } = require("./mockData");

/**
 * Sets up the test environment for integration tests
 */
async function setupTestEnvironment() {
  // Fork mainnet at specific block
  await network.provider.request({
    method: "hardhat_reset",
    params: [{
      forking: {
        jsonRpcUrl: process.env.HTTP_ENDPOINT_1 || "https://eth-mainnet.alchemyapi.io/v2/your-api-key",
        blockNumber: 15000000, // Specific block number for consistent tests
      },
    }],
  });
  
  // Get signers
  const [owner, user1, user2] = await ethers.getSigners();
  
  // Connect to mainnet contracts
  const weth = await ethers.getContractAt("IERC20", mockData.WETH_ADDRESS);
  const dai = await ethers.getContractAt("IERC20", mockData.DAI_ADDRESS);
  const usdc = await ethers.getContractAt("IERC20", mockData.USDC_ADDRESS);
  const uniswapRouter = await ethers.getContractAt("IUniswapV2Router02", mockData.UNISWAP_ROUTER_ADDRESS);
  const aaveLendingPool = await ethers.getContractAt("contracts/interfaces/ILendingPool.sol:ILendingPool", mockData.AAVE_LENDING_POOL_ADDRESS);
  // Deploy sandwich contract - use higher gas price for tests
  const FlashLoanSandwich = await ethers.getContractFactory("FlashLoanSandwich");
  const sandwichContract = await FlashLoanSandwich.deploy(
    mockData.AAVE_LENDING_POOL_ADDRESS,
    mockData.UNISWAP_ROUTER_ADDRESS,
    mockData.WETH_ADDRESS,
    ethers.utils.parseEther("0.001"), // minProfitThreshold
    ethers.utils.parseUnits("300", "gwei") // maxGasPrice - increased for tests
  );
  await sandwichContract.deployed();
  
  console.log("Test environment: FlashLoanSandwich deployed to:", sandwichContract.address);
  
  // Fund the contract with ETH for gas
  await owner.sendTransaction({
    to: sandwichContract.address,
    value: ethers.utils.parseEther("1")
  });
  
  // Get WETH for tests - impersonate a whale
  const whaleAddress = mockData.WETH_WHALE;
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [whaleAddress],
  });
  const whale = await ethers.getSigner(whaleAddress);
  
  // Fund whale with ETH for gas
  await owner.sendTransaction({
    to: whaleAddress,
    value: ethers.utils.parseEther("1")
  });
  
  // Transfer some WETH to test wallets
  // This step might fail if the fork is too old and the whale no longer has enough WETH
  try {
    await weth.connect(whale).transfer(owner.address, ethers.utils.parseEther("10"));
    await weth.connect(whale).transfer(user1.address, ethers.utils.parseEther("10"));
  } catch (error) {
    console.log("Warning: Could not transfer WETH from whale - tests may fail");
  }
  
  // Stop impersonating
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [whaleAddress],
  });
  
  // Create tokens array for convenience
  const tokens = {
    WETH: weth,
    DAI: dai,
    USDC: usdc
  };
  
  // Return test environment
  return {
    sandwichContract,
    owner,
    user1,
    user2,
    weth,
    dai,
    usdc,
    uniswapRouter,
    aaveLendingPool,
    tokens
  };
}

module.exports = { setupTestEnvironment };