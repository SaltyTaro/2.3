require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-ethers');
require('dotenv').config();

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.HTTP_ENDPOINT_1 || "https://eth-mainnet.alchemyapi.io/v2/your-api-key",
        blockNumber: parseInt(process.env.FORK_BLOCK_NUMBER || '15000000')
      },
      // Required for tests to work with EIP-1559
      initialBaseFeePerGas: 0,
      gasPrice: 1000000000 // 1 gwei
    },
    mainnet: {
      url: process.env.HTTP_ENDPOINT_1 || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    goerli: {
      url: process.env.GOERLI_RPC_URL || '',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  mocha: {
    timeout: 60000
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};