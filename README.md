# MEV Sandwich Trading Bot

A production-ready MEV sandwich trading bot that uses flash loans to execute profitable sandwich attacks on decentralized exchanges.

## Features

- **Mempool Monitoring**: Efficiently monitors the Ethereum mempool for potential victim transactions
- **Smart Transaction Detection**: Identifies profitable swap transactions based on token pair, size, and other criteria
- **Flash Loan Integration**: Leverages flash loans to reduce capital requirements while maintaining profitability
- **Multi-DEX Support**: Works with Uniswap V2, Sushiswap, and other compatible DEXes
- **Advanced Optimization**: Calculates optimal front-run and back-run amounts for maximum profit
- **Gas Optimization**: Implements sophisticated gas strategies to ensure front-running success
- **Profit Tracking**: Maintains detailed logs of profits, gas costs, and performance metrics
- **Safety Mechanisms**: Includes circuit breakers, emergency stops, and token blacklists to mitigate risks

## Architecture

The project consists of two main components:

1. **Smart Contracts**: Solidity contracts that handle flash loan execution, swaps, and profit collection
2. **Bot Infrastructure**: Node.js application that monitors the mempool, identifies opportunities, and triggers contract execution

## Prerequisites

- Node.js v14+
- Ethereum RPC provider with WebSocket support (Infura, Alchemy, etc.)
- Private key for transaction signing
- Deployed FlashLoanSandwich contract

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/mev-sandwich-bot.git
   cd mev-sandwich-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create and configure the `.env` file:
   ```
   npm run generate-env
   ```
   This will create a template `.env` file that you can edit with your specific configuration.

4. Deploy the smart contract:
   ```
   npm run deploy
   ```
   This will deploy the FlashLoanSandwich contract and update your `.env` file with the contract address.

## Configuration

Edit the `.env` file with your specific configuration:

```
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

# Strategy settings
MIN_VICTIM_SIZE=5
MAX_GAS_PRICE=100
MIN_PROFIT_THRESHOLD=0.005
MIN_PAIR_LIQUIDITY=50
MAX_PAIR_LIQUIDITY=10000
USE_DIRECT_ETH=true
```

## Usage

### Start the Bot

```
npm start
```

### Development Mode

```
npm run dev
```

### Simulation Mode (No real transactions)

```
npm run simulate
```

## Smart Contract Details

The `FlashLoanSandwich.sol` contract implements the sandwich attack logic:

1. Borrows tokens using a flash loan
2. Executes a front-run swap before the victim transaction
3. Executes a back-run swap after the victim transaction
4. Repays the flash loan and collects profit

Key features of the contract include:

- Flash loan integration with Aave V2
- Safety mechanisms to prevent losses
- Ability to execute with direct ETH (no flash loan)
- Emergency stop functionality
- Profit calculation and verification

## Project Structure

```
mev-sandwich-bot/
├── contracts/
│   └── FlashLoanSandwich.sol
├── core/
│   └── MempoolObserver.js
├── utils/
│   ├── logger.js
│   ├── providers.js
│   ├── TokenManager.js
│   ├── TransactionDecoder.js
│   ├── SandwichOptimizer.js
│   ├── SandwichExecutor.js
│   └── ProfitTracker.js
├── abis/
│   ├── FlashLoanSandwich.json
│   ├── UniswapV2Router.json
│   └── SushiswapRouter.json
├── scripts/
│   └── deploy.js
├── test/
│   └── FlashLoanSandwich.test.js
├── index.js
├── config.js
├── hardhat.config.js
└── package.json
```

## Development Phases

1. **Local Testing**: Test the contract and bot on a local Hardhat network
2. **Mainnet Fork Testing**: Test on a forked mainnet to simulate real conditions
3. **Small-Scale Live Testing**: Deploy with minimal capital to validate the strategy
4. **Scaling**: Gradually increase flash loan amounts as confidence grows

## Performance Metrics

The bot tracks several key performance metrics:

- **Success Rate**: Percentage of successfully executed sandwich attacks
- **Average Profit**: Average profit per successful transaction
- **Gas Efficiency**: Profit relative to gas costs
- **Total Profit**: Cumulative profit over time
- **Most Profitable Pairs**: Token pairs that yield the highest profits

## Risk Management

Several risk management features are implemented:

- **Minimum Profit Threshold**: Only executes transactions with expected profit above a threshold
- **Maximum Gas Price**: Prevents execution during extreme network congestion
- **Token Blacklist**: Avoids tokens with transfer fees, rebasing mechanisms, or other problematic features
- **Circuit Breakers**: Automatically stops execution after consecutive failures
- **Emergency Stop**: Allows manual stopping of all activities

## Disclaimer

This software is provided for educational and research purposes only. MEV extraction can be risky and may result in financial loss. Use at your own risk. Always ensure you are compliant with all applicable laws and regulations.

## License

MIT