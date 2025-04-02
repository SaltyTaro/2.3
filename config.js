const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Load ABIs
const UNISWAP_ROUTER_ABI = require('./abis/UniswapV2Router.json');
const SUSHISWAP_ROUTER_ABI = require('./abis/SushiswapRouter.json');

// Configuration
const config = {
  // Network settings
  NETWORK: process.env.NETWORK || 'mainnet',
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '1'),
  
  // RPC Endpoints (multiple for redundancy)
  HTTP_ENDPOINTS: [
    process.env.HTTP_ENDPOINT_1,
    process.env.HTTP_ENDPOINT_2,
    process.env.HTTP_ENDPOINT_3
  ].filter(Boolean),
  
  WS_ENDPOINTS: [
    process.env.WS_ENDPOINT_1,
    process.env.WS_ENDPOINT_2
  ].filter(Boolean),
  
  // Default to the first endpoint if not in array
  WS_ENDPOINT: process.env.WS_ENDPOINT_1,
  
  // Contract addresses
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  WETH_ADDRESS: process.env.WETH_ADDRESS || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC_ADDRESS: process.env.USDC_ADDRESS || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  
  // Wallet and contract configuration
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  CONTRACT_ABI: require('./abis/FlashLoanSandwich.json'),
  
  // Strategy parameters
  MIN_VICTIM_SIZE: parseFloat(process.env.MIN_VICTIM_SIZE || '5'),
  MAX_GAS_PRICE: parseInt(process.env.MAX_GAS_PRICE || '100'),
  MIN_PROFIT_THRESHOLD: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.005'),
  MIN_PAIR_LIQUIDITY: parseFloat(process.env.MIN_PAIR_LIQUIDITY || '50'),
  MAX_PAIR_LIQUIDITY: parseFloat(process.env.MAX_PAIR_LIQUIDITY || '10000'),
  USE_DIRECT_ETH: process.env.USE_DIRECT_ETH === 'true',
  
  // Timing parameters
  OPPORTUNITY_TIMEOUT: parseInt(process.env.OPPORTUNITY_TIMEOUT || '10000'),
  PROCESSING_INTERVAL: parseInt(process.env.PROCESSING_INTERVAL || '100'),
  
  // Supported DEXes
  SUPPORTED_DEXES: [
    {
      name: 'Uniswap V2',
      address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      initCodeHash: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      abi: UNISWAP_ROUTER_ABI
    },
    {
      name: 'Sushiswap',
      address: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
      initCodeHash: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      abi: SUSHISWAP_ROUTER_ABI
    }
  ],
  
  // Token blacklist (tokens with transfer fees, rebasing, etc.)
  BLACKLISTED_TOKENS: [
    '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
    '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', // HEX
    '0x798d1be841a82a273720ce31c822c61a67a601c3', // DIGG
    '0x67c597624b17b16fb77959217360b7cd18284253', // MARK
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
    '0xa693b19d2931d498c5b318df961919bb4aee87a5', // UST
    '0x6123b0049f904d730db3c36a31167d9d4121fa6b', // RBN
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
    '0xc0d4ceb216b3ba9c3701b291766fdcba977cec3a', // BUIDL
    '0xd533a949740bb3306d119cc777fa900ba034cd52', // CRV
    '0x0391d2021f89dc339f60fff84546ea23e337750f', // BOND
    '0x9d65ff81a3c488d585bbfb0bfe3c7707c7917f54', // SSV
  ]
};

// Validate config
const requiredEnvVars = [
  'CONTRACT_ADDRESS',
  'PRIVATE_KEY',
  'HTTP_ENDPOINT_1',
  'WS_ENDPOINT_1'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`- ${varName}`));
  process.exit(1);
}

// Environment-specific overrides
if (process.env.NODE_ENV === 'development') {
  config.MIN_VICTIM_SIZE = 0.1;
  config.MIN_PROFIT_THRESHOLD = 0.001;
}

// Create .env file template if it doesn't exist
function createEnvTemplate() {
  const fs = require('fs');
  const envPath = path.join(__dirname, '.env');
  
  if (!fs.existsSync(envPath)) {
    const template = `
# Network settings
NETWORK=mainnet
CHAIN_ID=1

# RPC Endpoints
HTTP_ENDPOINT_1=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
HTTP_ENDPOINT_2=https://eth-mainnet.alchemyapi.io/v2/YOUR_ALCHEMY_KEY
HTTP_ENDPOINT_3=https://rpc.ankr.com/eth

# WebSocket Endpoints
WS_ENDPOINT_1=wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY
WS_ENDPOINT_2=wss://eth-mainnet.alchemyapi.io/v2/YOUR_ALCHEMY_KEY

# Contract and wallet settings
CONTRACT_ADDRESS=0xYOUR_CONTRACT_ADDRESS
PRIVATE_KEY=YOUR_PRIVATE_KEY

# Token addresses
WETH_ADDRESS=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC_ADDRESS=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Strategy settings
MIN_VICTIM_SIZE=5
MAX_GAS_PRICE=100
MIN_PROFIT_THRESHOLD=0.005
MIN_PAIR_LIQUIDITY=50
MAX_PAIR_LIQUIDITY=10000
USE_DIRECT_ETH=true

# Timing parameters
OPPORTUNITY_TIMEOUT=10000
PROCESSING_INTERVAL=100

# Logging
LOG_LEVEL=info
`.trim();

    fs.writeFileSync(envPath, template);
    console.log('.env template created at', envPath);
    console.log('Please fill in your configuration values before running.');
    process.exit(0);
  }
}

// Create .env template if needed
if (process.env.NODE_ENV !== 'production') {
  createEnvTemplate();
}

module.exports = config;